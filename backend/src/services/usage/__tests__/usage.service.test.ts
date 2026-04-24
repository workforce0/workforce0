import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { UsageService } from '../usage.service.js';

function makePrisma(opts: {
  dailyTokens?: number;
  cap?: number | null;
} = {}) {
  return {
    tenantUsage: {
      aggregate: vi.fn(async () => {
        // Split roughly evenly between input/output so the sum test is honest.
        const total = opts.dailyTokens ?? 0;
        return { _sum: { inputTokens: Math.floor(total / 2), outputTokens: total - Math.floor(total / 2) } };
      }),
    },
    tenant: {
      findUnique: vi.fn(async () => ({
        settings: opts.cap === undefined ? {} : { dailyTokenBudget: opts.cap },
      })),
    },
  };
}

describe('UsageService.getDailyTokens', () => {
  it('sums inputTokens + outputTokens from today', async () => {
    const prisma = makePrisma({ dailyTokens: 15_000 });
    const svc = new UsageService(prisma as any);
    expect(await svc.getDailyTokens('t-1')).toBe(15_000);
  });

  it('returns 0 when there is no usage yet', async () => {
    const prisma = makePrisma({ dailyTokens: 0 });
    const svc = new UsageService(prisma as any);
    expect(await svc.getDailyTokens('t-1')).toBe(0);
  });

  it('uses a UTC-midnight boundary for the "today" window', async () => {
    const prisma = makePrisma({ dailyTokens: 100 });
    const svc = new UsageService(prisma as any);
    await svc.getDailyTokens('t-1');
    const call = (prisma.tenantUsage.aggregate as any).mock.calls[0][0];
    const gte: Date = call.where.createdAt.gte;
    // Hours / minutes / seconds in UTC should be zero at the boundary.
    expect(gte.getUTCHours()).toBe(0);
    expect(gte.getUTCMinutes()).toBe(0);
    expect(gte.getUTCSeconds()).toBe(0);
  });
});

describe('UsageService.getDailyTokenBudget', () => {
  it('returns the cap when set to a positive number', async () => {
    const prisma = makePrisma({ cap: 50_000 });
    const svc = new UsageService(prisma as any);
    expect(await svc.getDailyTokenBudget('t-1')).toBe(50_000);
  });

  it('returns null when cap is unset', async () => {
    const prisma = makePrisma(); // no settings
    const svc = new UsageService(prisma as any);
    expect(await svc.getDailyTokenBudget('t-1')).toBeNull();
  });

  it('treats cap=0 as unset — protects operators from typo-locking themselves out', async () => {
    const prisma = makePrisma({ cap: 0 });
    const svc = new UsageService(prisma as any);
    expect(await svc.getDailyTokenBudget('t-1')).toBeNull();
  });

  it('treats negative cap as unset', async () => {
    const prisma = makePrisma({ cap: -5 });
    const svc = new UsageService(prisma as any);
    expect(await svc.getDailyTokenBudget('t-1')).toBeNull();
  });
});

describe('UsageService.getMonthlyTokensForAgent', () => {
  it('sums per-agent input+output since the first of the month (UTC)', async () => {
    const agg = vi.fn(async () => ({ _sum: { inputTokens: 1_000, outputTokens: 2_000 } }));
    const prisma = { tenantUsage: { aggregate: agg } };
    const svc = new UsageService(prisma as any);
    expect(await svc.getMonthlyTokensForAgent('t-1', 'ba_agent')).toBe(3_000);
    const call = (agg.mock.calls as any[])[0]![0] as any;
    expect(call.where.tenantId).toBe('t-1');
    expect(call.where.agentType).toBe('ba_agent');
    expect(call.where.createdAt.gte.getUTCDate()).toBe(1);
    expect(call.where.createdAt.gte.getUTCHours()).toBe(0);
  });
});

describe('UsageService.isOverRoleMonthlyBudget', () => {
  function makePrisma(opts: { cap?: number | null; used?: number } = {}) {
    return {
      agentRole: {
        findFirst: vi.fn(async () => (
          opts.cap === undefined ? null : { monthlyBudgetTokens: opts.cap }
        )),
      },
      tenantUsage: {
        aggregate: vi.fn(async () => ({
          _sum: {
            inputTokens: Math.floor((opts.used ?? 0) / 2),
            outputTokens: (opts.used ?? 0) - Math.floor((opts.used ?? 0) / 2),
          },
        })),
      },
    };
  }

  it('returns over=false when no role row exists', async () => {
    const prisma = makePrisma();
    const svc = new UsageService(prisma as any);
    const r = await svc.isOverRoleMonthlyBudget('t-1', 'unknown');
    expect(r.over).toBe(false);
    expect(r.cap).toBeNull();
  });

  it('returns over=false when role has no cap (null)', async () => {
    const prisma = makePrisma({ cap: null, used: 999_999 });
    const svc = new UsageService(prisma as any);
    const r = await svc.isOverRoleMonthlyBudget('t-1', 'dev_agent');
    expect(r.over).toBe(false);
    expect(r.cap).toBeNull();
  });

  it('returns over=false when usage is under cap', async () => {
    const prisma = makePrisma({ cap: 10_000, used: 5_000 });
    const svc = new UsageService(prisma as any);
    const r = await svc.isOverRoleMonthlyBudget('t-1', 'ba_agent');
    expect(r).toEqual({ over: false, used: 5_000, cap: 10_000 });
  });

  it('returns over=true when usage equals or exceeds cap', async () => {
    const prisma = makePrisma({ cap: 10_000, used: 12_000 });
    const svc = new UsageService(prisma as any);
    const r = await svc.isOverRoleMonthlyBudget('t-1', 'ba_agent');
    expect(r.over).toBe(true);
    expect(r.used).toBe(12_000);
  });

  it('treats cap=0 as "no cap" — protects against typo lockouts', async () => {
    const prisma = makePrisma({ cap: 0, used: 50 });
    const svc = new UsageService(prisma as any);
    const r = await svc.isOverRoleMonthlyBudget('t-1', 'ba_agent');
    expect(r.over).toBe(false);
    expect(r.cap).toBeNull();
  });
});

describe('UsageService.isOverDailyTokenBudget', () => {
  it('returns false when no cap is configured', async () => {
    const prisma = makePrisma({ dailyTokens: 1_000_000 });
    const svc = new UsageService(prisma as any);
    expect(await svc.isOverDailyTokenBudget('t-1')).toBe(false);
  });

  it('returns false when usage is under the cap', async () => {
    const prisma = makePrisma({ dailyTokens: 1_000, cap: 10_000 });
    const svc = new UsageService(prisma as any);
    expect(await svc.isOverDailyTokenBudget('t-1')).toBe(false);
  });

  it('returns true when usage hits the cap exactly', async () => {
    const prisma = makePrisma({ dailyTokens: 10_000, cap: 10_000 });
    const svc = new UsageService(prisma as any);
    expect(await svc.isOverDailyTokenBudget('t-1')).toBe(true);
  });

  it('returns true when usage exceeds the cap', async () => {
    const prisma = makePrisma({ dailyTokens: 20_000, cap: 10_000 });
    const svc = new UsageService(prisma as any);
    expect(await svc.isOverDailyTokenBudget('t-1')).toBe(true);
  });
});
