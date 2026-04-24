import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  ProjectGraphService,
  listGodNodes,
  findCallers,
  shortestPath,
  communityMembers,
} from '../project-graph.service.js';
import type { SerializedGraph, GraphNode, GraphEdge } from '../types.js';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fakeGraph(overrides: Partial<SerializedGraph> = {}): SerializedGraph {
  const nodes: GraphNode[] = [
    { id: 'f1:file:a.ts', kind: 'file', name: 'a.ts', file: 'f1', line: 1, degree: 2, community: 0 },
    { id: 'a:function:doThing', kind: 'function', name: 'doThing', file: 'f1', line: 5, degree: 4, community: 0 },
    { id: 'a:function:helper', kind: 'function', name: 'helper', file: 'f1', line: 10, degree: 3, community: 0 },
    { id: 'b:file:b.ts', kind: 'file', name: 'b.ts', file: 'b', line: 1, degree: 1, community: 1 },
    { id: 'b:function:unrelated', kind: 'function', name: 'unrelated', file: 'b', line: 1, degree: 1, community: 1 },
  ];
  const edges: GraphEdge[] = [
    { id: 'e1', from: 'a:function:doThing', to: 'a:function:helper', kind: 'calls', confidence: 'INFERRED' },
    { id: 'e2', from: 'f1:file:a.ts', to: 'a:function:doThing', kind: 'contains', confidence: 'EXTRACTED' },
    { id: 'e3', from: 'f1:file:a.ts', to: 'a:function:helper', kind: 'contains', confidence: 'EXTRACTED' },
    { id: 'e4', from: 'b:file:b.ts', to: 'b:function:unrelated', kind: 'contains', confidence: 'EXTRACTED' },
  ];
  return {
    version: 1,
    nodes,
    edges,
    communities: [
      { id: 0, size: 3, topNodes: ['doThing', 'helper', 'a.ts'] },
      { id: 1, size: 2, topNodes: ['unrelated', 'b.ts'] },
    ],
    stats: { nodeCount: 5, edgeCount: 4, extractedEdges: 3, inferredEdges: 1, fileCount: 2 },
    ...overrides,
  };
}

describe('listGodNodes', () => {
  it('returns top-N non-file nodes by degree, descending', () => {
    const g = fakeGraph();
    const top = listGodNodes(g, 2);
    expect(top.map((n) => n.name)).toEqual(['doThing', 'helper']);
    expect(top.every((n) => n.kind !== 'file')).toBe(true);
  });

  it('defaults to a limit of 10 when unspecified', () => {
    const g = fakeGraph();
    expect(listGodNodes(g).length).toBeLessThanOrEqual(10);
  });
});

describe('findCallers', () => {
  it('returns the symbols that call the target name', () => {
    const g = fakeGraph();
    const callers = findCallers(g, 'helper');
    expect(callers.map((n) => n.name)).toEqual(['doThing']);
  });

  it('returns [] for a symbol that no-one calls', () => {
    const g = fakeGraph();
    expect(findCallers(g, 'unrelated')).toEqual([]);
  });

  it('returns [] for an unknown name', () => {
    const g = fakeGraph();
    expect(findCallers(g, 'nope')).toEqual([]);
  });
});

describe('shortestPath', () => {
  it('returns the sequence of node ids between two connected symbols', () => {
    const g = fakeGraph();
    const path = shortestPath(g, 'doThing', 'helper');
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThanOrEqual(2);
    expect(path![0]).toBe('a:function:doThing');
    expect(path![path!.length - 1]).toBe('a:function:helper');
  });

  it('returns null when either endpoint is unknown', () => {
    const g = fakeGraph();
    expect(shortestPath(g, 'doThing', 'doesNotExist')).toBeNull();
    expect(shortestPath(g, 'doesNotExist', 'helper')).toBeNull();
  });

  it('returns null when no path exists between components', () => {
    const g = fakeGraph();
    // doThing (community 0) and unrelated (community 1) are in
    // separate connected components in this fixture.
    expect(shortestPath(g, 'doThing', 'unrelated')).toBeNull();
  });
});

describe('communityMembers', () => {
  it('returns all symbols that share a community with the seed', () => {
    const g = fakeGraph();
    const members = communityMembers(g, 'doThing').map((n) => n.name).sort();
    expect(members).toEqual(['a.ts', 'doThing', 'helper']);
  });

  it('returns [] when the seed is unknown', () => {
    const g = fakeGraph();
    expect(communityMembers(g, 'nope')).toEqual([]);
  });
});

