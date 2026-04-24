import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  }),
}));

import { postApprovalHandoff } from '../agents.routes.js';

interface FakeThread {
  id: string;
  channel: string;
  purpose: string;
  engagementId: string | null;
  lastActivityAt: Date;
  tenantId: string;
}

/**
 * Minimal Prisma stub for the conversationThread table. Supports the two
 * queries postApprovalHandoff issues: an OR-joined exact-match findFirst,
 * and a recent-activity-windowed fallback findFirst. Also supports
 * update() so we can assert backfill.
 */
function makePrisma(threads: FakeThread[]) {
  const matchExact = (t: FakeThread, where: any) => {
    if (t.tenantId !== where.tenantId) return false;
    if (where.OR) {
      return (where.OR as any[]).some((clause) => {
        if (clause.purpose !== undefined) return t.purpose === clause.purpose;
        if (clause.engagementId !== undefined) return t.engagementId === clause.engagementId;
        return false;
      });
    }
    if (where.lastActivityAt?.gt) return t.lastActivityAt > where.lastActivityAt.gt;
    return true;
  };

  const findFirst = vi.fn(async ({ where, orderBy: _o }: { where: any; orderBy: unknown }) => {
    const hits = threads.filter((t) => matchExact(t, where));
    if (hits.length === 0) return null;
    const sorted = [...hits].sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    const pick = sorted[0];
    return {
      id: pick.id,
      channel: pick.channel,
      engagementId: pick.engagementId,
    };
  });

  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = threads.find((t) => t.id === where.id);
    if (!row) throw new Error('Not found');
    if ('engagementId' in data) row.engagementId = data.engagementId as string;
    return row;
  });

  return {
    prisma: { conversationThread: { findFirst, update } } as any,
    findFirst,
    update,
    threads,
  };
}

function makeOrchestrator(opts: { blocked?: 'rate_limited' | 'runaway_loop'; throws?: boolean } = {}) {
  return {
    initiate: vi.fn(async () => {
      if (opts.throws) throw new Error('orchestrator boom');
      if (opts.blocked) {
        return { threadId: 'x', turnId: '', formatted: { text: '' }, handoffs: [], blocked: opts.blocked };
      }
      return {
        threadId: 'x', turnId: 'turn-1', formatted: { text: 'posted' }, handoffs: ['dev' as const],
      };
    }),
  } as any;
}

