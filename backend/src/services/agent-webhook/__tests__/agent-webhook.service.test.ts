import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { AgentWebhookService } from '../agent-webhook.service.js';

function makePrisma() {
  const rows = new Map<string, any>();
  let nextId = 1;
  return {
    store: rows,
    agentWebhook: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = `hook-${nextId++}`;
        const row = {
          id,
          tenantId: data.tenantId,
          roleSlug: data.roleSlug,
          callbackUrl: data.callbackUrl,
          sharedSecret: data.sharedSecret,
          name: data.name ?? null,
          isActive: data.isActive ?? true,
          lastFiredAt: null,
          lastStatus: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.set(id, row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        for (const r of rows.values()) {
          if (where.id && r.id !== where.id) continue;
          if (where.tenantId && r.tenantId !== where.tenantId) continue;
          return r;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: any }) => {
        return [...rows.values()].filter((r) => {
          if (r.tenantId !== where.tenantId) return false;
          if (where.roleSlug && r.roleSlug !== where.roleSlug) return false;
          if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
          return true;
        });
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const r = rows.get(where.id);
        if (!r) throw new Error('not found');
        Object.assign(r, data, { updatedAt: new Date() });
        return r;
      }),
      deleteMany: vi.fn(async ({ where }: { where: any }) => {
        let count = 0;
        for (const [id, r] of rows) {
          if (where.id && r.id !== where.id) continue;
          if (where.tenantId && r.tenantId !== where.tenantId) continue;
          rows.delete(id);
          count++;
        }
        return { count };
      }),
    },
  };
}

function makeFakeTickets() {
  const events = new EventEmitter();
  return {
    events,
    emit: (ev: any) => events.emit('ticket.ready', ev),
  } as any;
}

describe('AgentWebhookService registration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a webhook with a generated secret when none supplied', async () => {
    const prisma = makePrisma();
    const svc = new AgentWebhookService(prisma as any, null);
    const hook = await svc.register({
      tenantId: 't-1',
      roleSlug: 'dev_agent',
      callbackUrl: 'http://localhost:9999/ticket',
    });
    // Register DTO reveals the secret once
    expect(hook.sharedSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(hook.roleSlug).toBe('dev_agent');
  });

  it('accepts a caller-supplied shared secret', async () => {
    const prisma = makePrisma();
    const svc = new AgentWebhookService(prisma as any, null);
    const hook = await svc.register({
      tenantId: 't-1',
      roleSlug: 'dev_agent',
      callbackUrl: 'http://x',
      sharedSecret: 'my-own-secret-value',
    });
    expect(hook.sharedSecret).toBe('my-own-secret-value');
  });

  it('list masks the shared secret to last-4', async () => {
    const prisma = makePrisma();
    const svc = new AgentWebhookService(prisma as any, null);
    await svc.register({
      tenantId: 't-1', roleSlug: 'dev_agent', callbackUrl: 'http://x', sharedSecret: 'abcd1234efgh5678',
    });
    const list = await svc.listForTenant('t-1');
    expect(list[0]?.sharedSecret).toBe('•••5678');
  });

  it('setActive toggles visibility without deleting', async () => {
    const prisma = makePrisma();
    const svc = new AgentWebhookService(prisma as any, null);
    const hook = await svc.register({ tenantId: 't-1', roleSlug: 'dev_agent', callbackUrl: 'http://x' });
    const off = await svc.setActive('t-1', hook.id, false);
    expect(off?.isActive).toBe(false);
  });

  it('does not leak webhooks across tenants', async () => {
    const prisma = makePrisma();
    const svc = new AgentWebhookService(prisma as any, null);
    await svc.register({ tenantId: 't-1', roleSlug: 'dev_agent', callbackUrl: 'http://x' });
    expect(await svc.listForTenant('t-2')).toHaveLength(0);
  });
});

