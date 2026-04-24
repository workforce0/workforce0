/**
 * Build the domain-aware Whisper prompt for a tenant / project.
 *
 * The string is passed to OpenAI Whisper's `prompt` parameter — a
 * decoder hint that biases transcription toward the supplied vocabulary.
 * Particularly useful for product-specific jargon ("BAAgent" vs "BA
 * agent" vs "VA agent") and code-adjacent terms ("TicketService",
 * "projectGraph", "N6 cutover").
 *
 * Sources we pull terms from:
 *   1. Project graph god nodes (the most-connected symbols in the
 *      tenant's codebase — the terms most likely to come up in
 *      engineering meetings).
 *   2. Active skills from the library (tenant-scoped + global).
 *   3. Recent PRD titles (last 30 days — captures feature language
 *      in use right now).
 *
 * All three are optional — missing any one is fine, the prompt
 * degrades to whatever was available. Whisper's prompt field hard-
 * caps at ~224 tokens; we pack terms greedily and stop at ~900 chars
 * to leave headroom.
 *
 * Credit: the corpus-derived domain-prompt trick is directly inspired
 * by https://github.com/safishamsi/graphify (credited in the README).
 *
 * @module services/transcription/domain-prompt
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import type { ProjectGraphService } from '../project-graph/project-graph.service.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'DomainPromptBuilder' });

const PROMPT_CHAR_BUDGET = 900;
const GOD_NODE_LIMIT = 12;
const SKILL_LIMIT = 10;
const PRD_LIMIT = 10;

export interface DomainPromptDeps {
  prisma: PrismaClient;
  projectGraphService?: ProjectGraphService;
}

export class DomainPromptBuilder {
  constructor(private readonly deps: DomainPromptDeps) {}

  /**
   * Build a comma-separated term list for Whisper's `prompt` field.
   * Returns an empty string when we can't pull any useful terms —
   * the caller should skip setting the prompt in that case.
   */
  async buildForTenant(tenantId: string, projectId?: string | null): Promise<string> {
    const terms = new Set<string>();

    if (projectId && this.deps.projectGraphService) {
      try {
        const godNodes = await this.deps.projectGraphService.getGodNodeNames(
          tenantId,
          projectId,
          GOD_NODE_LIMIT,
        );
        for (const name of godNodes) {
          if (name) terms.add(name);
        }
      } catch (err) {
        logger.debug('God-node lookup failed while building domain prompt', {
          tenantId,
          projectId,
          error: (err as Error).message,
        });
      }
    }

    try {
      const skills = (await (this.deps.prisma as any).skillPackage.findMany({
        where: {
          status: 'active',
          OR: [{ tenantId }, { tenantId: null }],
        },
        select: { slug: true },
        orderBy: { updatedAt: 'desc' },
        take: SKILL_LIMIT,
      })) as Array<{ slug: string }>;
      for (const s of skills) {
        if (s.slug) terms.add(s.slug);
      }
    } catch (err) {
      logger.debug('Skill lookup failed while building domain prompt', {
        tenantId,
        error: (err as Error).message,
      });
    }

    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const prds = (await (this.deps.prisma as any).pRD.findMany({
        where: {
          tenantId,
          createdAt: { gte: since },
          ...(projectId ? { projectId } : {}),
        },
        select: { title: true },
        orderBy: { createdAt: 'desc' },
        take: PRD_LIMIT,
      })) as Array<{ title: string }>;
      for (const p of prds) {
        if (p.title) terms.add(p.title);
      }
    } catch (err) {
      logger.debug('PRD lookup failed while building domain prompt', {
        tenantId,
        error: (err as Error).message,
      });
    }

    return packIntoBudget([...terms], PROMPT_CHAR_BUDGET);
  }
}

/**
 * Greedy-pack terms into a comma-separated string without exceeding
 * the byte budget. Exported for unit tests.
 */
export function packIntoBudget(terms: string[], budget: number): string {
  const clean = terms.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  const parts: string[] = [];
  let used = 0;
  for (const term of clean) {
    const add = parts.length === 0 ? term : `, ${term}`;
    if (used + add.length > budget) break;
    parts.push(term);
    used += add.length;
  }
  return parts.join(', ');
}
