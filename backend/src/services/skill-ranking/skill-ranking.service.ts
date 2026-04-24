/**
 * =============================================================================
 * SKILL RANKING — feed outcomes back into learned-skill confidence
 * =============================================================================
 *
 * Closes the other half of the Hermes learning loop. OutcomeObserver
 * already records every task's result (approved / revised / rejected).
 * This service reads those outcomes on a cadence and adjusts the
 * confidence score of each active LearnedSkill — skills whose target
 * agent is succeeding climb, skills backing a failing agent drop. When
 * a skill's confidence dips below the demote threshold it auto-moves
 * to status="demoted" and stops being injected into agent prompts.
 *
 * Blunt but useful: we don't have per-skill attribution (we never
 * stamped "skill X was in the prompt for task Y"), so the signal is
 * the target-agent's overall success rate since the last recompute.
 * Good enough to keep stale or counter-productive skills from hanging
 * around without a human noticing.
 *
 * Ordering guarantees:
 *   - A skill is never auto-promoted from 'demoted' back to 'active'.
 *     Humans re-promote via PATCH /admin/learned-skills/:id.
 *   - Confidence is clamped to [0, 1].
 *   - positiveRate / negativeRate reflect the LAST recompute window
 *     (not lifetime), so admins can watch trends.
 *
 * @module services/skill-ranking
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'SkillRanking' });

/** How far back to look for outcomes when recomputing. */
const WINDOW_DAYS = 14;

/** Clamp bounds. */
const MAX_CONFIDENCE = 1.0;
const MIN_CONFIDENCE = 0.0;

/** Threshold below which we demote an active skill. */
const DEMOTE_BELOW = 0.2;

/** Thresholds + deltas. Small, deliberate nudges — a single recompute
 *  shouldn't whipsaw a skill from active to demoted or vice versa. */
const HIGH_SUCCESS_RATE = 0.8;
const LOW_SUCCESS_RATE = 0.5;
const BUMP = 0.05;
const DROP = 0.1;

/** Minimum outcomes required before we'll adjust at all. Below this,
 *  the signal is too noisy and we let the confidence sit. */
const MIN_OUTCOMES = 5;

export interface RecomputeResult {
  /** Active learned skills we looked at. */
  scanned: number;
  /** Skills whose confidence we bumped up. */
  bumped: number;
  /** Skills whose confidence we dropped. */
  dropped: number;
  /** Skills auto-demoted because confidence fell below threshold. */
  demoted: number;
  /** Skills untouched because there weren't enough outcomes to judge. */
  skipped: number;
}

/**
 * Pure helper: given (approvals, totals), return the next confidence
 * score given a previous one. Exported so tests can lock in the shape
 * without instantiating Prisma.
 *
 * Rules:
 *   - If totals < MIN_OUTCOMES: return previous (too noisy).
 *   - If success rate >= HIGH_SUCCESS_RATE: +BUMP (capped at 1.0).
 *   - If success rate <= LOW_SUCCESS_RATE: -DROP (floored at 0.0).
 *   - Otherwise: no change.
 */
export function nextConfidence(
  previous: number,
  approvals: number,
  totals: number,
): number {
  if (totals < MIN_OUTCOMES) return previous;
  const rate = approvals / totals;
  if (rate >= HIGH_SUCCESS_RATE) return Math.min(MAX_CONFIDENCE, previous + BUMP);
  if (rate <= LOW_SUCCESS_RATE) return Math.max(MIN_CONFIDENCE, previous - DROP);
  return previous;
}

/** Whether the new confidence crosses the demote threshold (after update). */
export function shouldDemote(confidence: number): boolean {
  return confidence < DEMOTE_BELOW;
}

export class SkillRankingService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Run one recompute pass across every active learned skill. Safe to
   * call repeatedly — deltas are small and a repeat call with no new
   * outcomes is a no-op.
   */
  async recompute(): Promise<RecomputeResult> {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Pull distinct agentTypes from outcomes so we only query what we need.
    const recentOutcomes = await (this.prisma as any).agentOutcome.findMany({
      where: { createdAt: { gt: since } },
      select: { agentType: true, result: true },
      take: 10000,
    });

    // Aggregate per agentType.
    const stats = new Map<string, { approvals: number; totals: number }>();
    for (const o of recentOutcomes as Array<{ agentType: string; result: string }>) {
      const bucket = stats.get(o.agentType) ?? { approvals: 0, totals: 0 };
      bucket.totals += 1;
      if (o.result === 'approved') bucket.approvals += 1;
      stats.set(o.agentType, bucket);
    }

    const activeSkills = await (this.prisma as any).learnedSkill.findMany({
      where: { status: 'active' },
    });

    let bumped = 0;
    let dropped = 0;
    let demoted = 0;
    let skipped = 0;

    for (const skill of activeSkills as Array<{
      id: string;
      target: string;
      confidence: number;
      positiveRate: number | null;
      negativeRate: number | null;
    }>) {
      // Look up the target agent's recent numbers. If the skill targets
      // "all" we use the sum across every agent type.
      const bucket = skill.target === 'all'
        ? [...stats.values()].reduce(
            (acc, s) => ({ approvals: acc.approvals + s.approvals, totals: acc.totals + s.totals }),
            { approvals: 0, totals: 0 },
          )
        : stats.get(skill.target) ?? { approvals: 0, totals: 0 };

      if (bucket.totals < MIN_OUTCOMES) {
        skipped += 1;
        continue;
      }

      const nextConf = nextConfidence(skill.confidence, bucket.approvals, bucket.totals);
      const rate = bucket.approvals / bucket.totals;
      const shouldDemoteSkill = shouldDemote(nextConf);

      if (nextConf === skill.confidence && !shouldDemoteSkill) {
        skipped += 1;
        continue;
      }

      await (this.prisma as any).learnedSkill.update({
        where: { id: skill.id },
        data: {
          confidence: nextConf,
          positiveRate: Number(rate.toFixed(3)),
          negativeRate: Number((1 - rate).toFixed(3)),
          ...(shouldDemoteSkill ? { status: 'demoted' } : {}),
        },
      });

      if (shouldDemoteSkill) demoted += 1;
      else if (nextConf > skill.confidence) bumped += 1;
      else if (nextConf < skill.confidence) dropped += 1;
    }

    logger.info('Skill ranking recomputed', {
      scanned: activeSkills.length,
      bumped,
      dropped,
      demoted,
      skipped,
    });
    return {
      scanned: activeSkills.length,
      bumped,
      dropped,
      demoted,
      skipped,
    };
  }
}
