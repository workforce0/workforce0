import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { ProjectService } from '../project.service.js';

/** In-memory Prisma stub covering the narrow surface ProjectService uses. */
function makePrisma(opts: {
  meetingCount?: number;
  prdCount?: number;
  engagementCount?: number;
  ticketCount?: number;
} = {}) {
  const projects = new Map<string, any>();
  let nextId = 1;

  return {
    project: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = `proj-${nextId++}`;
        const row = {
          id,
          tenantId: data.tenantId,
          name: data.name,
          slug: data.slug,
          description: data.description ?? null,
          color: data.color ?? null,
          isArchived: false,
          createdBy: data.createdBy ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        projects.set(id, row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        for (const row of projects.values()) {
          if (where.tenantId && row.tenantId !== where.tenantId) continue;
          if (where.id && row.id !== where.id) continue;
          if (where.slug && row.slug !== where.slug) continue;
          return row;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where, orderBy: _orderBy }: { where: any; orderBy?: any }) => {
        const out: any[] = [];
        for (const row of projects.values()) {
          if (row.tenantId !== where.tenantId) continue;
          if (where.isArchived !== undefined && row.isArchived !== where.isArchived) continue;
          out.push(row);
        }
        return out;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const row = projects.get(where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = projects.get(where.id);
        if (!row) throw new Error('not found');
        projects.delete(where.id);
        return row;
      }),
    },
    meeting: { count: vi.fn(async () => opts.meetingCount ?? 0) },
    pRD: { count: vi.fn(async () => opts.prdCount ?? 0) },
    engagement: { count: vi.fn(async () => opts.engagementCount ?? 0) },
    ticket: { count: vi.fn(async () => opts.ticketCount ?? 0) },
  };
}

describe('ProjectService CRUD', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a project with a slug derived from the name', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    const p = await svc.create({ tenantId: 't1', name: 'Voice Onboarding' });
    expect(p.name).toBe('Voice Onboarding');
    expect(p.slug).toBe('voice-onboarding');
    expect(p.isArchived).toBe(false);
  });

  it('honors an explicit slug', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    const p = await svc.create({ tenantId: 't1', name: 'Something', slug: 'custom-slug' });
    expect(p.slug).toBe('custom-slug');
  });

  it('retries with a numeric suffix when slug collides within a tenant', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    await svc.create({ tenantId: 't1', name: 'Mobile App' });
    const p2 = await svc.create({ tenantId: 't1', name: 'Mobile App' });
    expect(p2.slug).toBe('mobile-app-2');
  });

  it('lets the same slug exist in a different tenant', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    const a = await svc.create({ tenantId: 't1', name: 'Shared Slug' });
    const b = await svc.create({ tenantId: 't2', name: 'Shared Slug' });
    expect(a.slug).toBe(b.slug);
    expect(a.tenantId).not.toBe(b.tenantId);
  });

  it('lists only the tenant\'s projects and hides archived by default', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    await svc.create({ tenantId: 't1', name: 'Keep' });
    const toArchive = await svc.create({ tenantId: 't1', name: 'Sunset' });
    await svc.create({ tenantId: 't2', name: 'Other tenant' });
    await svc.update('t1', toArchive.id, { isArchived: true });

    const active = await svc.listForTenant('t1');
    expect(active.map((p) => p.name)).toEqual(['Keep']);

    const all = await svc.listForTenant('t1', { includeArchived: true });
    expect(all).toHaveLength(2);
  });

  it('does not leak projects across tenants via findById', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    const p = await svc.create({ tenantId: 't1', name: 'Mine' });
    expect(await svc.findById('t2', p.id)).toBeNull();
  });

  it('findBySlug returns null when the slug is in a different tenant', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    await svc.create({ tenantId: 't1', name: 'Alpha', slug: 'alpha' });
    expect(await svc.findBySlug('t2', 'alpha')).toBeNull();
  });

  it('update returns null for a project that is not in this tenant', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    const p = await svc.create({ tenantId: 't1', name: 'X' });
    expect(await svc.update('other', p.id, { name: 'Renamed' })).toBeNull();
  });

  it('refuses to delete when meetings still reference the project', async () => {
    const prisma = makePrisma({ meetingCount: 3 });
    const svc = new ProjectService(prisma as any);
    const p = await svc.create({ tenantId: 't1', name: 'Busy' });
    const r = await svc.remove('t1', p.id);
    expect(r.deleted).toBe(false);
    expect(r.reason).toMatch(/3 referring rows/);
  });

  it('hard-deletes an empty project', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    const p = await svc.create({ tenantId: 't1', name: 'Empty' });
    const r = await svc.remove('t1', p.id);
    expect(r.deleted).toBe(true);
    expect(await svc.findById('t1', p.id)).toBeNull();
  });

  it('remove returns not_found when the project is in a different tenant', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    const p = await svc.create({ tenantId: 't1', name: 'X' });
    const r = await svc.remove('t2', p.id);
    expect(r.deleted).toBe(false);
    expect(r.reason).toBe('not_found');
  });
});

describe('ProjectService.ensureDefaultFor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a Default project on first call', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    const p = await svc.ensureDefaultFor('t1');
    expect(p.name).toBe('Default');
    expect(p.slug).toBe('default');
  });

  it('is idempotent — returns the same project on repeat calls', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    const a = await svc.ensureDefaultFor('t1');
    const b = await svc.ensureDefaultFor('t1');
    expect(a.id).toBe(b.id);
    // One create call despite two ensure calls.
    expect(prisma.project.create).toHaveBeenCalledTimes(1);
  });

  it('creates per-tenant Default projects independently', async () => {
    const prisma = makePrisma();
    const svc = new ProjectService(prisma as any);
    const a = await svc.ensureDefaultFor('t1');
    const b = await svc.ensureDefaultFor('t2');
    expect(a.id).not.toBe(b.id);
    expect(a.tenantId).toBe('t1');
    expect(b.tenantId).toBe('t2');
  });
});
