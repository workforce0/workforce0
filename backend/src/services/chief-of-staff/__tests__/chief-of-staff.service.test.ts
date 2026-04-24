import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  ChiefOfStaffService,
  buildFallbackPlan,
  errorSignature,
  PLAN_ATTEMPT_CAP,
  type PlannerContext,
} from '../chief-of-staff.service.js';

function makePrisma() {
  const plans: any[] = [];
  const tickets: any[] = [];
  let nextPlanId = 1;
  let nextTicketId = 1;
  return {
    executionPlan: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `plan-${nextPlanId++}`, ...data };
        plans.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where, orderBy: _o }: any) => {
        const match = plans.filter((p) => {
          if (where.parentTicketId && p.parentTicketId !== where.parentTicketId) return false;
          if (where.status && p.status !== where.status) return false;
          return true;
        });
        return match[match.length - 1] ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const p of plans) {
          if (p.parentTicketId === where.parentTicketId && p.status === where.status) {
            Object.assign(p, data);
            n += 1;
          }
        }
        return { count: n };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const p = plans.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      }),
    },
    ticket: {
      count: vi.fn(async ({ where }: any) => {
        return tickets.filter((t) => {
          if (t.parentTicketId !== where.parentTicketId) return false;
          if (where.status?.notIn) return !where.status.notIn.includes(t.status);
          return true;
        }).length;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return tickets.find((t) => t.id === where.id) ?? null;
      }),
    },
    __plans: plans,
    __tickets: tickets,
    __addTicket: (t: any) => {
      const row = { id: `tkt-${nextTicketId++}`, status: 'ready', ...t };
      tickets.push(row);
      return row;
    },
  };
}

function makeLibrary() {
  return {
    listCompatibleSkills: vi.fn(async () => []),
    listSubagents: vi.fn(async () => []),
  };
}

function makeTickets() {
  const created: any[] = [];
  return {
    created,
    create: vi.fn(async (input: any) => {
      const row = { id: `child-${created.length + 1}`, ...input };
      created.push(row);
      return row;
    }),
  };
}

function makeComms() {
  const sent: any[] = [];
  return {
    sent,
    send: vi.fn(async (msg: any) => {
      sent.push(msg);
      return { success: true };
    }),
  };
}

const baseCtx = (overrides: Partial<PlannerContext> = {}): PlannerContext => ({
  tenantId: 't1',
  parentTicket: {
    id: 'parent-1',
    title: 'Ship voice onboarding',
    description: 'users can dial a number to start a brief',
    roleSlug: 'chief_of_staff',
    projectId: 'proj-1',
    goalId: 'goal-1',
  },
  attempt: 1,
  ...overrides,
});

describe('buildFallbackPlan', () => {
  it('produces a single-step plan routed to ba_agent when parent is chief_of_staff', () => {
    const { steps, summary } = buildFallbackPlan(baseCtx());
    expect(steps).toHaveLength(1);
    expect(steps[0].roleSlug).toBe('ba_agent');
    expect(steps[0].title).toBe('Ship voice onboarding');
    expect(summary).toMatch(/routing/i);
  });

  it('preserves the original role when parent is not chief_of_staff', () => {
    const ctx = baseCtx({ parentTicket: { ...baseCtx().parentTicket, roleSlug: 'dev_agent' } });
    const { steps } = buildFallbackPlan(ctx);
    expect(steps[0].roleSlug).toBe('dev_agent');
  });

  it('says "retrying" on replan attempts', () => {
    const { summary } = buildFallbackPlan(baseCtx({ attempt: 2 }));
    expect(summary).toMatch(/retrying/i);
    expect(summary).toMatch(/attempt 2/i);
  });
});

describe('errorSignature', () => {
  it('normalizes file paths, uuids, and long numeric ids', () => {
    const a = 'TypeError: x at /Users/alice/repo/src/foo.ts:12:3 for req 1234567';
    const b = 'TypeError: x at /Users/bob/repo/src/foo.ts:99:7 for req 7654321';
    expect(errorSignature(a)).toBe(errorSignature(b));
  });

  it('returns null for null/empty input', () => {
    expect(errorSignature(null)).toBeNull();
    expect(errorSignature(undefined)).toBeNull();
    expect(errorSignature('')).toBeNull();
  });

  it('differentiates semantically different errors', () => {
    expect(errorSignature('ECONNREFUSED')).not.toBe(errorSignature('SyntaxError'));
  });
});