describe('ProjectGraphService.buildFromPath', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a graph from a temp directory with TS files, upserts into Prisma, returns stats', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pg-test-'));
    await mkdir(join(tmp, 'src'));
    await writeFile(
      join(tmp, 'src', 'svc.ts'),
      `
        export class Svc {
          public doThing() { return this.helper(); }
          private helper() { return 1; }
        }
        export function greet(n: string) { return \`hi \${n}\`; }
      `,
    );
    await writeFile(
      join(tmp, 'src', 'caller.ts'),
      `
        import { Svc } from './svc.js';
        export function useIt() { const s = new Svc(); return s.doThing(); }
      `,
    );

    const prismaMock: any = {
      projectGraph: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }: any) => ({ id: 'pg-1', ...create })),
      },
    };
    const svc = new ProjectGraphService(prismaMock);
    const result = await svc.buildFromPath('t1', 'proj-1', tmp, { repoLabel: 'pg-test' });
    expect(result.rebuilt).toBe(true);
    expect(result.stats.fileCount).toBe(2);
    expect(result.stats.nodeCount).toBeGreaterThanOrEqual(6);
    expect(result.stats.edgeCount).toBeGreaterThanOrEqual(3);
    expect(prismaMock.projectGraph.upsert).toHaveBeenCalledTimes(1);
  });

  it('early-exits without an upsert when content hash matches', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pg-test-'));
    await mkdir(join(tmp, 'src'));
    await writeFile(join(tmp, 'src', 'x.ts'), 'export const a = 1;');

    // First build: no existing row, so upsert runs. Capture the hash
    // by spying on upsert args.
    let lastHash = '';
    let lastGraphJson: any = null;
    const prismaMock: any = {
      projectGraph: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }: any) => {
          lastHash = create.contentHash;
          lastGraphJson = create.graphJson;
          return { id: 'pg-1', ...create };
        }),
      },
    };
    const svc = new ProjectGraphService(prismaMock);
    await svc.buildFromPath('t1', 'proj-1', tmp);
    expect(prismaMock.projectGraph.upsert).toHaveBeenCalledTimes(1);

    // Second build: findUnique returns the captured hash → service
    // short-circuits.
    prismaMock.projectGraph.findUnique = vi.fn(async ({ select }: any) => {
      if (select && select.contentHash) return { id: 'pg-1', contentHash: lastHash };
      return { id: 'pg-1', contentHash: lastHash, graphJson: lastGraphJson };
    });
    const upsertCallsBefore = prismaMock.projectGraph.upsert.mock.calls.length;
    const second = await svc.buildFromPath('t1', 'proj-1', tmp);
    expect(second.rebuilt).toBe(false);
    expect(prismaMock.projectGraph.upsert.mock.calls.length).toBe(upsertCallsBefore); // no new upsert
  });

  it('skips ignored directories (node_modules, .git, vendor)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pg-test-'));
    await mkdir(join(tmp, 'node_modules'));
    await mkdir(join(tmp, 'vendor'));
    await mkdir(join(tmp, 'src'));
    await writeFile(join(tmp, 'node_modules', 'lib.ts'), 'export const a = 1;');
    await writeFile(join(tmp, 'vendor', 'v.ts'), 'export const b = 2;');
    await writeFile(join(tmp, 'src', 'x.ts'), 'export const c = 3;');

    const prismaMock: any = {
      projectGraph: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }: any) => ({ id: 'pg-1', ...create })),
      },
    };
    const svc = new ProjectGraphService(prismaMock);
    const result = await svc.buildFromPath('t1', 'proj-1', tmp);
    expect(result.stats.fileCount).toBe(1); // only src/x.ts
  });
});

describe('ProjectGraphService.getGodNodeNames', () => {
  it('returns the top-N god-node NAMES for prompt enrichment', async () => {
    const prismaMock: any = {
      projectGraph: {
        findFirst: vi.fn(async () => ({
          godNodeSlugs: ['a:function:doThing', 'a:function:helper'],
          graphJson: fakeGraph(),
          contentHash: 'hash-1',
        })),
      },
    };
    const svc = new ProjectGraphService(prismaMock);
    const names = await svc.getGodNodeNames('t1', 'p1', 5);
    expect(names).toEqual(['doThing', 'helper']);
  });

  it('returns [] for a project with no graph', async () => {
    const prismaMock: any = {
      projectGraph: { findFirst: vi.fn(async () => null) },
    };
    const svc = new ProjectGraphService(prismaMock);
    expect(await svc.getGodNodeNames('t1', 'p1')).toEqual([]);
  });
});

describe('ProjectGraphService.getGodNodeSnapshot', () => {
  it('returns names + the current contentHash so the planner can stamp staleness', async () => {
    const prismaMock: any = {
      projectGraph: {
        findFirst: vi.fn(async () => ({
          godNodeSlugs: ['a:function:doThing', 'a:function:helper'],
          graphJson: fakeGraph(),
          contentHash: 'abc123',
        })),
      },
    };
    const svc = new ProjectGraphService(prismaMock);
    const snap = await svc.getGodNodeSnapshot('t1', 'p1', 5);
    expect(snap.names).toEqual(['doThing', 'helper']);
    expect(snap.contentHash).toBe('abc123');
  });

  it('returns empty names + null hash when the project has no graph', async () => {
    const prismaMock: any = {
      projectGraph: { findFirst: vi.fn(async () => null) },
    };
    const svc = new ProjectGraphService(prismaMock);
    const snap = await svc.getGodNodeSnapshot('t1', 'p1');
    expect(snap).toEqual({ names: [], contentHash: null });
  });
});
