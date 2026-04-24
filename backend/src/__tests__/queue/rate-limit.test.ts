/**
 * =============================================================================
 * QUEUE RATE LIMITING TESTS
 * =============================================================================
 *
 * Tests for the per-tenant, per-job-type rate limiting in QueueService:
 *   - enforceRateLimit increments a Redis counter
 *   - enforceRateLimit sets TTL only on the first increment
 *   - enforceRateLimit throws AppError(429) when the limit is exceeded
 *   - Rate limiting is disabled when config.rateLimit === false
 *   - skipRateLimit option bypasses the check
 *   - Different tenants have independent counters
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — these run before vi.mock
// ---------------------------------------------------------------------------
const { mockQueueAdd, MockQueue, MockWorker, MockQueueEvents } = vi.hoisted(() => {
  const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });

  const MockQueue = vi.fn(function (this: any) {
    this.add = mockQueueAdd;
    this.getJob = vi.fn();
    this.getJobCounts = vi.fn().mockResolvedValue({
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
    });
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

function createMockRedis(overrides: Record<string, any> = {}) {
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
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('Queue Rate Limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Counter increment
  // =========================================================================

  describe('enforceRateLimit increments counter', () => {
    it('should call redis.incr with the correct key', async () => {
      const redis = createMockRedis();
      const svc = new QueueService({
        redis,
        prefix: 'test',
        rateLimit: { maxJobsPerWindow: 10, windowSeconds: 60 },
      } as any);

      await svc.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1',
        tenantId: 'tenant-abc',
      } as any);

      expect(redis.incr).toHaveBeenCalledWith('wf0:rate:tenant-abc:meeting_process');
    });
  });

  // =========================================================================
  // TTL on first increment
  // =========================================================================

  describe('enforceRateLimit sets TTL on first increment', () => {
    it('should call redis.expire when counter goes from 0 to 1', async () => {
      const redis = createMockRedis({ incr: vi.fn().mockResolvedValue(1) });
      const svc = new QueueService({
        redis,
        prefix: 'test',
        rateLimit: { maxJobsPerWindow: 10, windowSeconds: 120 },
      } as any);

      await svc.addJob(JobType.NOTIFICATION, {
        type: 'gchat', tenantId: 'tenant-xyz', payload: {},
      } as any);

      expect(redis.expire).toHaveBeenCalledWith(
        'wf0:rate:tenant-xyz:notification_send',
        120,
      );
    });

    it('should NOT set TTL on subsequent increments', async () => {
      const redis = createMockRedis({ incr: vi.fn().mockResolvedValue(5) });
      const svc = new QueueService({
        redis,
        prefix: 'test',
        rateLimit: { maxJobsPerWindow: 10, windowSeconds: 60 },
      } as any);

      await svc.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1', tenantId: 'tenant-1',
      } as any);

      expect(redis.expire).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 429 when exceeded
  // =========================================================================

  describe('enforceRateLimit throws AppError(429) when exceeded', () => {
    it('should throw with statusCode 429 when counter exceeds max', async () => {
      const redis = createMockRedis({ incr: vi.fn().mockResolvedValue(21) });
      const svc = new QueueService({
        redis,
        prefix: 'test',
        rateLimit: { maxJobsPerWindow: 20, windowSeconds: 3600 },
      } as any);

      await expect(
        svc.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm1', tenantId: 'tenant-flood',
        } as any),
      ).rejects.toThrow(/rate limit exceeded/i);

      try {
        await svc.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm2', tenantId: 'tenant-flood',
        } as any);
      } catch (err: any) {
        expect(err.statusCode).toBe(429);
        expect(err.message).toContain('tenant-flood');
      }
    });

    it('should include retry-after info in the error message', async () => {
      const redis = createMockRedis({
        incr: vi.fn().mockResolvedValue(11),
        ttl: vi.fn().mockResolvedValue(2400),
      });
      const svc = new QueueService({
        redis,
        prefix: 'test',
        rateLimit: { maxJobsPerWindow: 10, windowSeconds: 3600 },
      } as any);

      try {
        await svc.addJob(JobType.NOTIFICATION, {
          type: 'gchat', tenantId: 'tenant-1', payload: {},
        } as any);
        expect.unreachable('Expected AppError to be thrown');
      } catch (err: any) {
        expect(err.message).toContain('2400');
      }
    });
  });

  // =========================================================================
  // Rate limit disabled
  // =========================================================================

  describe('rate limit disabled when config.rateLimit === false', () => {
    it('should NOT call redis.incr when rate limiting is disabled', async () => {
      const redis = createMockRedis();
      const svc = new QueueService({
        redis,
        prefix: 'test',
        rateLimit: false,
      } as any);

      await svc.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1', tenantId: 'tenant-1',
      } as any);

      expect(redis.incr).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // skipRateLimit option
  // =========================================================================

  describe('skipRateLimit option bypasses check', () => {
    it('should NOT enforce rate limit when skipRateLimit is true', async () => {
      const redis = createMockRedis({ incr: vi.fn().mockResolvedValue(999) });
      const svc = new QueueService({
        redis,
        prefix: 'test',
        rateLimit: { maxJobsPerWindow: 1, windowSeconds: 60 },
      } as any);

      const jobId = await svc.addJob(
        JobType.NOTIFICATION,
        { type: 'gchat', tenantId: 'tenant-1', payload: {} } as any,
        { skipRateLimit: true },
      );

      expect(jobId).toBe('job-1');
      expect(redis.incr).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Independent tenant counters
  // =========================================================================

  describe('different tenants have independent counters', () => {
    it('should use separate Redis keys per tenant', async () => {
      const redis = createMockRedis({ incr: vi.fn().mockResolvedValue(1) });
      const svc = new QueueService({
        redis,
        prefix: 'test',
        rateLimit: { maxJobsPerWindow: 10, windowSeconds: 60 },
      } as any);

      await svc.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1', tenantId: 'tenant-A',
      } as any);

      await svc.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm2', tenantId: 'tenant-B',
      } as any);

      expect(redis.incr).toHaveBeenCalledWith('wf0:rate:tenant-A:meeting_process');
      expect(redis.incr).toHaveBeenCalledWith('wf0:rate:tenant-B:meeting_process');
    });

    it('should not rate limit tenant-B when tenant-A is exhausted', async () => {
      const redis = createMockRedis({
        incr: vi.fn().mockImplementation((key: string) => {
          if (key.includes('tenant-A')) return Promise.resolve(21);
          return Promise.resolve(1);
        }),
      });

      const svc = new QueueService({
        redis,
        prefix: 'test',
        rateLimit: { maxJobsPerWindow: 20, windowSeconds: 3600 },
      } as any);

      await expect(
        svc.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm1', tenantId: 'tenant-A',
        } as any),
      ).rejects.toThrow(/rate limit/i);

      const jobId = await svc.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm2', tenantId: 'tenant-B',
      } as any);
      expect(jobId).toBe('job-1');
    });
  });

  // =========================================================================
  // No tenantId in data -> skip rate limit
  // =========================================================================

  describe('no tenantId in job data', () => {
    it('should skip rate limiting when tenantId is missing from data', async () => {
      const redis = createMockRedis({ incr: vi.fn().mockResolvedValue(999) });
      const svc = new QueueService({
        redis,
        prefix: 'test',
        rateLimit: { maxJobsPerWindow: 1, windowSeconds: 60 },
      } as any);

      const jobId = await svc.addJob(JobType.CLARIFICATION_TIMEOUT, {
        checkType: 'scheduled',
      } as any);

      expect(jobId).toBe('job-1');
      expect(redis.incr).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Default rate limit values
  // =========================================================================

  describe('default rate limit values', () => {
    it('should use 20 jobs per 3600s when rateLimit config is undefined', async () => {
      const redis = createMockRedis({ incr: vi.fn().mockResolvedValue(1) });
      const svc = new QueueService({
        redis,
        prefix: 'test',
      } as any);

      await svc.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1', tenantId: 'tenant-1',
      } as any);

      expect(redis.incr).toHaveBeenCalled();
      expect(redis.expire).toHaveBeenCalledWith(
        expect.any(String),
        3600,
      );
    });
  });
});
