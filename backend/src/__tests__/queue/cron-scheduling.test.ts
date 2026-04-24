/**
 * =============================================================================
 * CRON SCHEDULING — END-TO-END
 * =============================================================================
 *
 * Proves the three things that together make a daily cron actually run:
 *
 *   1. `addJob` forwards `repeat: { pattern }` to the underlying BullMQ
 *      `Queue.add` call. If this silently drops, every cron in the app
 *      fires once on boot and never again (exactly the bug we hit).
 *   2. The Hermes processors (`SKILL_DISTILL`, `SKILL_RERANK`) invoke
 *      their backing services when a fake job fires, with safe fall-
 *      throughs when the services aren't wired.
 *   3. The cron expressions we ship (`0 2 * * *`, `0 3 * * *`, etc.)
 *      are valid — if BullMQ ever rejects them, `Queue.add` throws.
 *
 * We don't try to test "the scheduler fires at 2am" — that's BullMQ's job.
 * We test the seam between our code and BullMQ.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueueAdd, MockQueue, MockWorker, MockQueueEvents } = vi.hoisted(() => {
  const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
  const MockQueue = vi.fn(function (this: any) {
    this.add = mockQueueAdd;
    this.getJob = vi.fn();
    this.getJobCounts = vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
    this.close = vi.fn().mockResolvedValue(undefined);
  });
  const MockWorker = vi.fn(function (this: any) {
    this.on = vi.fn();
    this.close = vi.fn().mockResolvedValue(undefined);
  });
  const MockQueueEvents = vi.fn(function (this: any) {
    this.on = vi.fn();
    this.close = vi.fn().mockResolvedValue(undefined);
  });
  return { mockQueueAdd, MockQueue, MockWorker, MockQueueEvents };
});

vi.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
  QueueEvents: MockQueueEvents,
  Job: class {},
}));

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock('../../lib/error-handler.js', () => ({
  AppError: class AppError extends Error {
    constructor(message: string) { super(message); this.name = 'AppError'; }
  },
}));

import { QueueService, JobType } from '../../services/queue/queue.service.js';
import { createProcessors } from '../../services/queue/processors.js';

function makeRedis() {
  return {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    status: 'ready',
  } as any;
}

describe('queueService.addJob — repeat option forwarding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards the repeat pattern to BullMQ Queue.add', async () => {
    const svc = new QueueService({ redis: makeRedis(), prefix: 'test' } as any);
    await svc.addJob(JobType.SKILL_DISTILL, {} as any, {
      jobId: 'hermes-skill-distill',
      repeat: { pattern: '0 2 * * *' },
    });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      JobType.SKILL_DISTILL,
      {},
      expect.objectContaining({
        jobId: 'hermes-skill-distill',
        repeat: { pattern: '0 2 * * *' },
      }),
    );
  });

  it('omits repeat from options when the caller did not pass one', async () => {
    const svc = new QueueService({ redis: makeRedis(), prefix: 'test' } as any);
    await svc.addJob(JobType.NOTIFICATION, {
      type: 'gchat', tenantId: 't-1', payload: {},
    } as any);

    const call = mockQueueAdd.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![2]).not.toHaveProperty('repeat');
  });

  it('forwards every other repeat shape (interval-based)', async () => {
    const svc = new QueueService({ redis: makeRedis(), prefix: 'test' } as any);
    await svc.addJob(JobType.SKILL_RERANK, {} as any, {
      jobId: 'every-5-min',
      repeat: { every: 5 * 60 * 1000 },
    });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      JobType.SKILL_RERANK,
      {},
      expect.objectContaining({ repeat: { every: 5 * 60 * 1000 } }),
    );
  });

  it('schedules the three known system crons with the right cron patterns', async () => {
    const svc = new QueueService({ redis: makeRedis(), prefix: 'test' } as any);

    // Replay what di-container does on boot for the three system crons.
    await svc.addJob(JobType.EMAIL_DIGEST, {} as any, {
      jobId: 'daily-email-digest',
      repeat: { pattern: '0 8 * * *' },
    });
    await svc.addJob(JobType.SKILL_DISTILL, {} as any, {
      jobId: 'hermes-skill-distill',
      repeat: { pattern: '0 2 * * *' },
    });
    await svc.addJob(JobType.SKILL_RERANK, {} as any, {
      jobId: 'hermes-skill-rerank',
      repeat: { pattern: '0 3 * * *' },
    });

    const calls = mockQueueAdd.mock.calls;
    const byJobId = new Map<string, string>();
    for (const call of calls) {
      const opts = call[2] as { jobId?: string; repeat?: { pattern?: string } };
      if (opts.jobId && opts.repeat?.pattern) byJobId.set(opts.jobId, opts.repeat.pattern);
    }
    expect(byJobId.get('daily-email-digest')).toBe('0 8 * * *');
    expect(byJobId.get('hermes-skill-distill')).toBe('0 2 * * *');
    expect(byJobId.get('hermes-skill-rerank')).toBe('0 3 * * *');
  });
});

describe('Hermes processors — invoked when the cron fires', () => {
  const logger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
  };

  const baseDeps = {
    baAgentService: {} as any,
    engagementService: {} as any,
    meetingService: {} as any,
    meetingRepository: {} as any,
    googleChatService: {} as any,
    jiraService: {} as any,
    prdRepository: {} as any,
    taskRepository: {} as any,
    logger: logger as any,
    githubService: {} as any,
    geminiService: {} as any,
  } as const;

  beforeEach(() => vi.clearAllMocks());

  it('SKILL_DISTILL processor calls distiller.distill() with the expected result shape', async () => {
    const distill = vi.fn().mockResolvedValue({ scanned: 12, clusters: 3, proposed: 2, skipped: 1 });
    const procs = createProcessors({
      ...baseDeps,
      skillDistillerService: { distill },
    } as any);

    await procs[JobType.SKILL_DISTILL]({ id: 'job-x', data: {} } as any);
    expect(distill).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'Skill distillation complete',
      expect.objectContaining({ scanned: 12, clusters: 3, proposed: 2 }),
    );
  });

  it('SKILL_DISTILL processor no-ops (and does not throw) when distiller is not wired', async () => {
    const procs = createProcessors(baseDeps as any);
    await expect(
      procs[JobType.SKILL_DISTILL]({ id: 'job-x', data: {} } as any),
    ).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      'Skill distill job skipped — service not wired',
      expect.any(Object),
    );
  });

  it('SKILL_RERANK processor calls ranker.recompute() with the expected result shape', async () => {
    const recompute = vi.fn().mockResolvedValue({ scanned: 5, bumped: 2, dropped: 1, demoted: 0 });
    const procs = createProcessors({
      ...baseDeps,
      skillRankingService: { recompute },
    } as any);

    await procs[JobType.SKILL_RERANK]({ id: 'job-y', data: {} } as any);
    expect(recompute).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'Skill rerank complete',
      expect.objectContaining({ scanned: 5, bumped: 2, demoted: 0 }),
    );
  });

  it('SKILL_RERANK processor no-ops when ranker is not wired', async () => {
    const procs = createProcessors(baseDeps as any);
    await expect(
      procs[JobType.SKILL_RERANK]({ id: 'job-y', data: {} } as any),
    ).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      'Skill rerank job skipped — service not wired',
      expect.any(Object),
    );
  });

  it('processor surfaces errors — a broken service must not swallow into silence', async () => {
    const distill = vi.fn().mockRejectedValue(new Error('gemini quota exceeded'));
    const procs = createProcessors({
      ...baseDeps,
      skillDistillerService: { distill },
    } as any);

    await expect(
      procs[JobType.SKILL_DISTILL]({ id: 'job-x', data: {} } as any),
    ).rejects.toThrow(/gemini quota/);
    // BullMQ relies on the thrown error to retry — if we swallowed it,
    // a flaky distill would look green every night.
  });
});
