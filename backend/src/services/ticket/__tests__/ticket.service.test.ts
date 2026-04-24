import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { TicketService } from '../ticket.service.js';

function makePrisma() {
  const tickets = new Map<string, any>();
  const events: any[] = [];
  let nextT = 1;
  let nextE = 1;

  return {
    store: { tickets, events },
    ticket: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = `t-${nextT++}`;
        const row = {
          id,
          tenantId: data.tenantId,
          goalId: data.goalId ?? null,
          parentTicketId: data.parentTicketId ?? null,
          roleSlug: data.roleSlug,
          title: data.title,
          description: data.description ?? '',
          status: data.status ?? 'ready',
          claimedByAgent: null,
          claimedAt: null,
          payload: data.payload ?? {},
          result: null,
          error: null,
          priority: data.priority ?? 100,
          createdBy: data.createdBy ?? null,
          createdAt: new Date(Date.now() + nextT), // preserve insertion order for FIFO
          updatedAt: new Date(),
          completedAt: null,
        };
        tickets.set(id, row);
        return row;
      }),
      findFirst: vi.fn(async ({ where, orderBy }: { where: any; orderBy?: any[] }) => {
        let results = [...tickets.values()].filter((t) => {
          if (where.tenantId && t.tenantId !== where.tenantId) return false;
          if (where.id && t.id !== where.id) return false;
          if (where.roleSlug && t.roleSlug !== where.roleSlug) return false;
          if (where.status && t.status !== where.status) return false;
          return true;
        });
        if (orderBy) {
          results.sort((a, b) => {
            for (const o of orderBy) {
              const [k, d] = Object.entries(o)[0]!;
              const av = (a as any)[k];
              const bv = (b as any)[k];
              if (av < bv) return d === 'asc' ? -1 : 1;
              if (av > bv) return d === 'asc' ? 1 : -1;
            }
            return 0;
          });
        }
        return results[0] ?? null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => tickets.get(where.id) ?? null),
      findMany: vi.fn(async ({ where, orderBy, take }: { where: any; orderBy?: any[]; take?: number }) => {
        let results = [...tickets.values()].filter((t) => {
          if (t.tenantId !== where.tenantId) return false;
          if (where.roleSlug && t.roleSlug !== where.roleSlug) return false;
          if (where.status && t.status !== where.status) return false;
          return true;
        });
        if (orderBy) {
          results.sort((a, b) => {
            for (const o of orderBy) {
              const [k, d] = Object.entries(o)[0]!;
              const av = (a as any)[k];
              const bv = (b as any)[k];
              if (av < bv) return d === 'asc' ? -1 : 1;
              if (av > bv) return d === 'asc' ? 1 : -1;
            }
            return 0;
          });
        }
        return take ? results.slice(0, take) : results;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const row = tickets.get(where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: any; data: any }) => {
        let count = 0;
        for (const row of tickets.values()) {
          if (where.id && row.id !== where.id) continue;
          if (where.status && row.status !== where.status) continue;
          Object.assign(row, data, { updatedAt: new Date() });
          count++;
        }
        return { count };
      }),
    },
    ticketEvent: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const ev = {
          id: `e-${nextE++}`,
          ticketId: data.ticketId,
          kind: data.kind,
          actor: data.actor,
          data: data.data ?? {},
          createdAt: new Date(),
        };
        events.push(ev);
        return ev;
      }),
      findMany: vi.fn(async ({ where }: { where: any }) => {
        return events.filter((e) => e.ticketId === where.ticketId).sort((a, b) => a.id.localeCompare(b.id));
      }),
    },
  };
}

describe('TicketService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a ticket in status=ready with priority=100 by default', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({
      tenantId: 't-1',
      roleSlug: 'dev_agent',
      title: 'Implement retry',
    });
    expect(t.status).toBe('ready');
    expect(t.priority).toBe(100);
    expect(t.roleSlug).toBe('dev_agent');
  });

  it('records a "created" event', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'ba_agent', title: 'X', createdBy: 'u-1' });
    const evs = await svc.listEvents('t-1', t.id);
    expect(evs[0]?.kind).toBe('created');
    expect(evs[0]?.actor).toBe('u-1');
  });
});

