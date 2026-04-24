import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  TaskRepository,
  mapTaskStatusToTicketStatus,
  buildTicketTitle,
} from '../task.repository.js';

/**
 * Narrow Prisma stub covering the AgentTask + Ticket surface TaskRepository
 * uses when it mirrors a write. Each `ticket.upsert` call is captured so
 * tests can assert that status transitions propagate to the Ticket row.
 */
function makePrisma() {
  const tasks = new Map<string, any>();
  let nextId = 1;
  const ticketUpserts: Array<{ where: any; create: any; update: any }> = [];

  return {
    agentTask: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = `task-${nextId++}`;
        const row = {
          id,
          tenantId: data.tenantId,
          agentType: data.agentType,
          meetingId: data.meetingId ?? null,
          projectId: data.projectId ?? null,
          goalId: data.goalId ?? null,
          status: data.status ?? 'pending',
          input: data.input ?? {},
          output: data.output ?? null,
          confidence: data.confidence ?? 0,
          requiresApproval: data.requiresApproval ?? false,
          approvedBy: null,
          approvedAt: null,
          error: null,
          retryCount: data.retryCount ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
        };
        tasks.set(id, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => tasks.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const row = tasks.get(where.id);
        if (!row) throw new Error('not found');
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in (v as any)) {
            row[k] = (row[k] ?? 0) + (v as any).increment;
          } else {
            row[k] = v;
          }
        }
        row.updatedAt = new Date();
        return row;
      }),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    ticket: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        ticketUpserts.push({ where, create, update });
        return { ...create, ...update, id: where.id };
      }),
    },
    __ticketUpserts: ticketUpserts,
  };
}

describe('mapTaskStatusToTicketStatus', () => {
  it.each([
    ['pending', 'ready'],
    ['processing', 'claimed'],
    ['awaiting_clarification', 'waiting'],
    ['awaiting_approval', 'waiting'],
    ['completed', 'done'],
    ['approved', 'done'],
    ['failed', 'failed'],
    ['rejected', 'failed'],
    ['garbage', 'ready'],
  ])('maps AgentTask status %s → Ticket status %s', (input, expected) => {
    expect(mapTaskStatusToTicketStatus(input)).toBe(expected);
  });
});

describe('buildTicketTitle', () => {
  it('renders "<agentType> — meeting <short id>" when a meeting is present', () => {
    expect(buildTicketTitle('ba_agent', 'meeting-abcdef1234')).toBe('ba_agent — meeting meeting-');
  });

  it('falls back to "<agentType> — standalone" when there is no meeting', () => {
    expect(buildTicketTitle('dev_agent', null)).toBe('dev_agent — standalone');
  });
});

describe('TaskRepository mirror write', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a ticket with the same tenant + meeting + payload on createTask', async () => {
    const prisma = makePrisma();
    const repo = new TaskRepository(prisma as any);
    await repo.createTask({
      tenantId: 't1',
      agentType: 'ba_agent',
      meetingId: 'm1',
      input: { type: 'meeting_transcript', transcript: 'hi' },
    });

    expect(prisma.__ticketUpserts).toHaveLength(1);
    const call = prisma.__ticketUpserts[0];
    expect(call.where.id).toMatch(/^tix_legacy_/);
    expect(call.create.tenantId).toBe('t1');
    expect(call.create.meetingId).toBe('m1');
    expect(call.create.roleSlug).toBe('ba_agent');
    expect(call.create.status).toBe('ready');
    expect(call.create.payload).toMatchObject({ type: 'meeting_transcript' });
  });

  it('propagates status transitions to the Ticket row', async () => {
    const prisma = makePrisma();
    const repo = new TaskRepository(prisma as any);
    const task = await repo.createTask({
      tenantId: 't1',
      agentType: 'ba_agent',
      input: { type: 'x' },
    });
    await repo.updateStatus(task.id, 'processing');

    const last = prisma.__ticketUpserts.at(-1)!;
    expect(last.update.status).toBe('claimed');
  });

  it('mirrors approval onto the Ticket with approvedBy + approvedAt set', async () => {
    const prisma = makePrisma();
    const repo = new TaskRepository(prisma as any);
    const task = await repo.createTask({ tenantId: 't1', agentType: 'ba_agent', input: { type: 'noop' } });
    await repo.approveTask(task.id, 'user-123');

    const last = prisma.__ticketUpserts.at(-1)!;
    expect(last.update.status).toBe('done');
    expect(last.update.approvedBy).toBe('user-123');
    expect(last.update.approvedAt).toBeInstanceOf(Date);
  });

  it('mirrors rejection onto the Ticket as failed with the reason in error', async () => {
    const prisma = makePrisma();
    const repo = new TaskRepository(prisma as any);
    const task = await repo.createTask({ tenantId: 't1', agentType: 'ba_agent', input: { type: 'noop' } });
    await repo.rejectTask(task.id, 'user-123', 'not actionable');

    const last = prisma.__ticketUpserts.at(-1)!;
    expect(last.update.status).toBe('failed');
    expect(last.update.error).toContain('not actionable');
  });

  it('mirrors completeTask with output and confidence onto the Ticket', async () => {
    const prisma = makePrisma();
    const repo = new TaskRepository(prisma as any);
    const task = await repo.createTask({ tenantId: 't1', agentType: 'ba_agent', input: { type: 'noop' } });
    await repo.completeTask(task.id, { prd: { title: 'T' } }, 0.87);

    const last = prisma.__ticketUpserts.at(-1)!;
    expect(last.update.status).toBe('done');
    expect(last.update.confidence).toBe(0.87);
    expect(last.update.result).toMatchObject({ prd: { title: 'T' } });
    expect(last.update.completedAt).toBeInstanceOf(Date);
  });

  it('does not throw when the mirror upsert itself fails (non-fatal)', async () => {
    const prisma = makePrisma();
    // Make the upsert explode — the primary AgentTask flow must still succeed.
    (prisma.ticket.upsert as any).mockRejectedValueOnce(new Error('boom'));
    const repo = new TaskRepository(prisma as any);
    const task = await repo.createTask({ tenantId: 't1', agentType: 'ba_agent', input: { type: 'noop' } });
    expect(task.id).toMatch(/^task-/);
  });

  it('uses a deterministic ticket id so repeat mirrors are idempotent', async () => {
    const prisma = makePrisma();
    const repo = new TaskRepository(prisma as any);
    const task = await repo.createTask({ tenantId: 't1', agentType: 'ba_agent', input: { type: 'noop' } });
    await repo.updateStatus(task.id, 'processing');
    await repo.updateStatus(task.id, 'completed');

    const ids = prisma.__ticketUpserts.map((c) => c.where.id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(`tix_legacy_${task.id}`);
  });
});