describe('postApprovalHandoff', () => {
  const TENANT = 't-1';
  const PRD = 'prd-7';
  const ENG = 'eng-42';

  beforeEach(() => vi.clearAllMocks());

  it('posts to the engagement-scoped thread when one exists (exact match path)', async () => {
    const now = new Date();
    const { prisma, findFirst } = makePrisma([
      {
        id: 'thread-engagement',
        channel: 'slack',
        purpose: `engagement:${ENG}`,
        engagementId: ENG,
        lastActivityAt: now,
        tenantId: TENANT,
      },
    ]);
    const orchestrator = makeOrchestrator();

    const r = await postApprovalHandoff({ orchestrator, prisma }, {
      tenantId: TENANT, prdId: PRD, engagementId: ENG,
    });

    expect(r).toEqual({ posted: true, threadId: 'thread-engagement', boundEngagementId: false });
    expect(orchestrator.initiate).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-engagement',
      channel: 'slack',
      agent: 'ba',
    }));
    // exact-match query issued, fallback not needed
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('falls back to the most recently active thread and backfills engagementId', async () => {
    const now = new Date();
    const { prisma, findFirst, update, threads } = makePrisma([
      {
        id: 'thread-general',
        channel: 'slack',
        purpose: 'general',
        engagementId: null,
        lastActivityAt: new Date(now.getTime() - 60_000),
        tenantId: TENANT,
      },
    ]);
    const orchestrator = makeOrchestrator();

    const r = await postApprovalHandoff({ orchestrator, prisma }, {
      tenantId: TENANT, prdId: PRD, engagementId: ENG,
    });

    expect(r.posted).toBe(true);
    expect(r.threadId).toBe('thread-general');
    expect(r.boundEngagementId).toBe(true);
    // exact-match miss, then fallback hit
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'thread-general' },
      data: { engagementId: ENG },
    });
    // the fake's update mutated the row so future lookups can find it precisely
    expect(threads[0]!.engagementId).toBe(ENG);
  });

  it('does not backfill when the thread already has an engagementId', async () => {
    const now = new Date();
    const { prisma, update } = makePrisma([
      {
        id: 'thread-general',
        channel: 'slack',
        purpose: 'general',
        engagementId: 'eng-other',
        lastActivityAt: new Date(now.getTime() - 60_000),
        tenantId: TENANT,
      },
    ]);
    const orchestrator = makeOrchestrator();

    const r = await postApprovalHandoff({ orchestrator, prisma }, {
      tenantId: TENANT, prdId: PRD, engagementId: ENG,
    });

    // Fallback picks this one up (different engagementId means exact match misses)
    expect(r.posted).toBe(true);
    expect(r.boundEngagementId).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('skips threads older than 48h — staleness cap', async () => {
    const tooOld = new Date(Date.now() - 49 * 60 * 60 * 1000);
    const { prisma } = makePrisma([
      {
        id: 'thread-stale',
        channel: 'slack',
        purpose: 'general',
        engagementId: null,
        lastActivityAt: tooOld,
        tenantId: TENANT,
      },
    ]);
    const orchestrator = makeOrchestrator();

    const r = await postApprovalHandoff({ orchestrator, prisma }, {
      tenantId: TENANT, prdId: PRD, engagementId: ENG,
    });

    expect(r).toEqual({ posted: false, reason: 'no_thread' });
    expect(orchestrator.initiate).not.toHaveBeenCalled();
  });

  it('returns no_thread when the tenant has no threads at all', async () => {
    const { prisma } = makePrisma([]);
    const orchestrator = makeOrchestrator();

    const r = await postApprovalHandoff({ orchestrator, prisma }, {
      tenantId: TENANT, prdId: PRD, engagementId: ENG,
    });

    expect(r).toEqual({ posted: false, reason: 'no_thread' });
    expect(orchestrator.initiate).not.toHaveBeenCalled();
  });

  it('returns blocked when the orchestrator guardrail fires', async () => {
    const now = new Date();
    const { prisma } = makePrisma([
      {
        id: 'thread-loop',
        channel: 'slack',
        purpose: `engagement:${ENG}`,
        engagementId: ENG,
        lastActivityAt: now,
        tenantId: TENANT,
      },
    ]);
    const orchestrator = makeOrchestrator({ blocked: 'runaway_loop' });

    const r = await postApprovalHandoff({ orchestrator, prisma }, {
      tenantId: TENANT, prdId: PRD, engagementId: ENG,
    });

    expect(r).toMatchObject({ posted: false, reason: 'blocked', threadId: 'thread-loop' });
  });

  it('returns error and does not throw when the orchestrator fails', async () => {
    const now = new Date();
    const { prisma } = makePrisma([
      {
        id: 'thread-boom',
        channel: 'slack',
        purpose: `engagement:${ENG}`,
        engagementId: ENG,
        lastActivityAt: now,
        tenantId: TENANT,
      },
    ]);
    const orchestrator = makeOrchestrator({ throws: true });

    const r = await postApprovalHandoff({ orchestrator, prisma }, {
      tenantId: TENANT, prdId: PRD, engagementId: ENG,
    });

    expect(r).toMatchObject({ posted: false, reason: 'error', threadId: 'thread-boom' });
  });

  it('no-ops cleanly when the orchestrator is not wired', async () => {
    const { prisma } = makePrisma([
      {
        id: 'thread-1',
        channel: 'slack',
        purpose: `engagement:${ENG}`,
        engagementId: ENG,
        lastActivityAt: new Date(),
        tenantId: TENANT,
      },
    ]);

    const r = await postApprovalHandoff({ orchestrator: null, prisma }, {
      tenantId: TENANT, prdId: PRD, engagementId: ENG,
    });

    expect(r).toEqual({ posted: false, reason: 'no_thread' });
  });

  it('matches on engagementId even when purpose is something else', async () => {
    const { prisma } = makePrisma([
      {
        id: 'thread-tagged',
        channel: 'slack',
        purpose: 'oncall',
        engagementId: ENG,
        lastActivityAt: new Date(),
        tenantId: TENANT,
      },
    ]);
    const orchestrator = makeOrchestrator();

    const r = await postApprovalHandoff({ orchestrator, prisma }, {
      tenantId: TENANT, prdId: PRD, engagementId: ENG,
    });

    expect(r.posted).toBe(true);
    expect(r.threadId).toBe('thread-tagged');
    expect(r.boundEngagementId).toBe(false);
  });
});
