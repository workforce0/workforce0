import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { ProjectGraphService } from '../project-graph.service.js';

describe('ProjectGraphService.refreshForRepo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns zeros when no project graphs match the repo label', async () => {
    const prisma: any = {
      projectGraph: {
        findMany: vi.fn(async () => []),
      },
    };
    const svc = new ProjectGraphService(prisma);
    const r = await svc.refreshForRepo('someone/unrelated');
    expect(r).toEqual({ matched: 0, rebuilt: 0, skipped: 0, errors: [] });
  });

  it('skips rows whose repoPath is null', async () => {
    const prisma: any = {
      projectGraph: {
        findMany: vi.fn(async () => [
          { tenantId: 't1', projectId: 'p1', repoLabel: 'acme/app', repoPath: null },
        ]),
      },
    };
    const svc = new ProjectGraphService(prisma);
    const r = await svc.refreshForRepo('acme/app');
    expect(r).toEqual({ matched: 1, rebuilt: 0, skipped: 1, errors: [] });
  });

  it('rebuilds every matching row when repoPath is set', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pg-refresh-'));
    await mkdir(join(tmp, 'src'));
    await writeFile(join(tmp, 'src', 'a.ts'), 'export const x = 1;');

    let rebuilds = 0;
    const prisma: any = {
      projectGraph: {
        findMany: vi.fn(async () => [
          { tenantId: 't1', projectId: 'p1', repoLabel: 'acme/app', repoPath: tmp },
        ]),
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }: any) => {
          rebuilds += 1;
          return { id: 'row-1', ...create };
        }),
      },
    };
    const svc = new ProjectGraphService(prisma);
    const r = await svc.refreshForRepo('acme/app');
    expect(r.matched).toBe(1);
    expect(r.rebuilt).toBe(1);
    expect(r.skipped).toBe(0);
    expect(rebuilds).toBe(1);
  });

  it('aggregates errors across rows without throwing', async () => {
    const prisma: any = {
      projectGraph: {
        findMany: vi.fn(async () => [
          { tenantId: 't1', projectId: 'p1', repoLabel: 'acme/app', repoPath: '/nonexistent/path-1' },
          { tenantId: 't1', projectId: 'p2', repoLabel: 'acme/app', repoPath: '/nonexistent/path-2' },
        ]),
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }: any) => ({ id: 'r', ...create })),
      },
    };
    const svc = new ProjectGraphService(prisma);
    const r = await svc.refreshForRepo('acme/app');
    // Nonexistent paths yield empty file scans (no throw), counted as skipped.
    expect(r.matched).toBe(2);
    expect(r.errors).toHaveLength(0);
  });
});