describe('AgentWebhookService.fanOut', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs to every matching webhook with an HMAC signature header', async () => {
    const prisma = makePrisma();
    const svc = new AgentWebhookService(prisma as any, null);
    await svc.register({
      tenantId: 't-1', roleSlug: 'dev_agent', callbackUrl: 'http://agent-a/hook', sharedSecret: 'secret-a',
    });
    await svc.register({
      tenantId: 't-1', roleSlug: 'dev_agent', callbackUrl: 'http://agent-b/hook', sharedSecret: 'secret-b',
    });

    const calls: Array<{ url: string; body: string; signature: string }> = [];
    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      calls.push({
        url: String(input),
        body: String(init?.body ?? ''),
        signature: String((init?.headers ?? {})['X-Workforce0-Signature'] ?? ''),
      });
      return new Response('ok', { status: 200 });
    }) as any;

    await svc.fanOut({ tenantId: 't-1', ticketId: 'ticket-1', roleSlug: 'dev_agent' });

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.signature.length > 10)).toBe(true);
    const payloads = calls.map((c) => JSON.parse(c.body));
    expect(payloads.every((p) => p.event === 'ticket.ready')).toBe(true);
    expect(payloads.every((p) => p.ticketId === 'ticket-1')).toBe(true);
  });

  it('does not POST to inactive webhooks', async () => {
    const prisma = makePrisma();
    const svc = new AgentWebhookService(prisma as any, null);
    const hook = await svc.register({ tenantId: 't-1', roleSlug: 'dev_agent', callbackUrl: 'http://x' });
    await svc.setActive('t-1', hook.id, false);

    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    globalThis.fetch = fetchSpy as any;

    await svc.fanOut({ tenantId: 't-1', ticketId: 't-1', roleSlug: 'dev_agent' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not POST to other roles', async () => {
    const prisma = makePrisma();
    const svc = new AgentWebhookService(prisma as any, null);
    await svc.register({ tenantId: 't-1', roleSlug: 'ba_agent', callbackUrl: 'http://ba' });

    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    globalThis.fetch = fetchSpy as any;

    await svc.fanOut({ tenantId: 't-1', ticketId: 't-1', roleSlug: 'dev_agent' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retries on 5xx and stops on 2xx', async () => {
    const prisma = makePrisma();
    const svc = new AgentWebhookService(prisma as any, null);
    await svc.register({ tenantId: 't-1', roleSlug: 'dev_agent', callbackUrl: 'http://x' });

    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls < 2) return new Response('boom', { status: 500 });
      return new Response('ok', { status: 200 });
    }) as any;

    await svc.fanOut({ tenantId: 't-1', ticketId: 't-1', roleSlug: 'dev_agent' });
    expect(calls).toBe(2);
  });

  it('does NOT retry on 4xx (agent said no)', async () => {
    const prisma = makePrisma();
    const svc = new AgentWebhookService(prisma as any, null);
    await svc.register({ tenantId: 't-1', roleSlug: 'dev_agent', callbackUrl: 'http://x' });

    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response('nope', { status: 403 });
    }) as any;

    await svc.fanOut({ tenantId: 't-1', ticketId: 't-1', roleSlug: 'dev_agent' });
    expect(calls).toBe(1);
  });
});

describe('AgentWebhookService event subscription', () => {
  it('auto-fires fanOut when TicketService emits ticket.ready', async () => {
    const prisma = makePrisma();
    const tickets = makeFakeTickets();
    const svc = new AgentWebhookService(prisma as any, tickets);
    const fanSpy = vi.spyOn(svc, 'fanOut').mockResolvedValue();

    tickets.emit({ tenantId: 't-1', ticketId: 't-1', roleSlug: 'dev_agent' });
    // EventEmitter fires synchronously; let the microtask settle
    await new Promise((r) => setImmediate(r));
    expect(fanSpy).toHaveBeenCalledWith({ tenantId: 't-1', ticketId: 't-1', roleSlug: 'dev_agent' });
    svc.shutdown();
  });

  it('shutdown() unsubscribes so later events do nothing', async () => {
    const prisma = makePrisma();
    const tickets = makeFakeTickets();
    const svc = new AgentWebhookService(prisma as any, tickets);
    const fanSpy = vi.spyOn(svc, 'fanOut').mockResolvedValue();
    svc.shutdown();

    tickets.emit({ tenantId: 't-1', ticketId: 't-1', roleSlug: 'dev_agent' });
    await new Promise((r) => setImmediate(r));
    expect(fanSpy).not.toHaveBeenCalled();
  });
});
