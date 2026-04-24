import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { GoalService, type GoalDTO } from '../goal.service.js';

/** In-memory Prisma stub covering the narrow surface GoalService uses. */
function makePrisma(opts: { engagementGoalId?: string | null } = {}) {
  const goals = new Map<string, any>();
  let nextId = 1;

  return {
    goal: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = `goal-${nextId++}`;
        const row = {
          id,
          tenantId: data.tenantId,
          title: data.title,
          description: data.description ?? '',
          outcome: data.outcome ?? '',
          parentGoalId: data.parentGoalId ?? null,
          status: data.status ?? 'active',
          targetDate: data.targetDate ?? null,
          createdBy: data.createdBy ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        goals.set(id, row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        for (const row of goals.values()) {
          if (row.tenantId !== where.tenantId) continue;
          if (where.id && row.id !== where.id) continue;
          return row;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: any }) => {
        const out: any[] = [];
        for (const row of goals.values()) {
          if (row.tenantId !== where.tenantId) continue;
          if (where.status && row.status !== where.status) continue;
          out.push(row);
        }
        return out;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const row = goals.get(where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
    engagement: {
      findFirst: vi.fn(async () => (opts.engagementGoalId !== undefined
        ? { goalId: opts.engagementGoalId }
        : null)),
      update: vi.fn(async () => ({})),
    },
  };
}

describe('GoalService CRUD', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a goal with the supplied fields', async () => {
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    const g = await svc.create({ tenantId: 't1', title: 'Ship voice onboarding', outcome: 'Users can call and start a brief' });
    expect(g.title).toBe('Ship voice onboarding');
    expect(g.outcome).toBe('Users can call and start a brief');
    expect(g.status).toBe('active');
  });

  it('lists goals for a tenant, filtered by status', async () => {
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    await svc.create({ tenantId: 't1', title: 'A' });
    await svc.create({ tenantId: 't1', title: 'B' });
    const active = await svc.listForTenant('t1');
    expect(active).toHaveLength(2);
  });

  it('does not leak goals across tenants', async () => {
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    await svc.create({ tenantId: 't1', title: 'mine' });
    expect(await svc.listForTenant('t2')).toHaveLength(0);
  });

  it('updates status to achieved', async () => {
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    const g = await svc.create({ tenantId: 't1', title: 'X' });
    const after = await svc.update('t1', g.id, { status: 'achieved' });
    expect(after?.status).toBe('achieved');
  });

  it('returns null when updating a goal that is not in this tenant', async () => {
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    const g = await svc.create({ tenantId: 't1', title: 'X' });
    expect(await svc.update('other', g.id, { status: 'abandoned' })).toBeNull();
  });
});

describe('GoalService.listAncestors', () => {
  it('walks parent → self and returns root-first order', async () => {
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    const root = await svc.create({ tenantId: 't1', title: 'Company: Ship Q2 features' });
    const child = await svc.create({ tenantId: 't1', title: 'Voice onboarding', parentGoalId: root.id });
    const grand = await svc.create({ tenantId: 't1', title: 'Dial-in works', parentGoalId: child.id });

    const chain = await svc.listAncestors('t1', grand.id);
    expect(chain.map((g) => g.title)).toEqual([
      'Company: Ship Q2 features',
      'Voice onboarding',
      'Dial-in works',
    ]);
  });

  it('terminates on a self-cycle without looping forever', async () => {
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    const a = await svc.create({ tenantId: 't1', title: 'A' });
    // Simulate a corrupted cycle: A's parent is A itself.
    (prisma.goal.findFirst as any).mockImplementation(async ({ where }: any) => {
      if (where.id === a.id) return { ...a, parentGoalId: a.id };
      return null;
    });
    const chain = await svc.listAncestors('t1', a.id);
    expect(chain).toHaveLength(1);
  });
});

describe('GoalService.ensureForEngagement', () => {
  it('creates a goal from the engagement title when none is set', async () => {
    const prisma = makePrisma({ engagementGoalId: null });
    const svc = new GoalService(prisma as any);
    const goal = await svc.ensureForEngagement('t1', {
      id: 'eng-1',
      goalId: null,
      title: 'Webhook retry feature',
      meetingId: 'm1',
    });
    expect(goal?.title).toBe('Webhook retry feature');
    expect(goal?.outcome).toMatch(/Deliver/);
  });

  it('returns the existing goal when one is already wired', async () => {
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    const existing = await svc.create({ tenantId: 't1', title: 'Existing' });
    const found = await svc.ensureForEngagement('t1', {
      id: 'eng-1',
      goalId: existing.id,
      title: 'X',
      meetingId: 'm1',
    });
    expect(found?.id).toBe(existing.id);
    expect(found?.title).toBe('Existing');
  });
});

describe('GoalService.resolveForTask', () => {
  it('returns the task-scoped goal when task.goalId is set', async () => {
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    const goal = await svc.create({ tenantId: 't1', title: 'Task-level' });
    const r = await svc.resolveForTask('t1', { id: 'task-x', goalId: goal.id, meetingId: 'm1' });
    expect(r?.id).toBe(goal.id);
  });

  it('falls back to the engagement goal when task.goalId is null', async () => {
    // This one is integration-flavored — we mock engagement.findFirst to return the goalId
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    const goal = await svc.create({ tenantId: 't1', title: 'Engagement-level' });
    (prisma.engagement.findFirst as any).mockResolvedValueOnce({ goalId: goal.id });
    const r = await svc.resolveForTask('t1', { id: 'task-y', goalId: null, meetingId: 'm1' });
    expect(r?.id).toBe(goal.id);
  });

  it('returns null when nothing is wired', async () => {
    const prisma = makePrisma();
    const svc = new GoalService(prisma as any);
    (prisma.engagement.findFirst as any).mockResolvedValueOnce(null);
    const r = await svc.resolveForTask('t1', { id: 'task-z', goalId: null, meetingId: 'm1' });
    expect(r).toBeNull();
  });
});

describe('GoalService.renderContextBlock', () => {
  const goal = (overrides: Partial<GoalDTO> = {}): GoalDTO => ({
    id: 'g1',
    tenantId: 't1',
    title: 'Ship the thing',
    description: '',
    outcome: 'Users can use the thing',
    parentGoalId: null,
    status: 'active',
    targetDate: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it('renders a single goal as "Working toward: title — outcome"', () => {
    const out = GoalService.renderContextBlock(goal());
    expect(out).toContain('Working toward:');
    expect(out).toContain('Ship the thing — Users can use the thing');
  });

  it('renders an indented chain top-down', () => {
    const out = GoalService.renderContextBlock([
      goal({ id: 'r', title: 'Company goal' }),
      goal({ id: 'c', title: 'Project goal' }),
      goal({ id: 'l', title: 'Leaf goal' }),
    ]);
    const lines = out.split('\n');
    expect(lines[1]).toMatch(/^- Company/);
    expect(lines[2]).toMatch(/^  - Project/);
    expect(lines[3]).toMatch(/^    - Leaf/);
  });

  it('returns empty string for empty input', () => {
    expect(GoalService.renderContextBlock([])).toBe('');
  });
});
