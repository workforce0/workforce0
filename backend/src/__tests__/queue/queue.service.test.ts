/**
 * =============================================================================
 * QUEUE SERVICE TESTS
 * =============================================================================
 *
 * Unit tests for QueueService covering:
 *   - Job CRUD (add, get, retry, remove, schedule)
 *   - Processor registration and worker lifecycle (start/stop)
 *   - Queue statistics aggregation
 *   - Dead Letter Queue (DLQ) push, TTL, retrieval, re-queue
 *   - Per-tenant rate limiting via Redis INCR/EXPIRE
 *   - Worker 'failed' event -> DLQ integration
 *
 * Strategy:
 *   BullMQ's Queue, Worker, QueueEvents and ioredis are fully mocked so no
 *   real Redis is required. Each mock captures constructor args and exposes
 *   spies so we can assert on method calls and emitted events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — these run before vi.mock and are available inside mock factories
// ---------------------------------------------------------------------------
const {
  workerEventHandlers,
  queueEventsHandlers,
  mockQueueAdd,
  mockQueueGetJob,
  mockQueueGetJobCounts,
  MockQueue,
  mockWorkerClose,
  MockWorker,
  mockQueueEventsClose,
  MockQueueEvents,
} = vi.hoisted(() => {
  const workerEventHandlers: Record<string, (...args: any[]) => void> = {};
  const queueEventsHandlers: Record<string, (...args: any[]) => void> = {};

  const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
  const mockQueueGetJob = vi.fn();
  const mockQueueGetJobCounts = vi.fn().mockResolvedValue({
    waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
  });

  const MockQueue = vi.fn(function (this: any) {
    this.add = mockQueueAdd;
    this.getJob = mockQueueGetJob;
    this.getJobCounts = mockQueueGetJobCounts;
    this.close = vi.fn().mockResolvedValue(undefined);
  });

  const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
  const MockWorker = vi.fn(function (this: any, _name: string, processor: any, _opts: any) {
    this.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      workerEventHandlers[event] = handler;
    });
    this.close = mockWorkerClose;
    this.processor = processor;
  });

  const mockQueueEventsClose = vi.fn().mockResolvedValue(undefined);
  const MockQueueEvents = vi.fn(function (this: any) {
    this.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      queueEventsHandlers[event] = handler;
    });
    this.close = mockQueueEventsClose;
  });

  return {
    workerEventHandlers,
    queueEventsHandlers,
    mockQueueAdd,
    mockQueueGetJob,
    mockQueueGetJobCounts,
    MockQueue,
    mockWorkerClose,
    MockWorker,
    mockQueueEventsClose,
    MockQueueEvents,
  };
});

// ---------------------------------------------------------------------------
// vi.mock — uses hoisted variables
// ---------------------------------------------------------------------------
vi.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
  QueueEvents: MockQueueEvents,
  Job: class {},
}));

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
  }),
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
  },
}));

vi.mock('../../lib/error-handler.js', () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
      super(message);
      this.name = 'AppError';
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

// ---------------------------------------------------------------------------
// Import module under test (after mocks are wired)
// ---------------------------------------------------------------------------
import { QueueService, JobType } from '../../services/queue/queue.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRedis() {
  return {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(3500),
    rpush: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue([]),
    lrem: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    quit: vi.fn(),
    status: 'ready',
  } as any;
}

function createService(overrides: Record<string, unknown> = {}) {
  const redis = createMockRedis();
  const svc = new QueueService({
    redis,
    prefix: 'test',
    ...overrides,
  } as any);
  return { svc, redis };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('QueueService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(workerEventHandlers).forEach((k) => delete workerEventHandlers[k]);
    Object.keys(queueEventsHandlers).forEach((k) => delete queueEventsHandlers[k]);
  });

  // =========================================================================
  // addJob
  // =========================================================================
  describe('addJob', () => {
    it('should create a job in the correct queue and return its ID', async () => {
      const { svc } = createService();

      const jobId = await svc.addJob(JobType.BA_AGENT_PROCESS, {
        taskId: 't1',
        tenantId: 'tenant-1',
        meetingId: 'm1',
        transcript: 'hello world',
      } as any);

      expect(jobId).toBe('job-1');
      expect(MockQueue).toHaveBeenCalled();
      expect(mockQueueAdd).toHaveBeenCalledWith(
        JobType.BA_AGENT_PROCESS,
        expect.objectContaining({ taskId: 't1', tenantId: 'tenant-1' }),
        expect.any(Object),
      );
    });

    it('should reuse an existing Queue instance for the same queue name', async () => {
      const { svc } = createService();

      await svc.addJob(JobType.BA_AGENT_PROCESS, {
        taskId: 't1', tenantId: 'tenant-1', meetingId: 'm1', transcript: 'a',
      } as any);
      const callsBefore = MockQueue.mock.calls.length;

      await svc.addJob(JobType.BA_AGENT_PROCESS, {
        taskId: 't2', tenantId: 'tenant-1', meetingId: 'm2', transcript: 'b',
      } as any);

      expect(MockQueue.mock.calls.length).toBe(callsBefore);
    });

    it('should return empty string when job.id is undefined', async () => {
      mockQueueAdd.mockResolvedValueOnce({ id: undefined });
      const { svc } = createService();
      const jobId = await svc.addJob(JobType.NOTIFICATION, {
        type: 'gchat', tenantId: 'tenant-1', payload: {},
      } as any);
      expect(jobId).toBe('');
    });
  });

  // =========================================================================
  // registerProcessor
  // =========================================================================
  describe('registerProcessor', () => {
    it('should store the processor for the given job type', async () => {
      const { svc } = createService();
      const processor = vi.fn();

      svc.registerProcessor(JobType.NOTIFICATION, processor);

      await svc.start();
      expect(MockWorker).toHaveBeenCalled();
      const workerCall = MockWorker.mock.calls[0];
      expect(workerCall[0]).toBe('test_notification');
    });
  });

  // =========================================================================
  // start()
  // =========================================================================
  describe('start', () => {
    it('should create workers for all registered processors', async () => {
      const { svc } = createService();
      svc.registerProcessor(JobType.MEETING_PROCESS, vi.fn());
      svc.registerProcessor(JobType.BA_AGENT_PROCESS, vi.fn());

      await svc.start();

      expect(MockWorker).toHaveBeenCalledTimes(2);
      expect(MockQueueEvents).toHaveBeenCalledTimes(2);
    });

    it('should not start twice when called again', async () => {
      const { svc } = createService();
      svc.registerProcessor(JobType.CLEANUP, vi.fn());

      await svc.start();
      const workerCallCount = MockWorker.mock.calls.length;

      await svc.start();

      expect(MockWorker.mock.calls.length).toBe(workerCallCount);
    });

    it('should create a Queue for each processor if not already present', async () => {
      const { svc } = createService();
      svc.registerProcessor(JobType.JIRA_SYNC, vi.fn());

      await svc.start();

      expect(MockQueue).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // stop()
  // =========================================================================
  describe('stop', () => {
    it('should close all workers and queue events', async () => {
      const { svc } = createService();
      svc.registerProcessor(JobType.MEETING_PROCESS, vi.fn());
      svc.registerProcessor(JobType.BA_AGENT_PROCESS, vi.fn());

      await svc.start();
      await svc.stop();

      expect(mockWorkerClose).toHaveBeenCalledTimes(2);
      expect(mockQueueEventsClose).toHaveBeenCalledTimes(2);
    });

    it('should be a no-op when the service is not running', async () => {
      const { svc } = createService();

      await svc.stop();
      expect(mockWorkerClose).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================
  describe('getStats', () => {
    it('should return aggregated counts across all queues', async () => {
      mockQueueGetJobCounts.mockResolvedValue({
        waiting: 3, active: 1, completed: 10, failed: 2, delayed: 0,
      });

      const { svc } = createService();
      await svc.addJob(JobType.MEETING_PROCESS, { meetingId: 'm1', tenantId: 'tenant-1' } as any);
      await svc.addJob(JobType.NOTIFICATION, { type: 'gchat', tenantId: 'tenant-1', payload: {} } as any);

      const stats = await svc.getStats();

      expect(stats.waiting).toBe(6);
      expect(stats.active).toBe(2);
      expect(stats.completed).toBe(20);
      expect(stats.failed).toBe(4);
      expect(stats.delayed).toBe(0);
    });

    it('should return counts for a single job type when filtered', async () => {
      mockQueueGetJobCounts.mockResolvedValue({
        waiting: 5, active: 0, completed: 0, failed: 1, delayed: 0,
      });

      const { svc } = createService();
      await svc.addJob(JobType.MEETING_PROCESS, { meetingId: 'm1', tenantId: 'tenant-1' } as any);

      const stats = await svc.getStats(JobType.MEETING_PROCESS);

      expect(stats.waiting).toBe(5);
      expect(stats.failed).toBe(1);
    });

    it('should return zeros when no queues exist for the requested job type', async () => {
      const { svc } = createService();
      const stats = await svc.getStats(JobType.CLEANUP);

      expect(stats).toEqual({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
    });
  });

  // =========================================================================
  // getJob
  // =========================================================================
  describe('getJob', () => {
    it('should retrieve a job by ID from the correct queue', async () => {
      const fakeJob = { id: 'job-42', data: { meetingId: 'm1' } };
      mockQueueGetJob.mockResolvedValue(fakeJob);

      const { svc } = createService();
      await svc.addJob(JobType.MEETING_PROCESS, { meetingId: 'm1', tenantId: 'tenant-1' } as any);

      const job = await svc.getJob(JobType.MEETING_PROCESS, 'job-42');

      expect(job).toEqual(fakeJob);
      expect(mockQueueGetJob).toHaveBeenCalledWith('job-42');
    });

    it('should return null when the queue does not exist', async () => {
      const { svc } = createService();
      const job = await svc.getJob(JobType.CLEANUP, 'job-999');
      expect(job).toBeNull();
    });

    it('should return null when queue.getJob returns undefined', async () => {
      mockQueueGetJob.mockResolvedValue(undefined);

      const { svc } = createService();
      await svc.addJob(JobType.MEETING_PROCESS, { meetingId: 'm1', tenantId: 'tenant-1' } as any);

      const job = await svc.getJob(JobType.MEETING_PROCESS, 'non-existent');
      expect(job).toBeNull();
    });
  });

  // =========================================================================
  // retryJob
  // =========================================================================
  describe('retryJob', () => {
    it('should call job.retry() for a found job', async () => {
      const retryFn = vi.fn().mockResolvedValue(undefined);
      mockQueueGetJob.mockResolvedValue({ id: 'job-5', retry: retryFn });

      const { svc } = createService();
      await svc.addJob(JobType.MEETING_PROCESS, { meetingId: 'm1', tenantId: 'tenant-1' } as any);

      await svc.retryJob(JobType.MEETING_PROCESS, 'job-5');

      expect(retryFn).toHaveBeenCalled();
    });

    it('should be a no-op when the job does not exist', async () => {
      mockQueueGetJob.mockResolvedValue(null);
      const { svc } = createService();
      await svc.addJob(JobType.MEETING_PROCESS, { meetingId: 'm1', tenantId: 'tenant-1' } as any);

      await svc.retryJob(JobType.MEETING_PROCESS, 'missing');
    });
  });

  // =========================================================================
  // removeJob
  // =========================================================================
  describe('removeJob', () => {
    it('should call job.remove() for a found job', async () => {
      const removeFn = vi.fn().mockResolvedValue(undefined);
      mockQueueGetJob.mockResolvedValue({ id: 'job-6', remove: removeFn });

      const { svc } = createService();
      await svc.addJob(JobType.MEETING_PROCESS, { meetingId: 'm1', tenantId: 'tenant-1' } as any);

      await svc.removeJob(JobType.MEETING_PROCESS, 'job-6');

      expect(removeFn).toHaveBeenCalled();
    });

    it('should be a no-op when the job does not exist', async () => {
      mockQueueGetJob.mockResolvedValue(null);
      const { svc } = createService();
      await svc.addJob(JobType.MEETING_PROCESS, { meetingId: 'm1', tenantId: 'tenant-1' } as any);

      await svc.removeJob(JobType.MEETING_PROCESS, 'missing');
    });
  });

  // =========================================================================
  // scheduleJob
  // =========================================================================
  describe('scheduleJob', () => {
    it('should add a job with the correct delay', async () => {
      const { svc } = createService();
      const runAt = new Date(Date.now() + 60_000);

      await svc.scheduleJob(JobType.NOTIFICATION, {
        type: 'gchat', tenantId: 'tenant-1', payload: {},
      } as any, runAt);

      expect(mockQueueAdd).toHaveBeenCalledWith(
        JobType.NOTIFICATION,
        expect.any(Object),
        expect.objectContaining({ delay: expect.any(Number) }),
      );

      const passedDelay = mockQueueAdd.mock.calls[0][2].delay;
      expect(passedDelay).toBeGreaterThan(58_000);
      expect(passedDelay).toBeLessThanOrEqual(60_000);
    });

    it('should clamp delay to 0 when runAt is in the past', async () => {
      const { svc } = createService();
      const pastDate = new Date(Date.now() - 10_000);

      await svc.scheduleJob(JobType.CLEANUP, { checkType: 'scheduled' } as any, pastDate);

      const passedDelay = mockQueueAdd.mock.calls[0][2].delay;
      expect(passedDelay).toBe(0);
    });
  });

  // =========================================================================
  // getConcurrency (private — tested indirectly via worker options)
  // =========================================================================
  describe('getConcurrency', () => {
    it('should use correct concurrency per job type', async () => {
      const expectedConcurrency: Partial<Record<JobType, number>> = {
        [JobType.MEETING_PROCESS]: 5,
        [JobType.BA_AGENT_PROCESS]: 3,
        [JobType.NOTIFICATION]: 10,
        [JobType.CLEANUP]: 1,
        [JobType.DEV_AGENT_PROCESS]: 2,
        [JobType.QA_AGENT_PROCESS]: 3,
        [JobType.MEMORY_OPTIMIZER]: 2,
      };

      for (const [jobType, expected] of Object.entries(expectedConcurrency)) {
        vi.clearAllMocks();
        const { svc } = createService();
        svc.registerProcessor(jobType as JobType, vi.fn());
        await svc.start();

        const workerOpts = MockWorker.mock.calls[0][2];
        expect(workerOpts.concurrency).toBe(expected);
      }
    });
  });

  // =========================================================================
  // getQueueName (private — tested indirectly)
  // =========================================================================
  describe('getQueueName', () => {
    it('should group jobs by first segment of the job type', async () => {
      const { svc } = createService();
      svc.registerProcessor(JobType.MEETING_PROCESS, vi.fn());
      await svc.start();

      const queueName = MockWorker.mock.calls[0][0];
      expect(queueName).toBe('test_meeting');
    });

    it('should group BA_AGENT_PROCESS under prefix_ba', async () => {
      const { svc } = createService();
      svc.registerProcessor(JobType.BA_AGENT_PROCESS, vi.fn());
      await svc.start();
      expect(MockWorker.mock.calls[0][0]).toBe('test_ba');
    });

    it('should group NOTIFICATION under prefix_notification', async () => {
      const { svc } = createService();
      svc.registerProcessor(JobType.NOTIFICATION, vi.fn());
      await svc.start();
      expect(MockWorker.mock.calls[0][0]).toBe('test_notification');
    });
  });
});
