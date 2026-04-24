import { describe, it, expect, vi } from 'vitest';
import {
  SkillDistillerService,
  clusterOutcomes,
  buildDistillerPrompt,
} from '../skill-distiller.service.js';

function outcome(overrides: Partial<{
  agentType: string;
  taskId: string;
  toolsUsed: string[] | unknown;
  stepCount: number | null;
  confidenceScore: number;
  result: string;
}> = {}) {
  return {
    agentType: 'ba',
    taskId: `task-${Math.random().toString(36).slice(2, 8)}`,
    toolsUsed: ['read_prd', 'create_prd'],
    stepCount: 2,
    confidenceScore: 0.9,
    result: 'approved',
    ...overrides,
  };
}

describe('clusterOutcomes', () => {
  it('groups approved outcomes with identical tool signatures', () => {
    const outcomes = [
      outcome({ agentType: 'ba' }),
      outcome({ agentType: 'ba' }),
      outcome({ agentType: 'ba' }),
    ];
    const clusters = clusterOutcomes(outcomes);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.examples).toHaveLength(3);
    expect(clusters[0]!.signature).toBe('read_prd|create_prd');
  });

  it('ignores non-approved outcomes', () => {
    const outcomes = [
      outcome({ result: 'rejected' }),
      outcome({ result: 'rejected' }),
      outcome({ result: 'revised' }),
    ];
    expect(clusterOutcomes(outcomes)).toEqual([]);
  });

  it('drops outcomes with empty or non-array toolsUsed', () => {
    const outcomes = [
      outcome({ toolsUsed: [] }),
      outcome({ toolsUsed: null }),
      outcome({ toolsUsed: {} }),
    ];
    expect(clusterOutcomes(outcomes)).toEqual([]);
  });

  it('filters clusters below the minimum size', () => {
    const outcomes = [
      outcome({ toolsUsed: ['a', 'b'] }),
      outcome({ toolsUsed: ['a', 'b'] }), // only 2 — below min of 3
    ];
    expect(clusterOutcomes(outcomes)).toEqual([]);
  });

  it('sorts by cluster size descending', () => {
    const outcomes = [
      // Cluster A — 3 examples
      outcome({ toolsUsed: ['x', 'y'] }),
      outcome({ toolsUsed: ['x', 'y'] }),
      outcome({ toolsUsed: ['x', 'y'] }),
      // Cluster B — 5 examples (should come first)
      outcome({ toolsUsed: ['p', 'q'] }),
      outcome({ toolsUsed: ['p', 'q'] }),
      outcome({ toolsUsed: ['p', 'q'] }),
      outcome({ toolsUsed: ['p', 'q'] }),
      outcome({ toolsUsed: ['p', 'q'] }),
    ];
    const clusters = clusterOutcomes(outcomes);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.signature).toBe('p|q');
    expect(clusters[0]!.examples).toHaveLength(5);
    expect(clusters[1]!.signature).toBe('x|y');
  });

  it('separates clusters by agentType', () => {
    const outcomes = [
      outcome({ agentType: 'ba', toolsUsed: ['a', 'b'] }),
      outcome({ agentType: 'ba', toolsUsed: ['a', 'b'] }),
      outcome({ agentType: 'ba', toolsUsed: ['a', 'b'] }),
      outcome({ agentType: 'dev', toolsUsed: ['a', 'b'] }),
      outcome({ agentType: 'dev', toolsUsed: ['a', 'b'] }),
      outcome({ agentType: 'dev', toolsUsed: ['a', 'b'] }),
    ];
    const clusters = clusterOutcomes(outcomes);
    expect(clusters).toHaveLength(2);
    expect(new Set(clusters.map((c) => c.agentType))).toEqual(new Set(['ba', 'dev']));
  });
});

describe('buildDistillerPrompt', () => {
  it('includes the signature, count, and confidence summary', () => {
    const prompt = buildDistillerPrompt({
      agentType: 'dev',
      signature: 'read_prd|open_pr',
      examples: [
        { taskId: 't1', toolsUsed: ['read_prd', 'open_pr'], stepCount: 2, confidenceScore: 0.9 },
        { taskId: 't2', toolsUsed: ['read_prd', 'open_pr'], stepCount: 2, confidenceScore: 0.85 },
        { taskId: 't3', toolsUsed: ['read_prd', 'open_pr'], stepCount: 2, confidenceScore: 0.8 },
      ],
    });
    expect(prompt).toContain('Agent role: dev');
    expect(prompt).toContain('read_prd|open_pr');
    expect(prompt).toContain('Observed 3 times');
    expect(prompt).toContain('Average confidence: 0.85');
  });
});