describe('TicketService.claimNext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no ready tickets exist for the role', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    expect(await svc.claimNext('t-1', 'dev_agent', 'agent-1')).toBeNull();
  });

  it('claims one ticket and flips its status to claimed', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'Task' });
    const claimed = await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    expect(claimed?.id).toBe(t.id);
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.claimedByAgent).toBe('agent-1');
  });

  it('only returns tickets matching the requested role', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    await svc.create({ tenantId: 't-1', roleSlug: 'ba_agent', title: 'BA work' });
    await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'Dev work' });
    const claimed = await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    expect(claimed?.title).toBe('Dev work');
  });

  it('picks higher priority first, then FIFO within a priority', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const low = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'Low', priority: 10 });
    const high = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'High', priority: 500 });
    const first = await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    expect(first?.id).toBe(high.id);
    const second = await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    expect(second?.id).toBe(low.id);
  });

  it('two concurrent claims do not both succeed (single-writer)', async () => {
    // Model the race: claim uses `updateMany where status=ready`, so a
    // simultaneous second update finds 0 rows and retries.
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'Only one' });

    const [a, b] = await Promise.all([
      svc.claimNext('t-1', 'dev_agent', 'agent-A'),
      svc.claimNext('t-1', 'dev_agent', 'agent-B'),
    ]);
    const winners = [a, b].filter((x): x is NonNullable<typeof x> => x !== null);
    expect(winners).toHaveLength(1);
  });
});

describe('TicketService.transition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moves claimed → done with a result payload', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'X' });
    await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    const done = await svc.transition('t-1', t.id, 'done', {
      actor: 'agent-1',
      result: { branch: 'workforce0/prd-abc', commit: '59c7ab3' },
    });
    expect(done.status).toBe('done');
    expect(done.result).toEqual({ branch: 'workforce0/prd-abc', commit: '59c7ab3' });
    expect(done.completedAt).not.toBeNull();
  });

  it('rejects illegal transitions (done → claimed)', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'X' });
    await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    await svc.transition('t-1', t.id, 'done', { actor: 'agent-1' });
    await expect(svc.transition('t-1', t.id, 'claimed', { actor: 'agent-1' })).rejects.toThrow(/Illegal/);
  });

  it('allows failed → ready for retry', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'X' });
    await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    await svc.transition('t-1', t.id, 'failed', { actor: 'agent-1', error: 'boom' });
    const retried = await svc.transition('t-1', t.id, 'ready', { actor: 'system' });
    expect(retried.status).toBe('ready');
  });

  it('clears claimedByAgent when moved back to ready', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'X' });
    await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    const released = await svc.transition('t-1', t.id, 'ready', { actor: 'agent-1' });
    expect(released.claimedByAgent).toBeNull();
    expect(released.claimedAt).toBeNull();
  });
});

describe('TicketService.events (M6 event heartbeats)', () => {
  it('emits ticket.ready on create', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const spy = vi.fn();
    svc.events.on('ticket.ready', spy);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'X' });
    expect(spy).toHaveBeenCalledWith({ tenantId: 't-1', ticketId: t.id, roleSlug: 'dev_agent' });
  });

  it('emits ticket.claimed when a role pulls a ticket', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'X' });
    const spy = vi.fn();
    svc.events.on('ticket.claimed', spy);
    await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't-1', roleSlug: 'dev_agent', agentId: 'agent-1',
    }));
  });

  it('emits ticket.done on terminal success transition', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'X' });
    await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    const spy = vi.fn();
    svc.events.on('ticket.done', spy);
    await svc.transition('t-1', t.id, 'done', { actor: 'agent-1', result: {} });
    expect(spy).toHaveBeenCalledWith({ tenantId: 't-1', ticketId: t.id, roleSlug: 'dev_agent' });
  });

  it('emits ticket.failed with the error string on failed transition', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'X' });
    await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    const spy = vi.fn();
    svc.events.on('ticket.failed', spy);
    await svc.transition('t-1', t.id, 'failed', { actor: 'agent-1', error: 'boom' });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ error: 'boom' }));
  });

  it('emits ticket.ready when a failed ticket is retried (failed → ready)', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'X' });
    await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    await svc.transition('t-1', t.id, 'failed', { actor: 'agent-1', error: 'transient' });
    const spy = vi.fn();
    svc.events.on('ticket.ready', spy);
    await svc.transition('t-1', t.id, 'ready', { actor: 'system' });
    expect(spy).toHaveBeenCalled();
  });
});

describe('TicketService.listEvents', () => {
  it('returns the full event timeline in creation order', async () => {
    const prisma = makePrisma();
    const svc = new TicketService(prisma as any);
    const t = await svc.create({ tenantId: 't-1', roleSlug: 'dev_agent', title: 'X' });
    await svc.claimNext('t-1', 'dev_agent', 'agent-1');
    await svc.comment(t.id, 'agent-1', 'Reading the PRD');
    await svc.transition('t-1', t.id, 'done', { actor: 'agent-1', result: {} });

    const evs = await svc.listEvents('t-1', t.id);
    expect(evs.map((e) => e.kind)).toEqual(['created', 'claimed', 'comment', 'status_changed']);
  });
});
