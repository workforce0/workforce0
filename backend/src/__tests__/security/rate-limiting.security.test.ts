/**
 * =============================================================================
 * SECURITY TESTS: Rate Limiting & DLQ (queue.service.ts)
 * =============================================================================
 *
 * Validates that the QueueService:
 * - Enforces per-tenant, per-job-type rate limits
 * - Returns 429 when limits are exceeded
 * - Respects skipRateLimit bypass for system jobs
 * - Resets counters after window expiry
 * - Isolates rate limits between tenants
 *
 * These tests mock Redis and BullMQ to run as pure unit tests.
 *
 * @module __tests__/security/rate-limiting.security.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../lib/logger.js', () => {
  const childLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    createChildLogger: vi.fn().mockReturnValue(childLogger),
    logger: childLogger,
  };
});

vi.mock('../../lib/error-handler.js', () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
      this.name = 'AppError';
    }
  },
}));

// Mock BullMQ — we need proper class constructors for `new Queue(...)` etc.
vi.mock('bullmq', () => {
  const mockJob = { id: 'job-mock-1' };

  class MockQueue {
    add = vi.fn().mockResolvedValue(mockJob);
    getJobCounts = vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
    getJob = vi.fn().mockResolvedValue(null);
    constructor(..._args: any[]) {}
  }

  class MockWorker {
    on = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
    constructor(..._args: any[]) {}
  }

  class MockQueueEvents {
    on = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
    constructor(..._args: any[]) {}
  }

  return {
    Queue: MockQueue,
    Worker: MockWorker,
    QueueEvents: MockQueueEvents,
    Job: class {},
  };
});

import { QueueService, JobType } from '../../services/queue/queue.service.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Creates a mock Redis instance with an in-memory counter store.
 * Simulates INCR, EXPIRE, and TTL commands used by the rate limiter.
 */
function createMockRedis() {
  const counters: Record<string, number> = {};
  const ttls: Record<string, number> = {};

  return {
    incr: vi.fn(async (key: string) => {
      counters[key] = (counters[key] || 0) + 1;
      return counters[key];
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      ttls[key] = seconds;
      return 1;
    }),
    ttl: vi.fn(async (key: string) => {
      return ttls[key] ?? -1;
    }),
    // Helpers for test inspection
    _counters: counters,
    _ttls: ttls,
    _reset: () => {
      Object.keys(counters).forEach((k) => delete counters[k]);
      Object.keys(ttls).forEach((k) => delete ttls[k]);
    },
    // BullMQ requires these to exist on the connection object
    duplicate: vi.fn().mockReturnThis(),
    status: 'ready',
    options: {},
  } as any;
}

// =============================================================================
// Tests
// =============================================================================

