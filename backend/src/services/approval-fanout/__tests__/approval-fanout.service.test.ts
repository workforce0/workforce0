/**
 * Smoke tests for ApprovalFanoutService.
 *
 * Exercises the critical reply-ingestion loop that M3 and M4 webhooks
 * depend on: token mint → resolve → apply action → consume.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalFanoutService } from '../approval-fanout.service.js';

function makeRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    store,
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async setex(key: string, ttlSeconds: number, value: string) {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return 'OK';
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
  };
}

function makePrisma() {
  const prds = new Map<string, { id: string; tenantId: string; status: string; title: string; summary: string }>();
  const teamMembers: Array<Record<string, unknown>> = [];
  const auditLogs: Array<Record<string, unknown>> = [];

  return {
    prds,
    teamMembers,
    auditLogs,
    pRD: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const record = prds.get(where.id);
        if (!record) return null;
        // minimally honor `select`
        if (select) {
          const picked: Record<string, unknown> = {};
          for (const k of Object.keys(select)) picked[k] = (record as any)[k];
          return picked;
        }
        return record;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = prds.get(where.id);
        if (!existing) throw new Error('not found');
        const next = { ...existing, ...data };
        prds.set(where.id, next);
        return next;
      }),
    },
    teamMember: {
      findMany: vi.fn(async () => teamMembers),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
  };
}

function makeRouter() {
  return {
    send: vi.fn(async () => ({ success: true, channel: 'email', messageLogId: 'log-1' })),
  };
}

describe('ApprovalFanoutService', () => {
  let redis: ReturnType<typeof makeRedis>;
  let prisma: ReturnType<typeof makePrisma>;
  let router: ReturnType<typeof makeRouter>;
  let service: ApprovalFanoutService;

  beforeEach(() => {
    redis = makeRedis();
    prisma = makePrisma();
    router = makeRouter();
    prisma.prds.set('prd-1', {
      id: 'prd-1',
      tenantId: 'tenant-1',
      status: 'draft',
      title: 'Q3 Planning Brief',
      summary: 'Pilot new onboarding flow across 3 squads.',
    });
    prisma.teamMembers.push(
      { id: 'member-1', name: 'Alice', role: 'founder' },
      { id: 'member-2', name: 'Bob', role: 'admin' },
    );
    service = new ApprovalFanoutService(prisma as any, redis as any, router as any, 'https://wf0.test');
  });

  it('mints a token and routes a message to every approver', async () => {
    const result = await service.notify('prd-1');
    expect(result.notified).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.token).toMatch(/^[a-f0-9]{12}$/);
    expect(router.send).toHaveBeenCalledTimes(2);
  });

  it('reuses the same token on a repeat notify', async () => {
    const first = await service.notify('prd-1');
    const second = await service.notify('prd-1');
    expect(first.token).toBe(second.token);
  });

  it('applies an approve action from a valid reply token', async () => {
    const { token } = await service.notify('prd-1');

    const applied = await service.applyReplyAction({
      token,
      action: 'approve',
      source: 'slack',
      externalActorRef: 'U12345',
    });

    expect(applied).toEqual({ prdId: 'prd-1', tenantId: 'tenant-1' });
    expect(prisma.prds.get('prd-1')?.status).toBe('approved');
    expect(prisma.auditLogs.at(-1)).toMatchObject({
      action: 'prd.approve.slack',
      resource: 'prd',
      resourceId: 'prd-1',
    });
  });

  it('consumes the token so replay does nothing', async () => {
    const { token } = await service.notify('prd-1');
    await service.applyReplyAction({ token, action: 'approve', source: 'slack' });
    const replay = await service.applyReplyAction({ token, action: 'approve', source: 'slack' });
    expect(replay).toBeNull();
  });

  it('returns null on an unknown token', async () => {
    const result = await service.applyReplyAction({
      token: 'deadbeefcafe',
      action: 'reject',
      source: 'email',
    });
    expect(result).toBeNull();
  });

  it('handles reject with a reason', async () => {
    const { token } = await service.notify('prd-1');
    await service.applyReplyAction({
      token,
      action: 'reject',
      reason: 'Missing success metrics',
      source: 'email',
      externalActorRef: 'approver@company.com',
    });
    expect(prisma.prds.get('prd-1')?.status).toBe('rejected');
    expect(prisma.auditLogs.at(-1)).toMatchObject({
      action: 'prd.reject.email',
      after: { reason: 'Missing success metrics', source: 'email', externalActorRef: 'approver@company.com' },
    });
  });

  it('is idempotent when the PRD was already decided', async () => {
    const { token } = await service.notify('prd-1');
    prisma.prds.get('prd-1')!.status = 'approved';
    const result = await service.applyReplyAction({ token, action: 'approve', source: 'slack' });
    // still returns success-shaped payload (so reply handler can confirm cleanly)
    expect(result).toEqual({ prdId: 'prd-1', tenantId: 'tenant-1' });
    // and token is consumed
    const replay = await service.applyReplyAction({ token, action: 'approve', source: 'slack' });
    expect(replay).toBeNull();
  });

  it('skips fanout when no approvers are configured', async () => {
    prisma.teamMembers.length = 0;
    const result = await service.notify('prd-1');
    expect(result.notified).toBe(0);
    expect(result.token).toBe('');
    expect(router.send).not.toHaveBeenCalled();
  });
});
