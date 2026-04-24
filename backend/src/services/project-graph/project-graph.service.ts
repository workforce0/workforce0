/**
 * =============================================================================
 * PROJECT GRAPH SERVICE
 * =============================================================================
 *
 * Builds, caches, and queries per-project code knowledge graphs.
 *
 * Pipeline:
 *   1. `buildFromPath(projectId, repoPath)` — walk files, run the
 *      per-language AST extractor, merge per-file results into one
 *      graph, resolve cross-file `calls` + `imports`, run Louvain
 *      community detection, serialize and upsert onto ProjectGraph.
 *   2. `getLatest(tenantId, projectId)` — read the cached row.
 *   3. Query helpers used by agent tools + REST:
 *        - `listGodNodes(graph, limit)` — highest-degree nodes
 *        - `findCallers(graph, symbolName)` — all `calls` incoming
 *        - `shortestPath(graph, from, to)` — Dijkstra across the
 *          graphology graph
 *        - `communityMembers(graph, symbolName)` — all symbols in
 *          the same Louvain community
 *
 * Inspiration:
 * ------------
 * This service is a native TypeScript implementation of ideas
 * pioneered by https://github.com/safishamsi/graphify — specifically
 * the AST-first extraction pipeline, the god-nodes view, the tagged
 * EXTRACTED vs INFERRED edge confidence, and the community-detection-
 * as-semantic-similarity approach. We do not bundle their code; we
 * reimplement using the TypeScript compiler API + graphology so the
 * whole thing runs in our existing Node stack with zero Python /
 * external CLI / third-party LLM dependencies.
 *
 * @module services/project-graph
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
// graphology ships as a CJS module; the default export IS the Graph
// constructor, but our `"module": "NodeNext"` config requires the
// `.default` interop shim at runtime.
import graphologyPkg from 'graphology';
import louvainPkg from 'graphology-communities-louvain';
import shortestPathPkg from 'graphology-shortest-path/unweighted.js';

const Graph = (graphologyPkg as any).default ?? graphologyPkg;
const louvain = (louvainPkg as any).default ?? louvainPkg;
const { bidirectional } = (shortestPathPkg as any).default ?? shortestPathPkg;
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';
import { extractFromFile } from './ts-extractor.js';
import { extractFromPythonFile } from './py-extractor.js';
import type {
  FileInput,
  GraphNode,
  GraphEdge,
  GraphCommunity,
  SerializedGraph,
} from './types.js';

const logger = createChildLogger({ service: 'ProjectGraphService' });

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const PY_EXTENSIONS = new Set(['.py']);
const SUPPORTED_EXTENSIONS = new Set<string>([...TS_EXTENSIONS, ...PY_EXTENSIONS]);

function pickExtractor(relPath: string): typeof extractFromFile {
  const dot = relPath.lastIndexOf('.');
  const ext = dot >= 0 ? relPath.slice(dot).toLowerCase() : '';
  if (PY_EXTENSIONS.has(ext)) return extractFromPythonFile;
  return extractFromFile;
}
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'vendor', // our own vendored skills/subagents
]);

const DEFAULT_FILE_BYTE_CAP = 512 * 1024; // 512KB — skip massive generated files

export interface BuildOptions {
  /** Hard cap on files to parse. Prevents runaway on huge repos. */
  fileLimit?: number;
  /** Per-file size ceiling in bytes. Files larger than this are skipped. */
  fileByteCap?: number;
  /** Short label saved on the row so the audit UI can show the repo
   *  basename without exposing the server path. */
  repoLabel?: string;
}

