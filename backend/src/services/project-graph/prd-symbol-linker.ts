/**
 * =============================================================================
 * PRD SYMBOL LINKER (PG.8)
 * =============================================================================
 *
 * After a BA agent finalizes a PRD, this service asks the tenant's
 * cheapest LLM "which project-graph symbols does this brief mention
 * or depend on?" and persists the answers as PRDSymbolLink rows.
 *
 * Outcome: every PRD can be traced back to the specific files /
 * classes / functions it references. The audit UI uses this to
 * render "code touched by this requirement" links without manual
 * tagging.
 *
 * Failure modes (all non-fatal — the PRD itself is already saved by
 * the time we get here):
 *   - No project graph built → skip silently
 *   - No LLM configured → skip silently
 *   - LLM response doesn't parse → log + skip
 *   - Partial link list → persist what parsed, drop the rest
 *
 * Credit: https://github.com/safishamsi/graphify — their
 * cross-corpus-link idea is what this implements.
 *
 * @module services/project-graph/prd-symbol-linker
 */

import { z } from 'zod';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import type { ModelRegistryService } from '../model-registry/model-registry.service.js';
import { createModelClient } from '../agent-runtime/clients/client-factory.js';
import { createChildLogger } from '../../lib/logger.js';
import { listGodNodes } from './project-graph.service.js';
import type { SerializedGraph } from './types.js';

const logger = createChildLogger({ service: 'PRDSymbolLinker' });

/** Hard cap — never link more than N symbols to one PRD. Keeps the
 *  audit UI usable and LLM response bounded. */
const MAX_LINKS = 12;

/** How many god-node candidates to show the linker. Too few = it
 *  guesses; too many = we pay for tokens on irrelevant ones. */
const CANDIDATE_LIMIT = 40;

const LinkSchema = z.object({
  symbolName: z.string().min(1).max(128),
  confidence: z.number().min(0).max(1),
});
const LinksSchema = z.object({
  links: z.array(LinkSchema).max(MAX_LINKS),
});

export interface PRDSymbolLinkerDeps {
  prisma: PrismaClient;
  modelRegistry: ModelRegistryService;
}

export interface LinkResult {
  /** What we actually wrote to PRDSymbolLink. Empty array ≠ error. */
  linksCreated: Array<{ symbolId: string; symbolName: string; confidence: number }>;
  /** True when we skipped for a non-failure reason (no graph, no LLM,
   *  nothing material referenced). Callers can surface this as "we
   *  didn't find any code symbols tied to this brief." */
  skipped: boolean;
  /** Human-readable reason for `skipped`. Nullable when skipped is false. */
  skipReason?: string;
}

export class PRDSymbolLinker {
  constructor(private readonly deps: PRDSymbolLinkerDeps) {}

