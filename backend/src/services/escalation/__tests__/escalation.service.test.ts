import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { EscalationService, parseEscalationIntent } from '../escalation.service.js';

function makeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ..._rest: any[]) => {
      store.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async (k: string) => {
      const had = store.has(k);
      store.delete(k);
      return had ? 1 : 0;
    }),
  };
}

function makePrisma() {
  const tickets = new Map<string, any>();
  const plans: any[] = [];
  return {
    tickets,
    plans,
    ticket: {
      findFirst: vi.fn(async ({ where }: any) => {
        const t = tickets.get(where.id);
        if (!t) return null;
        if (where.tenantId && t.tenantId !== where.tenantId) return null;
        return t;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const t = tickets.get(where.id);
        Object.assign(t, data);
        return t;
      }),
    },
    executionPlan: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const p of plans) {
          if (p.parentTicketId !== where.parentTicketId) continue;
          if (where.status) {
            if (typeof where.status === 'string' && p.status !== where.status) continue;
            if (where.status.in && !where.status.in.includes(p.status)) continue;
          }
          Object.assign(p, data);
          n += 1;
        }
        return { count: n };
      }),
    },
  };
}

function makeChief() {
  return {
    planTicket: vi.fn(async () => ({ planId: 'plan-new', childTicketIds: [] })),
  };
}

describe('parseEscalationIntent', () => {
  const token = 'abcdef012345';

  it('recognises RETRY <token>', () => {
    expect(parseEscalationIntent(`RETRY ${token}`)).toEqual({ action: 'retry', token });
  });

  it('recognises PAUSE <token>', () => {
    expect(parseEscalationIntent(`pause ${token}`)).toEqual({ action: 'pause', token });
  });

  it('recognises CANCEL <token>', () => {
    expect(parseEscalationIntent(`Cancel ${token}`)).toEqual({ action: 'cancel', token });
  });

  it('matches embedded in a longer message', () => {
    expect(parseEscalationIntent(`ok, let's RETRY ${token} and see`)).toEqual({
      action: 'retry',
      token,
    });
  });

  it('returns null for approve/reject replies (so approval flow still fires)', () => {
    expect(parseEscalationIntent(`APPROVE ${token}`)).toBeNull();
    expect(parseEscalationIntent(`REJECT ${token}`)).toBeNull();
  });

  it('returns null when token is wrong length', () => {
    expect(parseEscalationIntent('RETRY abc123')).toBeNull();
  });

  it('returns null for plain text', () => {
    expect(parseEscalationIntent('hey, how are you')).toBeNull();
  });
});

describe('EscalationService.createToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mints a 12-hex token and stores forward + reverse index', async () => {
    const redis = makeRedis();
    const svc = new EscalationService(makePrisma() as any, redis as any, makeChief() as any);
    const token = await svc.createToken('parent-1', 't1');
    expect(token).toMatch(/^[a-f0-9]{12}$/);
    expect(redis.store.get(`escalation:token:${token}`)).toBeDefined();
    expect(redis.store.get('escalation:by-parent:parent-1')).toBe(token);
  });

  it('reuses an existing token for the same parent (idempotent)', async () => {
    const redis = makeRedis();
    const svc = new EscalationService(makePrisma() as any, redis as any, makeChief() as any);
    const a = await svc.createToken('parent-1', 't1');
    const b = await svc.createToken('parent-1', 't1');
    expect(a).toBe(b);
  });
});

describe('EscalationService.apply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retry → supersedes prior failed plans and asks chief_of_staff to plan afresh', async () => {
    const prisma = makePrisma();
    const redis = makeRedis();
    const chief = makeChief();
    prisma.tickets.set('parent-1', { id: 'parent-1', tenantId: 't1', title: 'X', status: 'failed' });
    prisma.plans.push({ parentTicketId: 'parent-1', status: 'failed', attempt: 3 });
    const svc = new EscalationService(prisma as any, redis as any, chief as any);
    const token = await svc.createToken('parent-1', 't1');
    const result = await svc.apply(token, 'retry');
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Retrying/);
    expect(prisma.plans[0].status).toBe('superseded');
    expect(chief.planTicket).toHaveBeenCalledTimes(1);
    const firstCall = (chief.planTicket as any).mock.calls[0] as any[];
    expect(firstCall[0].attempt).toBe(1);
    // Token should be invalidated after retry so a new escalation produces a new one.
    expect(redis.store.get(`escalation:token:${token}`)).toBeUndefined();
  });

  it('pause → marks parent ticket waiting and keeps the token live', async () => {
    const prisma = makePrisma();
    const redis = makeRedis();
    prisma.tickets.set('parent-1', { id: 'parent-1', tenantId: 't1', title: 'Y', status: 'failed' });
    const svc = new EscalationService(prisma as any, redis as any, makeChief() as any);
    const token = await svc.createToken('parent-1', 't1');
    const result = await svc.apply(token, 'pause');
    expect(result.ok).toBe(true);
    expect(prisma.tickets.get('parent-1').status).toBe('waiting');
    // Token stays live so user can follow up with RETRY / CANCEL.
    expect(redis.store.get(`escalation:token:${token}`)).toBeDefined();
  });

  it('cancel → marks parent cancelled, supersedes plans, invalidates token', async () => {
    const prisma = makePrisma();
    const redis = makeRedis();
    prisma.tickets.set('parent-1', { id: 'parent-1', tenantId: 't1', title: 'Z', status: 'failed' });
    prisma.plans.push({ parentTicketId: 'parent-1', status: 'active', attempt: 2 });
    const svc = new EscalationService(prisma as any, redis as any, makeChief() as any);
    const token = await svc.createToken('parent-1', 't1');
    const result = await svc.apply(token, 'cancel');
    expect(result.ok).toBe(true);
    expect(prisma.tickets.get('parent-1').status).toBe('cancelled');
    expect(prisma.plans[0].status).toBe('superseded');
    expect(redis.store.get(`escalation:token:${token}`)).toBeUndefined();
  });

  it('returns a clean error for an unknown token (expired)', async () => {
    const prisma = makePrisma();
    const redis = makeRedis();
    const svc = new EscalationService(prisma as any, redis as any, makeChief() as any);
    const result = await svc.apply('doesnotexist', 'retry');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/expired or unknown/i);
  });

  it('returns a clean error when the parent ticket no longer exists', async () => {
    const prisma = makePrisma();
    const redis = makeRedis();
    const svc = new EscalationService(prisma as any, redis as any, makeChief() as any);
    const token = await svc.createToken('phantom-1', 't1');
    const result = await svc.apply(token, 'retry');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/find that ticket/i);
  });

  it('tenant isolation: resolveToken + apply refuse cross-tenant parents', async () => {
    const prisma = makePrisma();
    const redis = makeRedis();
    prisma.tickets.set('parent-1', { id: 'parent-1', tenantId: 't2-other', title: 'X' });
    const svc = new EscalationService(prisma as any, redis as any, makeChief() as any);
    const token = await svc.createToken('parent-1', 't1'); // token says tenant t1
    // parent exists in t2-other; findFirst with tenantId=t1 returns null.
    const result = await svc.apply(token, 'retry');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/find that ticket/i);
  });
});