describe('QueueService — Rate Limiting', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let queueService: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = createMockRedis();
    queueService = new QueueService({
      redis,
      rateLimit: {
        maxJobsPerWindow: 3,
        windowSeconds: 60,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Basic rate limit enforcement
  // ---------------------------------------------------------------------------
  describe('addJob increments Redis counter', () => {
    it('calls Redis INCR on the rate-limit key when adding a job', async () => {
      await queueService.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1',
        tenantId: 'tenant_1',
      });

      expect(redis.incr).toHaveBeenCalledTimes(1);
      const key = redis.incr.mock.calls[0][0];
      expect(key).toContain('tenant_1');
      expect(key).toContain(JobType.MEETING_PROCESS);
    });

    it('sets TTL on first increment only', async () => {
      await queueService.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1',
        tenantId: 'tenant_1',
      });

      // First call should set expire
      expect(redis.expire).toHaveBeenCalledTimes(1);
      expect(redis.expire.mock.calls[0][1]).toBe(60); // windowSeconds

      // Second call should NOT set expire again (counter is 2, not 1)
      await queueService.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm2',
        tenantId: 'tenant_1',
      });

      // expire should still only have been called once
      expect(redis.expire).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 429 on exceeding limit
  // ---------------------------------------------------------------------------
  describe('exceeding rate limit throws 429', () => {
    it('allows jobs up to maxJobsPerWindow', async () => {
      // limit is 3 — jobs 1, 2, 3 should succeed
      for (let i = 1; i <= 3; i++) {
        await expect(
          queueService.addJob(JobType.MEETING_PROCESS, {
            meetingId: `m${i}`,
            tenantId: 'tenant_1',
          }),
        ).resolves.toBeDefined();
      }
    });

    it('rejects the 4th job with a 429 error', async () => {
      // Exhaust the limit
      for (let i = 1; i <= 3; i++) {
        await queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: `m${i}`,
          tenantId: 'tenant_1',
        });
      }

      // 4th job should throw
      await expect(
        queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm4',
          tenantId: 'tenant_1',
        }),
      ).rejects.toThrow(/rate limit exceeded/i);

      // Verify it's a 429
      try {
        await queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm5',
          tenantId: 'tenant_1',
        });
      } catch (err: any) {
        expect(err.statusCode).toBe(429);
      }
    });

    it('error message includes tenant and limit details', async () => {
      for (let i = 1; i <= 3; i++) {
        await queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: `m${i}`,
          tenantId: 'tenant_msg_test',
        });
      }

      try {
        await queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm4',
          tenantId: 'tenant_msg_test',
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('tenant_msg_test');
        expect(err.message).toContain('3'); // maxJobsPerWindow
      }
    });
  });

  // ---------------------------------------------------------------------------
  // skipRateLimit bypass
  // ---------------------------------------------------------------------------
  describe('skipRateLimit bypasses rate check', () => {
    it('allows job with skipRateLimit even after limit exceeded', async () => {
      // Exhaust limit
      for (let i = 1; i <= 3; i++) {
        await queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: `m${i}`,
          tenantId: 'tenant_skip',
        });
      }

      // Regular job should fail
      await expect(
        queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm_fail',
          tenantId: 'tenant_skip',
        }),
      ).rejects.toThrow();

      // skipRateLimit should succeed
      await expect(
        queueService.addJob(
          JobType.MEETING_PROCESS,
          { meetingId: 'm_system', tenantId: 'tenant_skip' },
          { skipRateLimit: true },
        ),
      ).resolves.toBeDefined();
    });

    it('does not increment Redis counter when skipRateLimit is true', async () => {
      const incrCountBefore = redis.incr.mock.calls.length;

      await queueService.addJob(
        JobType.NOTIFICATION,
        { type: 'gchat', tenantId: 'tenant_sys', payload: {} },
        { skipRateLimit: true },
      );

      // No new INCR call should have been made
      expect(redis.incr.mock.calls.length).toBe(incrCountBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limit resets after window
  // ---------------------------------------------------------------------------
  describe('rate limit resets after window expires', () => {
    it('allows new jobs after Redis counter resets (simulated by clearing counter)', async () => {
      // Exhaust limit
      for (let i = 1; i <= 3; i++) {
        await queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: `m${i}`,
          tenantId: 'tenant_reset',
        });
      }

      // 4th should fail
      await expect(
        queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm4',
          tenantId: 'tenant_reset',
        }),
      ).rejects.toThrow();

      // Simulate window expiry: reset the counter (Redis TTL would do this)
      redis._reset();

      // Now jobs should succeed again
      await expect(
        queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm5',
          tenantId: 'tenant_reset',
        }),
      ).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation in rate limits
  // ---------------------------------------------------------------------------
  describe('different tenants have independent limits', () => {
    it('tenant_A exhausting limit does not affect tenant_B', async () => {
      // Exhaust tenant_A
      for (let i = 1; i <= 3; i++) {
        await queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: `m${i}`,
          tenantId: 'tenant_A',
        });
      }

      // tenant_A should be blocked
      await expect(
        queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm4',
          tenantId: 'tenant_A',
        }),
      ).rejects.toThrow();

      // tenant_B should still be able to queue jobs
      await expect(
        queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: 'm1',
          tenantId: 'tenant_B',
        }),
      ).resolves.toBeDefined();
    });

    it('uses separate Redis keys per tenant', async () => {
      await queueService.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1',
        tenantId: 'tenant_X',
      });
      await queueService.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1',
        tenantId: 'tenant_Y',
      });

      // Should have been called with two different keys
      const keys = redis.incr.mock.calls.map((c: any[]) => c[0]);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(2);
    });

    it('uses separate Redis keys per job type within same tenant', async () => {
      await queueService.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1',
        tenantId: 'tenant_Z',
      });
      await queueService.addJob(JobType.NOTIFICATION, {
        type: 'gchat',
        tenantId: 'tenant_Z',
        payload: {},
      });

      const keys = redis.incr.mock.calls.map((c: any[]) => c[0]);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limiting disabled
  // ---------------------------------------------------------------------------
  describe('rate limiting disabled', () => {
    it('does not call Redis INCR when rateLimit is false', async () => {
      const disabledService = new QueueService({
        redis,
        rateLimit: false,
      });

      await disabledService.addJob(JobType.MEETING_PROCESS, {
        meetingId: 'm1',
        tenantId: 'tenant_no_limit',
      });

      expect(redis.incr).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Jobs without tenantId skip rate limiting
  // ---------------------------------------------------------------------------
  describe('jobs without tenantId skip rate limiting', () => {
    it('does not enforce rate limit for ClarificationTimeout (no tenantId)', async () => {
      // ClarificationTimeoutJobData has no tenantId field
      for (let i = 0; i < 10; i++) {
        await expect(
          queueService.addJob(JobType.CLARIFICATION_TIMEOUT, {
            checkType: 'scheduled',
          }),
        ).resolves.toBeDefined();
      }

      // INCR should not have been called since there's no tenantId
      expect(redis.incr).not.toHaveBeenCalled();
    });
  });
});
