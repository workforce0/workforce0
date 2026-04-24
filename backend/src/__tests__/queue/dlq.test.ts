/**
 * =============================================================================
 * DEAD LETTER QUEUE (DLQ) TESTS
 * =============================================================================
 *
 * Tests for the QueueService DLQ subsystem:
 *   - moveToDLQ pushes JSON entries to a Redis list
 *   - moveToDLQ sets 7-day TTL on the list key
 *   - moveToDLQ creates in-app notification when Prisma is available
 *   - moveToDLQ handles missing Prisma gracefully
 *   - getDLQEntries returns parsed entries
 *   - getDLQEntries returns empty array when no entries
 *   - retryDLQEntry removes entry and re-queues
 *   - retryDLQEntry returns null for non-existent jobId
 *   - Worker 'failed' event triggers moveToDLQ when retries exhausted
 *   - Worker 'failed' event does NOT trigger moveToDLQ when retries remain
 *
 * Note: moveToDLQ is private, so we exercise it through the worker 'failed'
 * event handler that BullMQ fires. For getDLQEntries / retryDLQEntry we call
 * the public API directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — these run before vi.mock
// ---------------------------------------------------------------------------
const {
  workerEventHandlers,
  mockQueueAdd,
  mockQueueGetJob,
  mockQueueGetJobCounts,
  MockQueue,
  MockWorker,
  MockQueueEvents,
} = vi.hoisted(() => {
  const workerEventHandlers: Record<string, (...args: any[]) => void> = {};

  const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'new-job-1' });
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

  const MockWorker = vi.fn(function (this: any, _name: string, _processor: any, _opts: any) {
    this.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      workerEventHandlers[event] = handler;
    });
    this.close = vi.fn().mockResolvedValue(undefined);
  });

  const MockQueueEvents = vi.fn(function (this: any) {
    this.on = vi.fn();
    this.close = vi.fn().mockResolvedValue(undefined);
  });

  return {
    workerEventHandlers,
    mockQueueAdd,
    mockQueueGetJob,
    mockQueueGetJobCounts,
    MockQueue,
    MockWorker,
    MockQueueEvents,
  };
});

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

const DLQ_TTL_SECONDS = 7 * 24 * 60 * 60; // 604800

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('Dead Letter Queue (DLQ)', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let svc: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(workerEventHandlers).forEach((k) => delete workerEventHandlers[k]);
    redis = createMockRedis();
    svc = new QueueService({ redis, prefix: 'test', rateLimit: false } as any);
  });

  // =========================================================================
  // moveToDLQ — exercised via the worker 'failed' event
  // =========================================================================

  describe('moveToDLQ (via worker failed event)', () => {
    async function startServiceWithProcessor() {
      svc.registerProcessor(JobType.MEETING_PROCESS, vi.fn());
      await svc.start();
    }

    it('should push a DLQ entry to the Redis list when retries are exhausted', async () => {
      await startServiceWithProcessor();

      const failedJob = {
        id: 'job-100',
        data: { meetingId: 'm1', tenantId: 'tenant-1' },
        attemptsMade: 5,
      };
      const error = new Error('Connection timeout');

      expect(workerEventHandlers['failed']).toBeDefined();
      await workerEventHandlers['failed'](failedJob, error, 'some-prev');

      await vi.waitFor(() => {
        expect(redis.rpush).toHaveBeenCalled();
      });

      const rpushCall = redis.rpush.mock.calls[0];
      expect(rpushCall[0]).toBe('wf0:dlq:meeting_process');

      const entry = JSON.parse(rpushCall[1]);
      expect(entry.jobId).toBe('job-100');
      expect(entry.jobType).toBe('meeting_process');
      expect(entry.failedReason).toBe('Connection timeout');
      expect(entry.attemptsMade).toBe(5);
      expect(entry.data).toEqual({ meetingId: 'm1', tenantId: 'tenant-1' });
      expect(entry.failedAt).toBeDefined();
    });

    it('should set 7-day TTL on the DLQ key', async () => {
      await startServiceWithProcessor();

      const failedJob = {
        id: 'job-101',
        data: { meetingId: 'm2', tenantId: 'tenant-2' },
        attemptsMade: 5,
      };

      await workerEventHandlers['failed'](failedJob, new Error('timeout'), '');

      await vi.waitFor(() => {
        expect(redis.expire).toHaveBeenCalledWith('wf0:dlq:meeting_process', DLQ_TTL_SECONDS);
      });
    });

    it('should create an in-app notification when Prisma is available', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 'notif-1' });
      svc.setPrisma({ notification: { create: mockCreate } });

      await startServiceWithProcessor();

      const failedJob = {
        id: 'job-102',
        data: { meetingId: 'm3', tenantId: 'tenant-3' },
        attemptsMade: 5,
      };

      await workerEventHandlers['failed'](failedJob, new Error('boom'), '');

      await vi.waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
      });

      const createCall = mockCreate.mock.calls[0][0];
      expect(createCall.data.tenantId).toBe('tenant-3');
      expect(createCall.data.type).toBe('error');
      expect(createCall.data.channel).toBe('in_app');
      expect(createCall.data.title).toContain('meeting_process');
      expect(createCall.data.message).toContain('job-102');
    });

    it('should handle missing Prisma gracefully (no notification, no crash)', async () => {
      await startServiceWithProcessor();

      const failedJob = {
        id: 'job-103',
        data: { meetingId: 'm4', tenantId: 'tenant-4' },
        attemptsMade: 5,
      };

      // Should not throw
      await workerEventHandlers['failed'](failedJob, new Error('no-prisma'), '');

      await vi.waitFor(() => {
        expect(redis.rpush).toHaveBeenCalled();
      });
    });

    it('should handle Prisma notification.create failure gracefully', async () => {
      const mockCreate = vi.fn().mockRejectedValue(new Error('DB down'));
      svc.setPrisma({ notification: { create: mockCreate } });

      await startServiceWithProcessor();

      const failedJob = {
        id: 'job-104',
        data: { meetingId: 'm5', tenantId: 'tenant-5' },
        attemptsMade: 5,
      };

      // Should not throw
      await workerEventHandlers['failed'](failedJob, new Error('fail'), '');

      await vi.waitFor(() => {
        expect(redis.rpush).toHaveBeenCalled();
      });
      await vi.waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
      });
    });

    it('should NOT move to DLQ when retries remain', async () => {
      await startServiceWithProcessor();

      const failedJob = {
        id: 'job-105',
        data: { meetingId: 'm6', tenantId: 'tenant-6' },
        attemptsMade: 3,
      };

      await workerEventHandlers['failed'](failedJob, new Error('temporary'), '');

      // Give some time for any async call
      await new Promise((r) => setTimeout(r, 50));

      expect(redis.rpush).not.toHaveBeenCalled();
    });

    it('should NOT move to DLQ when job is undefined', async () => {
      await startServiceWithProcessor();

      await workerEventHandlers['failed'](undefined, new Error('oops'), '');

      await new Promise((r) => setTimeout(r, 50));
      expect(redis.rpush).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getDLQEntries
  // =========================================================================

  describe('getDLQEntries', () => {
    it('should return parsed entries from the Redis list', async () => {
      const entries = [
        {
          jobId: 'j1',
          jobType: 'meeting_process',
          data: { meetingId: 'm1' },
          failedReason: 'err1',
          failedAt: '2026-03-01T00:00:00.000Z',
          attemptsMade: 5,
        },
        {
          jobId: 'j2',
          jobType: 'meeting_process',
          data: { meetingId: 'm2' },
          failedReason: 'err2',
          failedAt: '2026-03-02T00:00:00.000Z',
          attemptsMade: 5,
        },
      ];

      redis.lrange.mockResolvedValue(entries.map((e) => JSON.stringify(e)));

      const result = await svc.getDLQEntries(JobType.MEETING_PROCESS);

      expect(result).toHaveLength(2);
      expect(result[0].jobId).toBe('j1');
      expect(result[1].jobId).toBe('j2');
      expect(redis.lrange).toHaveBeenCalledWith('wf0:dlq:meeting_process', 0, -1);
    });

    it('should return empty array when no entries exist', async () => {
      redis.lrange.mockResolvedValue([]);

      const result = await svc.getDLQEntries(JobType.BA_AGENT_PROCESS);

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // retryDLQEntry
  // =========================================================================

  describe('retryDLQEntry', () => {
    it('should remove the entry from DLQ and re-queue a fresh job', async () => {
      const entry = {
        jobId: 'old-job-1',
        jobType: 'meeting_process',
        data: { meetingId: 'm1', tenantId: 'tenant-1' },
        failedReason: 'timeout',
        failedAt: '2026-03-01T00:00:00.000Z',
        attemptsMade: 5,
      };

      redis.lrange.mockResolvedValue([JSON.stringify(entry)]);
      mockQueueAdd.mockResolvedValue({ id: 'new-job-99' });

      const newJobId = await svc.retryDLQEntry(JobType.MEETING_PROCESS, 'old-job-1');

      expect(newJobId).toBe('new-job-99');

      expect(redis.lrem).toHaveBeenCalledWith(
        'wf0:dlq:meeting_process',
        1,
        JSON.stringify(entry),
      );

      expect(mockQueueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ meetingId: 'm1', tenantId: 'tenant-1' }),
        expect.any(Object),
      );
    });

    it('should return null for non-existent jobId', async () => {
      redis.lrange.mockResolvedValue([]);

      const result = await svc.retryDLQEntry(JobType.MEETING_PROCESS, 'does-not-exist');

      expect(result).toBeNull();
      expect(redis.lrem).not.toHaveBeenCalled();
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it('should return null when jobId does not match any DLQ entry', async () => {
      const entry = {
        jobId: 'other-job',
        jobType: 'meeting_process',
        data: { meetingId: 'm9' },
        failedReason: 'err',
        failedAt: '2026-03-01T00:00:00.000Z',
        attemptsMade: 5,
      };
      redis.lrange.mockResolvedValue([JSON.stringify(entry)]);

      const result = await svc.retryDLQEntry(JobType.MEETING_PROCESS, 'wrong-id');

      expect(result).toBeNull();
    });
  });
});