export class ProjectGraphService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Build the graph for a project from a local directory.
   *
   * Deterministic AST pass only — no LLM calls, no network. Safe to
   * run on the server. Idempotent: re-runs against an unchanged tree
   * detect the content hash and skip the upsert.
   */
  async buildFromPath(
    tenantId: string,
    projectId: string,
    repoPath: string,
    opts: BuildOptions = {},
  ): Promise<{ row: any; stats: SerializedGraph['stats']; rebuilt: boolean }> {
    const files = await collectFiles(repoPath, {
      fileLimit: opts.fileLimit ?? 5000,
      fileByteCap: opts.fileByteCap ?? DEFAULT_FILE_BYTE_CAP,
    });

    const contentHash = hashFileSet(files);
    const existing = await (this.prisma as any).projectGraph.findUnique({
      where: { projectId },
      select: { id: true, contentHash: true },
    });
    if (existing && existing.contentHash === contentHash) {
      logger.info('Project graph unchanged — skipping rebuild', {
        tenantId,
        projectId,
        contentHash,
        fileCount: files.length,
      });
      const full = await (this.prisma as any).projectGraph.findUnique({ where: { projectId } });
      const serialized = full.graphJson as SerializedGraph;
      return { row: full, stats: serialized.stats, rebuilt: false };
    }

    // — extract —
    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const allCalls: Array<{ fromId: string; calleeName: string }> = [];
    const allImports: Array<{ fromFileId: string; modulePath: string }> = [];
    let parseFailures = 0;

    for (const f of files) {
      try {
        const out = pickExtractor(f.relPath)(f);
        allNodes.push(...out.nodes);
        allEdges.push(...out.edges);
        allCalls.push(...out.unresolvedCalls);
        allImports.push(...out.imports);
      } catch (err) {
        parseFailures += 1;
        logger.debug('AST parse failed for file — skipped', {
          file: f.relPath,
          error: (err as Error).message,
        });
      }
    }

    // — resolve cross-file `calls` and `imports` —
    const resolvedCallEdges = resolveCallEdges(allNodes, allCalls);
    const resolvedImportEdges = resolveImportEdges(allNodes, allImports, repoPath);
    allEdges.push(...resolvedCallEdges, ...resolvedImportEdges);

    // — community detection + degree —
    const graphology = new Graph({ multi: false, type: 'undirected' });
    const seenNodeIds = new Set<string>();
    for (const n of allNodes) {
      if (seenNodeIds.has(n.id)) continue;
      seenNodeIds.add(n.id);
      graphology.addNode(n.id);
    }
    const seenEdgeIds = new Set<string>();
    for (const e of allEdges) {
      if (seenEdgeIds.has(e.id)) continue;
      seenEdgeIds.add(e.id);
      if (!graphology.hasNode(e.from) || !graphology.hasNode(e.to) || e.from === e.to) continue;
      // undirected + single = drop parallel edges; first-seen wins.
      if (graphology.hasEdge(e.from, e.to)) continue;
      graphology.addEdge(e.from, e.to);
    }

    // Communities (Louvain on the undirected projection).
    const communityMap: Record<string, number> =
      graphology.order > 0 ? louvain(graphology) : {};

    // Degree + community back-fill onto nodes.
    const nodesById = new Map<string, GraphNode>();
    for (const n of allNodes) {
      if (nodesById.has(n.id)) continue;
      n.degree = graphology.hasNode(n.id) ? graphology.degree(n.id) : 0;
      n.community = communityMap[n.id] ?? 0;
      nodesById.set(n.id, n);
    }

    // Community index (size + top nodes by degree).
    const commIndex = new Map<number, GraphCommunity>();
    for (const n of nodesById.values()) {
      const cid = n.community ?? 0;
      const existingC = commIndex.get(cid);
      if (existingC) {
        existingC.size += 1;
      } else {
        commIndex.set(cid, { id: cid, size: 1, topNodes: [] });
      }
    }
    for (const c of commIndex.values()) {
      c.topNodes = [...nodesById.values()]
        .filter((n) => n.community === c.id)
        .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
        .slice(0, 3)
        .map((n) => n.name);
    }

    const extractedEdges = allEdges.filter((e) => e.confidence === 'EXTRACTED').length;
    const inferredEdges = allEdges.filter((e) => e.confidence === 'INFERRED').length;

    const serialized: SerializedGraph = {
      version: 1,
      nodes: [...nodesById.values()],
      edges: dedupeEdges(allEdges),
      communities: [...commIndex.values()].sort((a, b) => b.size - a.size),
      stats: {
        nodeCount: nodesById.size,
        edgeCount: seenEdgeIds.size,
        extractedEdges,
        inferredEdges,
        fileCount: files.length,
      },
    };

    const godNodeSlugs = listGodNodes(serialized, 10).map((n) => n.id);

    // Derive the list of languages actually present in the file set.
    // Lets the audit UI badge a graph as "TS + Python" vs "TS only".
    const languages = detectLanguages(files);

    // — upsert —
    const row = await (this.prisma as any).projectGraph.upsert({
      where: { projectId },
      create: {
        tenantId,
        projectId,
        contentHash,
        graphJson: serialized as any,
        nodeCount: serialized.stats.nodeCount,
        edgeCount: serialized.stats.edgeCount,
        communityCount: serialized.communities.length,
        godNodeSlugs: godNodeSlugs as any,
        languages: languages as any,
        repoLabel: opts.repoLabel ?? null,
        repoPath, // PG.11: cached so webhook auto-refresh can replay
      },
      update: {
        contentHash,
        graphJson: serialized as any,
        nodeCount: serialized.stats.nodeCount,
        edgeCount: serialized.stats.edgeCount,
        communityCount: serialized.communities.length,
        godNodeSlugs: godNodeSlugs as any,
        languages: languages as any,
        repoLabel: opts.repoLabel ?? null,
        repoPath,
      },
    });

    logger.info('Project graph built', {
      tenantId,
      projectId,
      ...serialized.stats,
      communityCount: serialized.communities.length,
      parseFailures,
    });
    return { row, stats: serialized.stats, rebuilt: true };
  }

  /** Read the cached row. Returns null if never built. */
  async getLatest(tenantId: string, projectId: string) {
    return (await (this.prisma as any).projectGraph.findFirst({
      where: { tenantId, projectId },
    })) ?? null;
  }

  /**
   * PG.11: rebuild every graph whose cached `repoLabel` matches the
   * supplied `repoFullName` (e.g. `acme/backend`). Called by the
   * GitHub push webhook so a merge to the default branch triggers an
   * automatic graph refresh without manual re-invocation. No-op for
   * graphs that were built with a different label or never given one.
   */
  async refreshForRepo(repoFullName: string): Promise<{
    matched: number;
    rebuilt: number;
    skipped: number;
    errors: string[];
  }> {
    const result = { matched: 0, rebuilt: 0, skipped: 0, errors: [] as string[] };
    const rows = (await (this.prisma as any).projectGraph.findMany({
      where: { repoLabel: repoFullName },
      select: { tenantId: true, projectId: true, repoPath: true, repoLabel: true },
    })) as Array<{ tenantId: string; projectId: string; repoPath: string | null; repoLabel: string | null }>;

    result.matched = rows.length;
    for (const row of rows) {
      if (!row.repoPath) {
        result.skipped += 1;
        continue;
      }
      try {
        const out = await this.buildFromPath(row.tenantId, row.projectId, row.repoPath, {
          repoLabel: row.repoLabel ?? undefined,
        });
        if (out.rebuilt) result.rebuilt += 1;
        else result.skipped += 1;
      } catch (err) {
        result.errors.push(`${row.projectId}: ${(err as Error).message}`);
      }
    }
    logger.info('Project graphs refreshed from webhook', {
      repoFullName,
      ...result,
    });
    return result;
  }

  /** Read just the top-N god-node names — cheap read for planner prompt. */
  async getGodNodeNames(tenantId: string, projectId: string, limit = 5): Promise<string[]> {
    const snap = await this.getGodNodeSnapshot(tenantId, projectId, limit);
    return snap.names;
  }

  /**
   * PG.13: same as getGodNodeNames but also returns the
   * ProjectGraph.contentHash the names came from. The planner
   * stamps this hash on ExecutionPlan.graphContentHash so the audit
   * UI can tell later that the graph has been rebuilt since the plan
   * was written (the plan was built against a "stale" graph).
   */
  async getGodNodeSnapshot(
    tenantId: string,
    projectId: string,
    limit = 5,
  ): Promise<{ names: string[]; contentHash: string | null }> {
    const row = await (this.prisma as any).projectGraph.findFirst({
      where: { tenantId, projectId },
      select: { godNodeSlugs: true, graphJson: true, contentHash: true },
    });
    if (!row) return { names: [], contentHash: null };
    const ids = (row.godNodeSlugs as string[]).slice(0, limit);
    const graph = row.graphJson as SerializedGraph;
    const byId = new Map(graph.nodes.map((n) => [n.id, n.name]));
    const names = ids.map((id) => byId.get(id) ?? id).filter(Boolean);
    return { names, contentHash: row.contentHash ?? null };
  }
}