describe('ChiefOfStaffService.planTicket', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates one ExecutionPlan and one child ticket per step using the fallback', async () => {
    const prisma = makePrisma();
    const lib = makeLibrary();
    const tix = makeTickets();
    const comms = makeComms();
    const svc = new ChiefOfStaffService(prisma as any, lib as any, tix as any, comms as any);

    const result = await svc.planTicket(baseCtx());
    expect(result.planId).toBeDefined();
    expect(result.childTicketIds).toHaveLength(1);
    expect(prisma.__plans).toHaveLength(1);
    expect(prisma.__plans[0].status).toBe('active');
    expect(tix.created).toHaveLength(1);
    expect(tix.created[0].projectId).toBe('proj-1');
    expect(tix.created[0].payload.planId).toBe(prisma.__plans[0].id);
  });

  it('posts a plan_summary message to the comms channel', async () => {
    const prisma = makePrisma();
    const comms = makeComms();
    const svc = new ChiefOfStaffService(prisma as any, makeLibrary() as any, makeTickets() as any, comms as any);
    await svc.planTicket(baseCtx());
    expect(comms.send).toHaveBeenCalledTimes(1);
    expect(comms.sent[0].messageType).toBe('plan_summary');
  });

  it('supersedes any prior active plan for the same parent', async () => {
    const prisma = makePrisma();
    const svc = new ChiefOfStaffService(
      prisma as any,
      makeLibrary() as any,
      makeTickets() as any,
      makeComms() as any,
    );
    await svc.planTicket(baseCtx());
    await svc.planTicket(baseCtx({ attempt: 2, replanReason: 'step failed' }));
    expect(prisma.__plans).toHaveLength(2);
    expect(prisma.__plans[0].status).toBe('superseded');
    expect(prisma.__plans[1].status).toBe('active');
    expect(prisma.__plans[1].attempt).toBe(2);
    expect(prisma.__plans[1].replanReason).toBe('step failed');
  });

  it('refuses to plan beyond the attempt cap', async () => {
    const prisma = makePrisma();
    const svc = new ChiefOfStaffService(
      prisma as any,
      makeLibrary() as any,
      makeTickets() as any,
      makeComms() as any,
    );
    await expect(svc.planTicket(baseCtx({ attempt: PLAN_ATTEMPT_CAP + 1 }))).rejects.toThrow(/cap/);
  });

  it('uses the LLM planner when provided and falls back when it returns null', async () => {
    const prisma = makePrisma();
    const lib = makeLibrary();
    const tix = makeTickets();
    const llm = {
      plan: vi.fn(async () => ({
        steps: [
          { title: 'Review PR', description: '...', roleSlug: 'qa_agent', subagentSlug: 'code-reviewer', skills: ['pr-review'] },
        ],
        summary: 'I will review the PR with the code-reviewer subagent.',
      })),
    };
    const svc = new ChiefOfStaffService(prisma as any, lib as any, tix as any, makeComms() as any, llm as any);
    await svc.planTicket(baseCtx());
    expect(llm.plan).toHaveBeenCalledTimes(1);
    expect(tix.created[0].roleSlug).toBe('qa_agent');
    expect(tix.created[0].payload.subagentSlug).toBe('code-reviewer');
    expect(tix.created[0].payload.skills).toEqual(['pr-review']);
  });

  it('falls back to deterministic plan when the LLM throws', async () => {
    const llm = { plan: vi.fn(async () => { throw new Error('llm boom'); }) };
    const prisma = makePrisma();
    const tix = makeTickets();
    const svc = new ChiefOfStaffService(
      prisma as any,
      makeLibrary() as any,
      tix as any,
      makeComms() as any,
      llm as any,
    );
    await svc.planTicket(baseCtx());
    expect(tix.created).toHaveLength(1);
    expect(tix.created[0].roleSlug).toBe('ba_agent');
  });
});

