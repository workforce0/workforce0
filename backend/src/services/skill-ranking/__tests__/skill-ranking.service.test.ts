import { describe, it, expect, vi } from 'vitest';
import {
  SkillRankingService,
  nextConfidence,
  shouldDemote,
} from '../skill-ranking.service.js';

describe('nextConfidence', () => {
  it('returns previous when sample is too small', () => {
    expect(nextConfidence(0.5, 4, 4)).toBe(0.5);
  });

  it('bumps up on high success rate (>= 0.8)', () => {
    expect(nextConfidence(0.5, 9, 10)).toBeCloseTo(0.55, 5);
    expect(nextConfidence(0.5, 8, 10)).toBeCloseTo(0.55, 5);
  });

  it('drops on low success rate (<= 0.5)', () => {
    expect(nextConfidence(0.5, 5, 10)).toBeCloseTo(0.4, 5);
    expect(nextConfidence(0.5, 3, 10)).toBeCloseTo(0.4, 5);
  });

  it('does nothing on middle success rate (0.5 < rate < 0.8)', () => {
    expect(nextConfidence(0.5, 6, 10)).toBe(0.5);
    expect(nextConfidence(0.5, 7, 10)).toBe(0.5);
  });

  it('clamps to 1.0 on bump', () => {
    expect(nextConfidence(0.99, 10, 10)).toBe(1.0);
  });

  it('clamps to 0.0 on drop', () => {
    expect(nextConfidence(0.05, 0, 10)).toBe(0.0);
  });
});

describe('shouldDemote', () => {
  it.each([
    [0.19, true],
    [0.2, false],
    [0.0, true],
    [1.0, false],
  ])('confidence %s -> demote %s', (conf, expected) => {
    expect(shouldDemote(conf)).toBe(expected);
  });
});

describe('SkillRankingService.recompute', () => {
  function makePrisma(opts: {
    outcomes?: Array<{ agentType: string; result: string }>;
    skills?: Array<{
      id: string;
      target: string;
      confidence: number;
      positiveRate: number | null;
      negativeRate: number | null;
    }>;
  } = {}) {
    const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
    return {
      updates,
      prisma: {
        agentOutcome: {
          findMany: vi.fn().mockResolvedValue(opts.outcomes ?? []),
        },
        learnedSkill: {
          findMany: vi.fn().mockResolvedValue(opts.skills ?? []),
          update: vi.fn(async ({ where, data }) => {
            updates.push({ where, data });
            return { id: where.id, ...data };
          }),
        },
      },
    };
  }

  it('skips when there are not enough outcomes for an agent type', async () => {
    // Only 3 outcomes, MIN_OUTCOMES is 5
    const { prisma, updates } = makePrisma({
      outcomes: Array.from({ length: 3 }, () => ({ agentType: 'ba', result: 'approved' })),
      skills: [
        {
          id: 's-1',
          target: 'ba',
          confidence: 0.5,
          positiveRate: null,
          negativeRate: null,
        },
      ],
    });
    const svc = new SkillRankingService(prisma as any);
    const result = await svc.recompute();
    expect(result).toMatchObject({ scanned: 1, bumped: 0, dropped: 0, demoted: 0, skipped: 1 });
    expect(updates).toHaveLength(0);
  });

  it('bumps confidence on a high success rate', async () => {
    const { prisma, updates } = makePrisma({
      outcomes: Array.from({ length: 10 }, (_, i) => ({
        agentType: 'ba',
        result: i < 9 ? 'approved' : 'rejected',
      })),
      skills: [
        { id: 's-1', target: 'ba', confidence: 0.5, positiveRate: null, negativeRate: null },
      ],
    });
    const svc = new SkillRankingService(prisma as any);
    const result = await svc.recompute();
    expect(result).toMatchObject({ bumped: 1, dropped: 0, demoted: 0 });
    expect(updates[0]!.data.confidence).toBeCloseTo(0.55, 5);
    expect(updates[0]!.data.positiveRate).toBe(0.9);
    expect(updates[0]!.data.negativeRate).toBe(0.1);
  });

  it('drops confidence on a low success rate', async () => {
    const { prisma, updates } = makePrisma({
      outcomes: Array.from({ length: 10 }, (_, i) => ({
        agentType: 'ba',
        result: i < 3 ? 'approved' : 'rejected',
      })),
      skills: [
        { id: 's-1', target: 'ba', confidence: 0.5, positiveRate: null, negativeRate: null },
      ],
    });
    const svc = new SkillRankingService(prisma as any);
    const result = await svc.recompute();
    expect(result).toMatchObject({ dropped: 1 });
    expect(updates[0]!.data.confidence).toBeCloseTo(0.4, 5);
  });

  it('auto-demotes a skill whose confidence crosses below threshold', async () => {
    const { prisma, updates } = makePrisma({
      outcomes: Array.from({ length: 10 }, () => ({ agentType: 'ba', result: 'rejected' })),
      skills: [
        { id: 's-1', target: 'ba', confidence: 0.25, positiveRate: null, negativeRate: null },
      ],
    });
    const svc = new SkillRankingService(prisma as any);
    const result = await svc.recompute();
    // 0.25 - 0.1 = 0.15 < 0.2 -> demote
    expect(result).toMatchObject({ demoted: 1, dropped: 0 });
    expect(updates[0]!.data.confidence).toBeCloseTo(0.15, 5);
    expect(updates[0]!.data.status).toBe('demoted');
  });

  it('aggregates across agents for a skill targeting "all"', async () => {
    const { prisma, updates } = makePrisma({
      outcomes: [
        ...Array.from({ length: 8 }, () => ({ agentType: 'ba', result: 'approved' })),
        ...Array.from({ length: 4 }, () => ({ agentType: 'dev', result: 'approved' })),
        ...Array.from({ length: 2 }, () => ({ agentType: 'dev', result: 'rejected' })),
      ],
      skills: [
        { id: 's-1', target: 'all', confidence: 0.6, positiveRate: null, negativeRate: null },
      ],
    });
    const svc = new SkillRankingService(prisma as any);
    const result = await svc.recompute();
    // 12 approved / 14 total >= 0.8 -> bump
    expect(result).toMatchObject({ bumped: 1 });
    expect(updates[0]!.data.confidence).toBeCloseTo(0.65, 5);
  });

  it('does not touch skills when no outcomes were recorded', async () => {
    const { prisma, updates } = makePrisma({
      outcomes: [],
      skills: [
        { id: 's-1', target: 'dev', confidence: 0.5, positiveRate: null, negativeRate: null },
      ],
    });
    const svc = new SkillRankingService(prisma as any);
    const result = await svc.recompute();
    expect(result).toMatchObject({ scanned: 1, bumped: 0, dropped: 0, demoted: 0, skipped: 1 });
    expect(updates).toHaveLength(0);
  });
});