// ————————————————————————————————————————————————————————————
// pure graph-query helpers — exported so tests + agent tools can
// call them without instantiating the service.
// ————————————————————————————————————————————————————————————

/** Top-N nodes by degree. Higher degree = more central to the codebase. */
export function listGodNodes(graph: SerializedGraph, limit = 10): GraphNode[] {
  return [...graph.nodes]
    .filter((n) => n.kind !== 'file')
    .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
    .slice(0, limit);
}

/** All symbols that call into `symbolName`. */
export function findCallers(graph: SerializedGraph, symbolName: string): GraphNode[] {
  const targets = graph.nodes.filter((n) => n.name === symbolName).map((n) => n.id);
  if (targets.length === 0) return [];
  const targetSet = new Set(targets);
  const callerIds = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind !== 'calls') continue;
    if (targetSet.has(e.to)) callerIds.add(e.from);
  }
  return graph.nodes.filter((n) => callerIds.has(n.id));
}

/** Unweighted shortest path between two symbols (any edge kind). Returns
 *  the sequence of node ids, or null if no path exists. */
export function shortestPath(
  graph: SerializedGraph,
  fromName: string,
  toName: string,
): string[] | null {
  const from = graph.nodes.find((n) => n.name === fromName);
  const to = graph.nodes.find((n) => n.name === toName);
  if (!from || !to) return null;
  const g = new Graph({ multi: false, type: 'undirected' });
  for (const n of graph.nodes) g.addNode(n.id);
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (!g.hasNode(e.from) || !g.hasNode(e.to) || e.from === e.to) continue;
    const k = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
    if (seen.has(k)) continue;
    seen.add(k);
    g.addEdge(e.from, e.to);
  }
  const path = bidirectional(g, from.id, to.id);
  return path ?? null;
}