  /**
   * Link one PRD to the project graph. Safe to call unconditionally
   * after a PRD is created — does nothing useful when no graph / no
   * LLM is configured, logs + returns.
   */
  async linkPrd(args: {
    tenantId: string;
    prdId: string;
    projectId: string | null;
    title: string;
    summary: string;
  }): Promise<LinkResult> {
    const { tenantId, prdId, projectId, title, summary } = args;

    if (!projectId) {
      return { linksCreated: [], skipped: true, skipReason: 'PRD has no projectId' };
    }

    const graphRow = await (this.deps.prisma as any).projectGraph.findFirst({
      where: { tenantId, projectId },
      select: { graphJson: true },
    });
    if (!graphRow) {
      return { linksCreated: [], skipped: true, skipReason: 'No project graph built' };
    }
    const graph = graphRow.graphJson as SerializedGraph;
    const candidates = listGodNodes(graph, CANDIDATE_LIMIT);
    if (candidates.length === 0) {
      return { linksCreated: [], skipped: true, skipReason: 'Project graph is empty' };
    }

    // Try to pick the cheapest tenant-configured model via the BA
    // slot (same cost-tier the rest of BA uses). Linker failures are
    // non-fatal at every level.
    let resolved;
    try {
      resolved = await this.deps.modelRegistry.resolveModel(tenantId, 'ba_agent');
    } catch (err) {
      logger.debug('PRD linker: no model configured, skipping', {
        tenantId,
        error: (err as Error).message,
      });
      return { linksCreated: [], skipped: true, skipReason: 'No LLM configured' };
    }
    if (!resolved.apiKeyEnc) {
      return { linksCreated: [], skipped: true, skipReason: 'No API key for BA model' };
    }

    let client;
    try {
      client = createModelClient(resolved.provider, {
        apiKey: resolved.apiKeyEnc,
        baseUrl: resolved.baseUrl,
      });
    } catch (err) {
      logger.warn('PRD linker: createModelClient failed, skipping', {
        tenantId,
        error: (err as Error).message,
      });
      return { linksCreated: [], skipped: true, skipReason: 'Model client build failed' };
    }

    const raw = await this.callLinker({
      client,
      modelId: resolved.modelId,
      title,
      summary,
      candidates: candidates.map((n) => ({ name: n.name, kind: n.kind })),
    }).catch((err: Error) => {
      logger.warn('PRD linker chat failed', { tenantId, error: err.message });
      return null;
    });
    if (!raw) {
      return { linksCreated: [], skipped: true, skipReason: 'Linker LLM call failed' };
    }

    const parsed = parseLinkerResponse(raw);
    if (!parsed || parsed.links.length === 0) {
      return { linksCreated: [], skipped: true, skipReason: 'Linker returned no links' };
    }

    // Resolve each name back to a node id in the graph. Drop any the
    // model made up; prefer the highest-degree match when ambiguous
    // (many functions can share a name across files).
    const byName = new Map<string, typeof graph.nodes>();
    for (const node of graph.nodes) {
      const arr = byName.get(node.name) ?? [];
      arr.push(node);
      byName.set(node.name, arr);
    }

    const created: LinkResult['linksCreated'] = [];
    for (const link of parsed.links) {
      const matches = byName.get(link.symbolName);
      if (!matches || matches.length === 0) continue;
      const chosen = [...matches].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))[0];
      try {
        await (this.deps.prisma as any).pRDSymbolLink.upsert({
          where: { prdId_symbolId: { prdId, symbolId: chosen.id } },
          create: {
            tenantId,
            prdId,
            symbolId: chosen.id,
            symbolName: chosen.name,
            confidence: link.confidence,
            source: 'auto',
          },
          update: { confidence: link.confidence },
        });
        created.push({ symbolId: chosen.id, symbolName: chosen.name, confidence: link.confidence });
      } catch (err) {
        logger.debug('PRD symbol link upsert failed (non-fatal)', {
          prdId,
          symbolId: chosen.id,
          error: (err as Error).message,
        });
      }
    }

    logger.info('PRD linked to project graph', {
      tenantId,
      prdId,
      linksCreated: created.length,
      candidatesSeen: candidates.length,
    });
    return { linksCreated: created, skipped: false };
  }

  private async callLinker(opts: {
    client: { chat: (req: any) => Promise<{ content: string }> };
    modelId: string;
    title: string;
    summary: string;
    candidates: Array<{ name: string; kind: string }>;
  }): Promise<string> {
    const systemPrompt = [
      'You map product briefs back to the code that implements them.',
      '',
      'Given a brief and a list of candidate symbols from the codebase, return JSON:',
      '{"links": [{"symbolName": "...", "confidence": 0.0-1.0}, ...]}',
      '',
      'Rules:',
      '- Only use names from the candidate list (verbatim). Do not invent symbols.',
      '- Include a symbol only if the brief plausibly references or depends on it.',
      '- Confidence reflects how certain you are the brief touches this symbol.',
      '- Include at most 12 links. Prefer 3–6 high-confidence hits over many low-confidence ones.',
      '- If nothing in the candidate list plausibly matches, return {"links": []}.',
      '- Reply JSON only, no prose, no markdown fence.',
    ].join('\n');

    const user = [
      '## Brief',
      `Title: ${opts.title}`,
      `Summary: ${opts.summary.slice(0, 2000)}`,
      '',
      '## Candidate symbols (pick from this list only)',
      ...opts.candidates.map((c) => `- ${c.name} (${c.kind})`),
      '',
      'Reply with JSON.',
    ].join('\n');

    const raw = await opts.client.chat({
      model: opts.modelId,
      systemPrompt,
      messages: [{ role: 'user', content: user }],
      tools: [],
    });
    return raw.content;
  }
}

/**
 * Parse the linker's JSON response, handling fence stripping + leading
 * preamble the same way the plan parser does. Exported for tests.
 */
export function parseLinkerResponse(text: string): z.infer<typeof LinksSchema> | null {
  if (!text) return null;
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*\n([\s\S]+?)\n```/i);
  if (fence) body = fence[1].trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) body = body.slice(start, end + 1);
  try {
    const json = JSON.parse(body);
    const result = LinksSchema.safeParse(json);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
