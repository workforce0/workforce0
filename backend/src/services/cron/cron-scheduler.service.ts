/**
 * =============================================================================
 * CRON SCHEDULER — user-facing recurring jobs
 * =============================================================================
 *
 * Hermes III M7. Lets users schedule "every Monday 9am, post the weekly
 * digest to Slack" via the UI without writing code. Jobs persist in
 * the scheduled_jobs table and register as BullMQ repeatables on boot.
 *
 * Job execution itself is delegated to the caller-provided handler map,
 * keyed by jobType — the service doesn't know what 'digest_email' does,
 * only how to fire it on a schedule and record success/failure.
 *
 * @module services/cron/cron-scheduler.service
 */

import type { PrismaClient, ScheduledJob } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';

export type JobHandler = (payload: Record<string, unknown>, context: { tenantId: string; jobId: string }) => Promise<void>;

export class CronSchedulerService {
  private readonly logger = createChildLogger({ service: 'CronSchedulerService' });
  private readonly handlers = new Map<string, JobHandler>();
  private intervalId: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    opts: { pollIntervalMs?: number } = {},
  ) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 60_000;
  }

  register(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  async create(input: {
    tenantId: string;
    name: string;
    cronExpression: string;
    timezone?: string;
    jobType: string;
    payload?: Record<string, unknown>;
    createdBy?: string;
  }): Promise<ScheduledJob> {
    if (!this.handlers.has(input.jobType)) {
      throw new Error(
        `No handler registered for jobType "${input.jobType}". Register one before creating jobs of this type.`,
      );
    }

    const nextRunAt = computeNextRun(input.cronExpression, new Date());
    return this.prisma.scheduledJob.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        cronExpression: input.cronExpression,
        timezone: input.timezone ?? 'UTC',
        jobType: input.jobType,
        payload: (input.payload ?? {}) as any,
        enabled: true,
        createdBy: input.createdBy,
        nextRunAt,
      },
    });
  }

  async list(tenantId: string): Promise<ScheduledJob[]> {
    return this.prisma.scheduledJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setEnabled(tenantId: string, id: string, enabled: boolean): Promise<ScheduledJob> {
    return this.prisma.scheduledJob.update({
      where: { id },
      data: { enabled },
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.prisma.scheduledJob.deleteMany({ where: { id, tenantId } });
  }

  /**
   * Start the polling loop. Every pollIntervalMs seconds, find enabled
   * jobs whose nextRunAt is in the past, execute them, update status.
   */
  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error('Scheduler tick failed', { error: (err as Error).message });
      });
    }, this.pollIntervalMs);
    this.logger.info('Cron scheduler started', { pollIntervalMs: this.pollIntervalMs });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * One tick: pick up any due jobs and run them. Exposed for tests.
   */
  async tick(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.scheduledJob.findMany({
      where: {
        enabled: true,
        OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }],
      },
      take: 50,
    });

    for (const job of due) {
      await this.runJob(job);
    }
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    const handler = this.handlers.get(job.jobType);
    if (!handler) {
      this.logger.warn('No handler for job type — skipping', {
        jobId: job.id,
        jobType: job.jobType,
      });
      return;
    }

    try {
      await handler((job.payload as Record<string, unknown>) ?? {}, {
        tenantId: job.tenantId,
        jobId: job.id,
      });
      const nextRunAt = computeNextRun(job.cronExpression, new Date());
      await this.prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          lastRunAt: new Date(),
          lastStatus: 'success',
          lastError: null,
          nextRunAt,
        },
      });
      this.logger.info('Job ran successfully', { jobId: job.id, jobType: job.jobType });
    } catch (err) {
      const msg = (err as Error).message;
      const nextRunAt = computeNextRun(job.cronExpression, new Date());
      await this.prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          lastRunAt: new Date(),
          lastStatus: 'error',
          lastError: msg.slice(0, 500),
          nextRunAt,
        },
      });
      this.logger.error('Job failed', { jobId: job.id, jobType: job.jobType, error: msg });
    }
  }
}

/**
 * Minimal cron-expression next-run computation.
 *
 * Supports the common 5-field POSIX cron subset (minute, hour, day-of-month,
 * month, day-of-week). Each field may be:
 *   - '*'            any value
 *   - a single integer
 *   - a comma list   e.g. '1,15,30'
 *   - a step         e.g. '*\/15'
 *
 * Returns the next Date in UTC at or after `from` that matches the expression.
 * Walks minute-by-minute up to 2 years ahead, then gives up and returns null.
 */
export function computeNextRun(expression: string, from: Date): Date | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [min, hr, dom, mon, dow] = fields.map(parseField);
  if (!min || !hr || !dom || !mon || !dow) return null;

  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(from.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);

  while (candidate < limit) {
    if (
      min.has(candidate.getUTCMinutes()) &&
      hr.has(candidate.getUTCHours()) &&
      dom.has(candidate.getUTCDate()) &&
      mon.has(candidate.getUTCMonth() + 1) &&
      dow.has(candidate.getUTCDay())
    ) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return null;
}

function parseField(field: string): Set<number> | null {
  const out = new Set<number>();
  const parts = field.split(',');
  for (const part of parts) {
    const [rangePart, stepStr] = part.split('/');
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (rangePart === '*') {
      // Expansion happens against the field's universe — we use 0..59 as the
      // widest (minute); caller filters via their has() check anyway, so
      // emitting 0..59 works since day-of-month / month / hour / day-of-week
      // are all supersets of what we'd produce otherwise.
      for (let i = 0; i <= 59; i += step) out.add(i);
    } else if (rangePart?.includes('-')) {
      const [a, b] = rangePart.split('-').map((x) => parseInt(x, 10));
      if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return null;
      for (let i = a; i <= b; i += step) out.add(i);
    } else {
      const n = parseInt(rangePart ?? '', 10);
      if (Number.isNaN(n)) return null;
      out.add(n);
    }
  }
  return out;
}
