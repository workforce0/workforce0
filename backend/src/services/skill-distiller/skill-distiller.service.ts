/**
 * =============================================================================
 * SKILL DISTILLER — turn successful trajectories into proposed playbooks
 * =============================================================================
 *
 * Closes the half-built "learning" loop from Hermes III. We already record
 * AgentOutcome rows on every task (approved / revised / rejected) with the
 * tool sequence the agent used. This service reads that table, clusters
 * the approved runs by (agentType, tool-sequence signature), picks the
 * top repeated patterns, asks Gemini to propose a reusable skill as a
 * markdown playbook, and writes the result as a LearnedSkill row with
 * status="candidate".
 *
 * An admin then flips candidate → active (or demoted) via the existing
 * /api/admin/learned-skills routes. Active skills get injected into the
 * relevant agent's prompt on every invocation (the skills loader already
 * picks them up from the LearnedSkill table).
 *
 * The loop closes **with human approval**, not autonomously — a runaway
 * agent that hallucinates a "skill" can't get promoted without someone
 * clicking a button. See docs/plans/tier-3-autonomous-multi-agent-chat.md
 * (risk R5, the trust bar) for why.
 *
 * Scheduled cadence: run once per day per tenant via CronSchedulerService.
 *
 * @module services/skill-distiller
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import type { GeminiService } from '../ai/gemini.service.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'SkillDistiller' });

/** Minimum number of approved runs needed in a cluster before we bother
 *  proposing a skill. Below this, we don't have enough evidence. */
const MIN_CLUSTER_SIZE = 3;

/** Pull outcomes from the last N days when looking for patterns. */
const LOOKBACK_DAYS = 30;

/** Cap proposals per run so a single invocation doesn't fan out a bunch
 *  of duplicate candidates into the admin queue. */
const MAX_CANDIDATES_PER_RUN = 5;

/** Skip patterns we've already proposed recently — avoid duplicate
 *  candidates cluttering the admin UI. */
const DEDUP_WINDOW_DAYS = 14;

export interface TrajectoryCluster {
  agentType: string;
  /** Hash of the tool-use signature (e.g. "read_prd|create_prd|ask_clarification"). */
  signature: string;
  /** Distinct examples we saw. */
  examples: Array<{
    taskId: string;
    toolsUsed: string[];
    stepCount: number;
    confidenceScore: number;
  }>;
}

export interface DistillResult {
  scanned: number;
  clusters: number;
  proposed: number;
  skipped: number;
}

/**
 * Groups outcomes by (agentType, toolSignature) and returns clusters big
 * enough to be candidates. Pure function — exported for tests.
 */