describe('ChiefOfStaffService.recordChildFailed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('triggers a replan when under the cap with a distinct error', async () => {
    const prisma = makePrisma();
    prisma.__addTicket({ id: 'parent-1', tenantId: 't1', title: 'X', roleSlug: 'chief_of_staff' });
    prisma.__plans.push({
      id: 'plan-old',
      tenantId: 't1',
      parentTicketId: 'parent-1',
      attempt: 1,
      status: 'active',
      replanReason: null,
      steps: [],
    });
    const svc = new ChiefOfStaffService(
      prisma as any,
      makeLibrary() as any,
      makeTickets() as any,
      makeComms() as any,
    );
    const r = await svc.recordChildFailed({
      parentTicketId: 'parent-1',
      childTicketId: 'child-1',
      childTitle: 'Step A',
      error: 'ECONNREFUSED 127.0.0.1:5432',
    });
    expect(r.action).toBe('replanned');
  });

  it('escalates instead of replanning when the cap is hit', async () => {
    const prisma = makePrisma();
    prisma.__addTicket({ id: 'parent-1', tenantId: 't1', title: 'X', roleSlug: 'chief_of_staff' });
    prisma.__plans.push({
      id: 'plan-old',
      tenantId: 't1',
      parentTicketId: 'parent-1',
      attempt: PLAN_ATTEMPT_CAP,
      status: 'active',
      replanReason: null,
      steps: [],
    });
    const comms = makeComms();
    const svc = new ChiefOfStaffService(prisma as any, makeLibrary() as any, makeTickets() as any, comms as any);
    const r = await svc.recordChildFailed({
      parentTicketId: 'parent-1',
      childTicketId: 'child-1',
      childTitle: 'Step A',
      error: 'generic failure',
    });
    expect(r.action).toBe('escalated');
    const last = comms.sent.at(-1)!;
    expect(last.messageType).toBe('escalation');
    expect(last.content).toMatch(/stuck/i);
  });

  it('escalates regardless of cap when the same error appears twice', async () => {
    const prisma = makePrisma();
    prisma.__addTicket({ id: 'parent-1', tenantId: 't1', title: 'X', roleSlug: 'chief_of_staff' });
    prisma.__plans.push({
      id: 'plan-old',
      tenantId: 't1',
      parentTicketId: 'parent-1',
      attempt: 2,  // under the cap
      status: 'active',
      // Prior replan was caused by an ECONNREFUSED; the new failure is the same.
      replanReason: 'ECONNREFUSED 10.0.0.1:5432 at /some/path.ts:1:1',
      steps: [],
    });
    const comms = makeComms();
    const svc = new ChiefOfStaffService(prisma as any, makeLibrary() as any, makeTickets() as any, comms as any);
    const r = await svc.recordChildFailed({
      parentTicketId: 'parent-1',
      childTicketId: 'child-1',
      childTitle: 'Step A',
      error: 'ECONNREFUSED 10.0.0.2:5432 at /other/path.ts:9:9',
    });
    expect(r.action).toBe('escalated');
    expect(comms.sent.at(-1)!.messageType).toBe('escalation');
  });
});

describe('ChiefOfStaffService.recordChildDone', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts a "N remaining" progress update when other children are still open', async () => {
    const prisma = makePrisma();
    prisma.__addTicket({ id: 'parent-1', tenantId: 't1', title: 'X' });
    prisma.__addTicket({ parentTicketId: 'parent-1', status: 'claimed', title: 'B' });
    prisma.__plans.push({
      id: 'plan-1',
      tenantId: 't1',
      parentTicketId: 'parent-1',
      attempt: 1,
      status: 'active',
      steps: [{ title: 'A' }, { title: 'B' }],
    });
    const comms = makeComms();
    const svc = new ChiefOfStaffService(prisma as any, makeLibrary() as any, makeTickets() as any, comms as any);
    await svc.recordChildDone('parent-1', 'child-1', 'A');
    expect(comms.sent.at(-1)!.messageType).toBe('progress_update');
    expect(comms.sent.at(-1)!.content).toMatch(/1 step remaining/);
  });

  it('marks the plan done + posts a completion summary when no children are open', async () => {
    const prisma = makePrisma();
    prisma.__addTicket({ id: 'parent-1', tenantId: 't1' });
    prisma.__plans.push({
      id: 'plan-1',
      tenantId: 't1',
      parentTicketId: 'parent-1',
      attempt: 1,
      status: 'active',
      steps: [{ title: 'A' }],
    });
    const comms = makeComms();
    const svc = new ChiefOfStaffService(prisma as any, makeLibrary() as any, makeTickets() as any, comms as any);
    await svc.recordChildDone('parent-1', 'child-1', 'A');
    expect(prisma.__plans[0].status).toBe('done');
    expect(comms.sent.at(-1)!.content).toMatch(/All 1 steps done/);
  });
});
