import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { AgentRoleService } from '../agent-role.service.js';
import { BUILTIN_ROLES } from '../agent-role.types.js';

interface FakeRole {
  id: string;
  tenantId: string | null;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  systemPromptTemplate: string | null;
  allowedTools: string[];
  defaultModelConfigId: string | null;
  monthlyBudgetTokens: number | null;
  defaultConcurrency: number;
  isBuiltin: boolean;
  isActive: boolean;
}

/**
 * In-memory Prisma stub for `agent_roles` + `agent_role_versions`.
 * Only the methods the service actually calls.
 */
function makePrisma(seed: FakeRole[] = []) {
  const rows: FakeRole[] = [...seed];
  const versions: Array<{ id: string; tenantId: string | null; slug: string; version: number; snapshot: any; note: string | null; createdBy: string | null; createdAt: Date }> = [];
  let nextId = 1;
  let nextVersion = 1;

  const matches = (r: FakeRole, where: any): boolean => {
    if (where.id !== undefined && r.id !== where.id) return false;
    if (where.slug !== undefined && r.slug !== where.slug) return false;
    if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
    if ('tenantId' in where) {
      // Explicit tenantId: strict equality incl. null comparison
      if (r.tenantId !== where.tenantId) return false;
    }
    if (where.OR) {
      const anyMatch = (where.OR as any[]).some((clause) => matches(r, clause));
      if (!anyMatch) return false;
    }
    return true;
  };

  return {
    agentRole: {
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        return rows.find((r) => matches(r, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: any }) => {
        return rows.filter((r) => matches(r, where));
      }),
      create: vi.fn(async ({ data }: { data: Partial<FakeRole> }) => {
        const row: FakeRole = {
          id: `role-${nextId++}`,
          tenantId: data.tenantId ?? null,
          slug: data.slug ?? 'unknown',
          displayName: data.displayName ?? '',
          description: data.description ?? '',
          category: data.category ?? 'consultant',
          systemPromptTemplate: data.systemPromptTemplate ?? null,
          allowedTools: (data.allowedTools as string[]) ?? [],
          defaultModelConfigId: data.defaultModelConfigId ?? null,
          monthlyBudgetTokens: data.monthlyBudgetTokens ?? null,
          defaultConcurrency: data.defaultConcurrency ?? 2,
          isBuiltin: data.isBuiltin ?? false,
          isActive: data.isActive ?? true,
        };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeRole> }) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error('Not found');
        rows[idx] = { ...rows[idx]!, ...data } as FakeRole;
        return rows[idx];
      }),
    },
    agentRoleVersion: {
      findFirst: vi.fn(async ({ where, orderBy }: { where: any; orderBy?: any }) => {
        let filtered = versions.filter((v) => {
          if ('tenantId' in where && v.tenantId !== where.tenantId) return false;
          if (where.slug && v.slug !== where.slug) return false;
          if (where.id && v.id !== where.id) return false;
          return true;
        });
        if (orderBy?.version === 'desc') filtered = [...filtered].sort((a, b) => b.version - a.version);
        return filtered[0] ?? null;
      }),
      findMany: vi.fn(async ({ where, orderBy }: { where: any; orderBy?: any }) => {
        let filtered = versions.filter((v) => {
          if (v.tenantId !== where.tenantId) return false;
          if (v.slug !== where.slug) return false;
          return true;
        });
        if (orderBy?.version === 'desc') filtered = [...filtered].sort((a, b) => b.version - a.version);
        return filtered;
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const row = {
          id: `ver-${nextVersion++}`,
          tenantId: data.tenantId ?? null,
          slug: data.slug,
          version: data.version,
          snapshot: data.snapshot,
          note: data.note ?? null,
          createdBy: data.createdBy ?? null,
          createdAt: new Date(),
        };
        versions.push(row);
        return row;
      }),
    },
  };
}

describe('AgentRoleService.seedBuiltins', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates every built-in when the table is empty', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    const r = await svc.seedBuiltins();
    expect(r.inserted).toBe(BUILTIN_ROLES.length);
    expect(r.existing).toBe(0);
  });

  it('is idempotent on the second run', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();
    const second = await svc.seedBuiltins();
    expect(second.inserted).toBe(0);
    expect(second.existing).toBe(BUILTIN_ROLES.length);
  });

  it('does not overwrite a tenant-scoped override that shadows a built-in', async () => {
    const prisma = makePrisma([
      {
        id: 'r-override',
        tenantId: 't-1',
        slug: 'ba_agent',
        displayName: 'Custom BA',
        description: 'overridden',
        category: 'consultant',
        systemPromptTemplate: 'custom prompt',
        allowedTools: [],
        defaultModelConfigId: null,
        monthlyBudgetTokens: 999,
        defaultConcurrency: 5,
        isBuiltin: false,
        isActive: true,
      },
    ]);
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();
    // Override still present, unchanged
    const override = await svc.resolve('t-1', 'ba_agent');
    expect(override?.displayName).toBe('Custom BA');
    expect(override?.monthlyBudgetTokens).toBe(999);
  });
});