/** All symbols in the same community as `symbolName`. */
export function communityMembers(graph: SerializedGraph, symbolName: string): GraphNode[] {
  const seed = graph.nodes.find((n) => n.name === symbolName);
  if (!seed || seed.community === undefined) return [];
  return graph.nodes.filter((n) => n.community === seed.community);
}

// ————————————————————————————————————————————————————————————
// internal helpers
// ————————————————————————————————————————————————————————————

async function collectFiles(
  repoPath: string,
  limits: { fileLimit: number; fileByteCap: number },
): Promise<FileInput[]> {
  const out: FileInput[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= limits.fileLimit) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry)) continue;
      const abs = join(dir, entry);
      let info;
      try {
        info = await stat(abs);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!info.isFile()) continue;
      if (info.size > limits.fileByteCap) continue;
      const dot = entry.lastIndexOf('.');
      const ext = dot >= 0 ? entry.slice(dot).toLowerCase() : '';
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const rel = relative(repoPath, abs);
      // Declaration files (.d.ts) clutter the graph with type-only
      // shadows of real files; skip them.
      if (rel.endsWith('.d.ts')) continue;
      let contents: string;
      try {
        contents = await readFile(abs, 'utf8');
      } catch {
        continue;
      }
      out.push({ relPath: rel, absPath: abs, contents });
      if (out.length >= limits.fileLimit) return;
    }
  };
  await walk(repoPath);
  return out;
}

function hashFileSet(files: FileInput[]): string {
  const hasher = createHash('sha256');
  for (const f of [...files].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    hasher.update(f.relPath);
    hasher.update('\0');
    hasher.update(f.contents);
    hasher.update('\0');
  }
  return hasher.digest('hex');
}