describe('SkillDistillerService.distill', () => {
  function makePrisma(seed: {
    outcomes?: ReturnType<typeof outcome>[];
    alreadyProposed?: boolean;
  } = {}) {
    const created: Array<Record<string, unknown>> = [];
    return {
      created,
      prisma: {
        agentOutcome: {
          findMany: vi.fn().mockResolvedValue(seed.outcomes ?? []),
        },
        learnedSkill: {
          findFirst: vi.fn().mockResolvedValue(seed.alreadyProposed ? { id: 'dup-1' } : null),
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return { id: `skill-${created.length}`, ...data };
          }),
        },
      },
    };
  }

  function makeGemini(text = '# Pattern: triage new brief\n\nGood stuff.') {
    return {
      disabled: false,
      generateFreeformText: vi.fn().mockResolvedValue(text),
    };
  }

  it('returns zeros and does nothing when Gemini is disabled', async () => {
    const { prisma, created } = makePrisma();
    const gemini = { disabled: true, generateFreeformText: vi.fn() };
    const svc = new SkillDistillerService(prisma as any, gemini as any);
    const result = await svc.distill();
    expect(result).toEqual({ scanned: 0, clusters: 0, proposed: 0, skipped: 0 });
    expect(gemini.generateFreeformText).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('proposes a LearnedSkill when a cluster meets the minimum', async () => {
    const outcomes = [
      outcome(),
      outcome(),
      outcome(),
      outcome(),
    ];
    const { prisma, created } = makePrisma({ outcomes });
    const gemini = makeGemini();
    const svc = new SkillDistillerService(prisma as any, gemini as any);
    const result = await svc.distill();
    expect(result.proposed).toBe(1);
    expect(created).toHaveLength(1);
    const payload = created[0]!;
    expect(payload.status).toBe('candidate');
    expect(payload.target).toBe('ba');
    expect(String(payload.content)).toContain('<!-- signature: read_prd|create_prd -->');
    expect(String(payload.name)).toContain('Pattern');
  });

  it('dedupes against recent candidates with the same signature', async () => {
    const outcomes = [outcome(), outcome(), outcome()];
    const { prisma, created } = makePrisma({ outcomes, alreadyProposed: true });
    const gemini = makeGemini();
    const svc = new SkillDistillerService(prisma as any, gemini as any);
    const result = await svc.distill();
    expect(result.proposed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(created).toHaveLength(0);
    expect(gemini.generateFreeformText).not.toHaveBeenCalled();
  });

  it('skips a cluster when Gemini throws but keeps going', async () => {
    const outcomes = [
      // Cluster A — fails
      outcome({ toolsUsed: ['a', 'b'] }),
      outcome({ toolsUsed: ['a', 'b'] }),
      outcome({ toolsUsed: ['a', 'b'] }),
      // Cluster B — succeeds
      outcome({ toolsUsed: ['c', 'd'] }),
      outcome({ toolsUsed: ['c', 'd'] }),
      outcome({ toolsUsed: ['c', 'd'] }),
    ];
    const { prisma, created } = makePrisma({ outcomes });
    const gemini = {
      disabled: false,
      generateFreeformText: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce('# Cluster B pattern\n\nOK.'),
    };
    const svc = new SkillDistillerService(prisma as any, gemini as any);
    const result = await svc.distill();
    expect(result.proposed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(created).toHaveLength(1);
    expect(String(created[0]!.content)).toContain('Cluster B pattern');
  });

  it('caps proposals at MAX_CANDIDATES_PER_RUN', async () => {
    // Build 6 distinct clusters of size 3 each.
    const outcomes: ReturnType<typeof outcome>[] = [];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        outcomes.push(outcome({ toolsUsed: [`tool_a_${i}`, `tool_b_${i}`] }));
      }
    }
    const { prisma, created } = makePrisma({ outcomes });
    const gemini = makeGemini();
    const svc = new SkillDistillerService(prisma as any, gemini as any);
    const result = await svc.distill();
    // MAX_CANDIDATES_PER_RUN is 5 in the service.
    expect(result.clusters).toBe(6);
    expect(result.proposed).toBe(5);
    expect(created).toHaveLength(5);
  });
});