describe('AgentRoleService.resolve', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the global built-in when no override exists', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();
    const r = await svc.resolve('t-1', 'dev_agent');
    expect(r?.slug).toBe('dev_agent');
    expect(r?.isOverride).toBe(false);
    expect(r?.tenantId).toBeNull();
  });

  it('returns the tenant override when present, isOverride=true', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();
    await svc.upsertOverride({
      tenantId: 't-1',
      slug: 'ba_agent',
      monthlyBudgetTokens: 50_000,
    });
    const r = await svc.resolve('t-1', 'ba_agent');
    expect(r?.isOverride).toBe(true);
    expect(r?.monthlyBudgetTokens).toBe(50_000);
  });

  it('returns null for an unknown slug', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();
    expect(await svc.resolve('t-1', 'does_not_exist')).toBeNull();
  });

  it('does not leak overrides across tenants', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();
    await svc.upsertOverride({ tenantId: 't-1', slug: 'dev_agent', monthlyBudgetTokens: 1 });

    const t1 = await svc.resolve('t-1', 'dev_agent');
    const t2 = await svc.resolve('t-2', 'dev_agent');
    expect(t1?.isOverride).toBe(true);
    expect(t1?.monthlyBudgetTokens).toBe(1);
    // t-2 still sees the global built-in
    expect(t2?.isOverride).toBe(false);
    expect(t2?.monthlyBudgetTokens).toBe(BUILTIN_ROLES.find((r) => r.slug === 'dev_agent')!.monthlyBudgetTokens);
  });
});

describe('AgentRoleService.listForTenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns every active built-in with tenant overrides shadowing globals', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();
    await svc.upsertOverride({ tenantId: 't-1', slug: 'qa_agent', displayName: 'Custom QA' });

    const list = await svc.listForTenant('t-1');
    // One row per slug — no duplicates
    const slugs = list.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(list.length);
    expect(slugs.length).toBe(BUILTIN_ROLES.length);

    const qa = list.find((r) => r.slug === 'qa_agent');
    expect(qa?.displayName).toBe('Custom QA');
    expect(qa?.isOverride).toBe(true);
  });
});

describe('AgentRoleService versioning (M6)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a version snapshot on every override upsert', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();

    await svc.upsertOverride({ tenantId: 't-1', slug: 'ba_agent', monthlyBudgetTokens: 100, changedBy: 'u-1', changeNote: 'demo prep' });
    await svc.upsertOverride({ tenantId: 't-1', slug: 'ba_agent', monthlyBudgetTokens: 200, changedBy: 'u-2' });

    const versions = await svc.listVersions('t-1', 'ba_agent');
    expect(versions).toHaveLength(2);
    // Newest first
    expect(versions[0]!.version).toBe(2);
    expect(versions[1]!.version).toBe(1);
    expect(versions[1]!.note).toBe('demo prep');
    expect(versions[1]!.createdBy).toBe('u-1');
  });

  it('rolls back to a prior version, writing a NEW snapshot (non-destructive)', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();

    await svc.upsertOverride({ tenantId: 't-1', slug: 'ba_agent', monthlyBudgetTokens: 100 });
    await svc.upsertOverride({ tenantId: 't-1', slug: 'ba_agent', monthlyBudgetTokens: 999 });

    const versionsBefore = await svc.listVersions('t-1', 'ba_agent');
    expect(versionsBefore).toHaveLength(2);

    const restored = await svc.rollback('t-1', 'ba_agent', versionsBefore[1]!.id, {
      changedBy: 'u-admin',
      note: 'oops — undo the 999',
    });
    expect(restored?.monthlyBudgetTokens).toBe(100);

    const versionsAfter = await svc.listVersions('t-1', 'ba_agent');
    expect(versionsAfter).toHaveLength(3); // two originals + rollback-as-snapshot
    expect(versionsAfter[0]!.note).toBe('oops — undo the 999');
  });

  it('returns null when rolling back to a non-existent version id', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();
    await svc.upsertOverride({ tenantId: 't-1', slug: 'ba_agent', monthlyBudgetTokens: 100 });

    const r = await svc.rollback('t-1', 'ba_agent', 'ver-does-not-exist');
    expect(r).toBeNull();
  });

  it('does not leak version history across tenants', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();
    await svc.upsertOverride({ tenantId: 't-1', slug: 'ba_agent', monthlyBudgetTokens: 100 });

    const t2Versions = await svc.listVersions('t-2', 'ba_agent');
    expect(t2Versions).toHaveLength(0);
  });
});

describe('AgentRoleService.upsertOverride', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a new override inheriting built-in defaults for unspecified fields', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();

    const r = await svc.upsertOverride({
      tenantId: 't-1',
      slug: 'architect',
      monthlyBudgetTokens: 100,
    });

    expect(r.isOverride).toBe(true);
    expect(r.monthlyBudgetTokens).toBe(100);
    // Inherited from built-in
    const builtin = BUILTIN_ROLES.find((b) => b.slug === 'architect')!;
    expect(r.displayName).toBe(builtin.displayName);
    expect(r.defaultConcurrency).toBe(builtin.defaultConcurrency);
  });

  it('updates an existing override without nuking unspecified fields', async () => {
    const prisma = makePrisma();
    const svc = new AgentRoleService(prisma as any);
    await svc.seedBuiltins();

    const first = await svc.upsertOverride({
      tenantId: 't-1',
      slug: 'supervisor',
      displayName: 'Initial Name',
      monthlyBudgetTokens: 100,
    });
    const second = await svc.upsertOverride({
      tenantId: 't-1',
      slug: 'supervisor',
      monthlyBudgetTokens: 200,
    });

    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Initial Name'); // preserved
    expect(second.monthlyBudgetTokens).toBe(200); // updated
  });
});