/** Map an unresolved bare-name call like `foo()` to the best candidate
 *  node id in the graph. Policy: prefer an in-file match; if none,
 *  take the first lexicographic candidate so the resolution is
 *  deterministic across runs. All resulting edges are INFERRED. */
function resolveCallEdges(
  nodes: GraphNode[],
  calls: Array<{ fromId: string; calleeName: string }>,
): GraphEdge[] {
  const byName = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.kind === 'function' || n.kind === 'method') {
      const arr = byName.get(n.name) ?? [];
      arr.push(n);
      byName.set(n.name, arr);
    }
  }
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    const candidates = byName.get(call.calleeName);
    if (!candidates || candidates.length === 0) continue;
    const callerFile = call.fromId.split(':')[0];
    const preferred = candidates.find((c) => c.file === callerFile) ?? candidates[0];
    if (preferred.id === call.fromId) continue; // skip self-calls
    const id = `${call.fromId}--calls->-${preferred.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({
      id,
      from: call.fromId,
      to: preferred.id,
      kind: 'calls',
      confidence: 'INFERRED',
    });
  }
  return edges;
}

/** Map `import '../foo/bar.js'` to the file node whose relPath matches,
 *  when that import resolves inside the repo. External packages are
 *  quietly dropped — we only graph what's ours. */
function resolveImportEdges(
  nodes: GraphNode[],
  imports: Array<{ fromFileId: string; modulePath: string }>,
  _repoPath: string,
): GraphEdge[] {
  const fileNodeByRelBase = new Map<string, string>();
  for (const n of nodes) {
    if (n.kind !== 'file') continue;
    const withoutExt = stripExt(n.file);
    fileNodeByRelBase.set(withoutExt, n.id);
  }
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const imp of imports) {
    if (!imp.modulePath.startsWith('.')) continue; // external package
    const fromFilePath = imp.fromFileId.split(':')[0];
    const resolvedRel = resolveRelativeImport(fromFilePath, imp.modulePath);
    if (!resolvedRel) continue;
    const targetFileId = fileNodeByRelBase.get(resolvedRel);
    if (!targetFileId) continue;
    const id = `${imp.fromFileId}--imports->-${targetFileId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({
      id,
      from: imp.fromFileId,
      to: targetFileId,
      kind: 'imports',
      confidence: 'EXTRACTED',
    });
  }
  return edges;
}

function stripExt(p: string): string {
  const i = p.lastIndexOf('.');
  return i > p.lastIndexOf('/') ? p.slice(0, i) : p;
}

function resolveRelativeImport(fromFile: string, modulePath: string): string | null {
  // modulePath is like '../foo/bar.js' (TS source imports the .js path).
  const fromDir = fromFile.slice(0, fromFile.lastIndexOf('/'));
  const parts = (fromDir + '/' + modulePath).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  // Strip trailing .js/.ts (we mapped by name-without-extension above).
  let joined = stack.join('/');
  if (joined.endsWith('.js') || joined.endsWith('.ts')) joined = joined.slice(0, -3);
  if (joined.endsWith('.jsx') || joined.endsWith('.tsx') || joined.endsWith('.mjs') || joined.endsWith('.cjs')) {
    joined = joined.slice(0, -4);
  }
  return joined || null;
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const out: GraphEdge[] = [];
  for (const e of edges) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/** Detect language tags from the set of parsed file extensions.
 *  Exported-adjacent logic kept inline so tests don't need a separate
 *  module. */
function detectLanguages(files: FileInput[]): string[] {
  const langs = new Set<string>();
  for (const f of files) {
    const dot = f.relPath.lastIndexOf('.');
    const ext = dot >= 0 ? f.relPath.slice(dot).toLowerCase() : '';
    if (ext === '.ts' || ext === '.tsx') langs.add('typescript');
    else if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') langs.add('javascript');
    else if (ext === '.py') langs.add('python');
  }
  return [...langs].sort();
}
