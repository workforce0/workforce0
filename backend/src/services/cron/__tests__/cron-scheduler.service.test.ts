import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CronSchedulerService, computeNextRun } from '../cron-scheduler.service.js';

describe('computeNextRun', () => {
  it('returns null for malformed expressions', () => {
    expect(computeNextRun('not a cron', new Date())).toBeNull();
    expect(computeNextRun('* * * *', new Date())).toBeNull();
  });

  it("fires on Mondays 9am UTC from '0 9 * * 1'", () => {
    // 2026-04-19 is a Sunday; next Monday is 2026-04-20
    const from = new Date(Date.UTC(2026, 3, 19, 0, 0, 0));
    const next = computeNextRun('0 9 * * 1', from);
    expect(next).not.toBeNull();
    expect(next!.getUTCDay()).toBe(1); // Monday
    expect(next!.getUTCHours()).toBe(9);
    expect(next!.getUTCMinutes()).toBe(0);
  });

  it('fires every 15 minutes', () => {
    const from = new Date(Date.UTC(2026, 3, 19, 10, 3, 0));
    const next = computeNextRun('*/15 * * * *', from);
    expect(next).not.toBeNull();
    // Next quarter-hour after :03 is :15
    expect(next!.getUTCMinutes()).toBe(15);
    expect(next!.getUTCHours()).toBe(10);
  });

  it("fires daily at a specific time ('30 14 * * *')", () => {
    const from = new Date(Date.UTC(2026, 3, 19, 10, 0, 0));
    const next = computeNextRun('30 14 * * *', from);
    expect(next!.getUTCHours()).toBe(14);
    expect(next!.getUTCMinutes()).toBe(30);
  });
});

function makePrisma() {
  const rows = new Map<string, any>();
  return {
    rows,
    scheduledJob: {
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: `job-${rows.size + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastRunAt: null,
          lastStatus: null,
          lastError: null,
          ...data,
        };
        rows.set(row.id, row);
        return row;
      }),
      findMany: vi.fn(async ({ where, orderBy, take }: any = {}) => {
        let out = Array.from(rows.values());
        if (where?.tenantId) out = out.filter((r) => r.tenantId === where.tenantId);
        if (where?.enabled !== undefined) out = out.filter((r) => r.enabled === where.enabled);
        if (where?.OR) {
          out = out.filter((r) =>
            where.OR.some((clause: any) => {
              if (clause.nextRunAt?.lte) return r.nextRunAt && r.nextRunAt <= clause.nextRunAt.lte;
              if (clause.nextRunAt === null) return r.nextRunAt == null;
              return false;
            }),
          );
        }
        if (orderBy?.createdAt === 'desc') out.sort((a, b) => +b.createdAt - +a.createdAt);
        if (take) out = out.slice(0, take);
        return out;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.id);
        // Mutate in-place so test-side references see the change
        Object.assign(existing, data, { updatedAt: new Date() });
        return existing;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        let count = 0;
        for (const [id, row] of rows.entries()) {
          if (row.id === where.id && row.tenantId === where.tenantId) {
            rows.delete(id);
            count += 1;
          }
        }
        return { count };
      }),
    },
  };
}

describe('CronSchedulerService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: CronSchedulerService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new CronSchedulerService(prisma as any);
  });

  it('rejects create() when no handler is registered for the jobType', async () => {
    await expect(
      service.create({
        tenantId: 't1',
        name: 'missing',
        cronExpression: '* * * * *',
        jobType: 'not_registered',
      }),
    ).rejects.toThrow(/No handler/);
  });

  it('create() persists a job with nextRunAt computed from the expression', async () => {
    service.register('digest', async () => {});
    const job = await service.create({
      tenantId: 't1',
      name: 'digest',
      cronExpression: '0 9 * * 1',
      jobType: 'digest',
    });
    expect(job.id).toBeTruthy();
    expect(job.enabled).toBe(true);
    expect(job.nextRunAt).toBeInstanceOf(Date);
  });

  it('tick() runs due jobs and marks lastStatus success', async () => {
    const handler = vi.fn(async () => {});
    service.register('ping', handler);
    await service.create({ tenantId: 't1', name: 'p', cronExpression: '* * * * *', jobType: 'ping' });
    // Force the row's nextRunAt into the past
    const [row] = Array.from(prisma.rows.values());
    row.nextRunAt = new Date(Date.now() - 1000);
    await service.tick();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(row.lastStatus).toBe('success');
  });

  it('tick() records error when handler throws', async () => {
    service.register('flaky', async () => {
      throw new Error('boom');
    });
    await service.create({ tenantId: 't1', name: 'f', cronExpression: '* * * * *', jobType: 'flaky' });
    const [row] = Array.from(prisma.rows.values());
    row.nextRunAt = new Date(Date.now() - 1000);
    await service.tick();
    expect(row.lastStatus).toBe('error');
    expect(row.lastError).toContain('boom');
  });

  it('tick() skips disabled jobs', async () => {
    const handler = vi.fn(async () => {});
    service.register('ping', handler);
    const job = await service.create({
      tenantId: 't1',
      name: 'p',
      cronExpression: '* * * * *',
      jobType: 'ping',
    });
    await service.setEnabled('t1', job.id, false);
    const row = prisma.rows.get(job.id);
    row.nextRunAt = new Date(Date.now() - 1000);
    await service.tick();
    expect(handler).not.toHaveBeenCalled();
  });
});