export function clusterOutcomes(
  outcomes: Array<{
    agentType: string;
    taskId: string;
    toolsUsed: unknown;
    stepCount: number | null;
    confidenceScore: number;
    result: string;
  }>,
): TrajectoryCluster[] {
  const buckets = new Map<string, TrajectoryCluster>();
  for (const o of outcomes) {
    if (o.result !== 'approved') continue;
    const tools = Array.isArray(o.toolsUsed) ? (o.toolsUsed as string[]) : [];
    if (tools.length === 0) continue;
    const signature = tools.join('|');
    const key = `${o.agentType}::${signature}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.examples.push({
        taskId: o.taskId,
        toolsUsed: tools,
        stepCount: o.stepCount ?? tools.length,
        confidenceScore: o.confidenceScore,
      });
    } else {
      buckets.set(key, {
        agentType: o.agentType,
        signature,
        examples: [
          {
            taskId: o.taskId,
            toolsUsed: tools,
            stepCount: o.stepCount ?? tools.length,
            confidenceScore: o.confidenceScore,
          },
        ],
      });
    }
  }
  return [...buckets.values()]
    .filter((c) => c.examples.length >= MIN_CLUSTER_SIZE)
    .sort((a, b) => b.examples.length - a.examples.length);
}

/**
 * Builds the prompt we send to Gemini to turn a cluster into a reusable
 * skill. Kept small + deterministic.
 */
export function buildDistillerPrompt(cluster: TrajectoryCluster): string {
  const avgConfidence =
    cluster.examples.reduce((a, e) => a + e.confidenceScore, 0) / cluster.examples.length;
  const avgSteps =
    cluster.examples.reduce((a, e) => a + e.stepCount, 0) / cluster.examples.length;

  return [
    `You are helping the Workforce0 team distill a recurring, **successful** pattern into a reusable skill.`,
    '',
    `Agent role: ${cluster.agentType}`,
    `Tool sequence: ${cluster.signature}`,
    `Observed ${cluster.examples.length} times in the last 30 days.`,
    `Average confidence: ${avgConfidence.toFixed(2)}`,
    `Average steps: ${avgSteps.toFixed(1)}`,
    '',
    'Write a Markdown skill playbook that:',
    '  - Starts with an H1 title naming the pattern',
    '  - Has a 1-line "When to use" section',
    '  - Lists the tool sequence in order, one bullet per step, each with a one-line reason',
    '  - Ends with a short "Expected outcome" paragraph',
    '',
    'Keep the total playbook under 250 words. Return ONLY the markdown, no preamble.',
  ].join('\n');
}

export class SkillDistillerService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gemini: GeminiService,
  ) {}

  /** Has this signature already been proposed recently? Avoids dup spam. */
  private async alreadyProposed(agentType: string, signature: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recent = await (this.prisma as any).learnedSkill.findFirst({
      where: {
        target: agentType,
        createdAt: { gt: cutoff },
        // We stamp the signature into the content so we can look it up;
        // that's simpler than adding a column + migration.
        content: { contains: `<!-- signature: ${signature} -->` },
      },
      select: { id: true },
    });
    return recent !== null;
  }

  /**
   * Run one distillation pass. Safe to invoke repeatedly — dedup guard
   * prevents duplicate candidates from landing in the admin queue.
   */
  async distill(): Promise<DistillResult> {
    if ((this.gemini as unknown as { disabled: boolean }).disabled) {
      logger.info('Distiller skipped — Gemini not configured');
      return { scanned: 0, clusters: 0, proposed: 0, skipped: 0 };
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const outcomes = await (this.prisma as any).agentOutcome.findMany({
      where: { createdAt: { gt: since } },
      select: {
        agentType: true,
        taskId: true,
        toolsUsed: true,
        stepCount: true,
        confidenceScore: true,
        result: true,
      },
      take: 5000,
    });

    const clusters = clusterOutcomes(outcomes);
    logger.info('Clustered outcomes', {
      scanned: outcomes.length,
      clusters: clusters.length,
    });

    let proposed = 0;
    let skipped = 0;
    for (const cluster of clusters.slice(0, MAX_CANDIDATES_PER_RUN)) {
      if (await this.alreadyProposed(cluster.agentType, cluster.signature)) {
        skipped += 1;
        continue;
      }

      let markdown: string;
      try {
        markdown = (await this.gemini.generateFreeformText(buildDistillerPrompt(cluster))).trim();
      } catch (err) {
        logger.warn('Gemini distillation call failed', { err: (err as Error).message });
        skipped += 1;
        continue;
      }

      // Append a tracer comment so alreadyProposed() can find this later.
      const content = `${markdown}\n\n<!-- signature: ${cluster.signature} -->`;

      // Derive a human-readable name from the first-line H1 if present.
      const nameMatch = markdown.match(/^#\s+(.+)$/m);
      const name = (nameMatch?.[1] ?? `${cluster.agentType} pattern: ${cluster.signature.slice(0, 60)}`).trim();

      const positiveRate = cluster.examples.filter((e) => e.confidenceScore >= 0.8).length /
        cluster.examples.length;

      await (this.prisma as any).learnedSkill.create({
        data: {
          name,
          content,
          target: cluster.agentType,
          confidence: Number(positiveRate.toFixed(2)),
          sourceOutcomes: cluster.examples.length,
          positiveRate: Number(positiveRate.toFixed(2)),
          status: 'candidate',
        },
      });
      proposed += 1;
    }

    logger.info('Distill pass complete', {
      scanned: outcomes.length,
      clusters: clusters.length,
      proposed,
      skipped,
    });
    return {
      scanned: outcomes.length,
      clusters: clusters.length,
      proposed,
      skipped,
    };
  }
}
