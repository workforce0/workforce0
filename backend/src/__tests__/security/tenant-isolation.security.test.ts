/**
 * =============================================================================
 * SECURITY TESTS: Tenant Isolation (tenant-prisma.ts)
 * =============================================================================
 *
 * Validates that createTenantScopedPrisma:
 * - Rejects missing/invalid tenantId
 * - Auto-injects tenantId for all CRUD operations on scoped models
 * - Leaves non-scoped models untouched
 * - Covers all TENANT_SCOPED_MODELS (no model accidentally excluded)
 *
 * @module __tests__/security/tenant-isolation.security.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTenantScopedPrisma,
  TENANT_SCOPED_MODELS,
} from '../../lib/tenant-prisma.js';

// =============================================================================
// Helpers: mock PrismaClient that captures $extends calls
// =============================================================================

/**
 * Builds a minimal mock PrismaClient whose `$extends` records the
 * query interceptor so we can invoke it directly in tests.
 */
function createMockPrisma() {
  let capturedInterceptor: any = null;

  const mock = {
    $extends: vi.fn((extensionConfig: any) => {
      capturedInterceptor = extensionConfig.query.$allOperations;
      // Return a proxy that acts like the extended client
      return new Proxy(mock, {
        get(target, prop) {
          if (prop === '_interceptor') return capturedInterceptor;
          return (target as any)[prop];
        },
      });
    }),
  };

  return {
    prisma: mock as any,
    /** Retrieve the interceptor function after calling createTenantScopedPrisma */
    getInterceptor: () => capturedInterceptor,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Tenant Isolation — createTenantScopedPrisma', () => {
  const TENANT_ID = 'tenant_sec_test_123';

  // ---------------------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------------------
  describe('input validation', () => {
    it('throws on empty string tenantId', () => {
      const { prisma } = createMockPrisma();
      expect(() => createTenantScopedPrisma(prisma, '')).toThrow(
        'createTenantScopedPrisma requires a non-empty tenantId string',
      );
    });

    it('throws on null tenantId', () => {
      const { prisma } = createMockPrisma();
      expect(() => createTenantScopedPrisma(prisma, null as unknown as string)).toThrow();
    });

    it('throws on undefined tenantId', () => {
      const { prisma } = createMockPrisma();
      expect(() => createTenantScopedPrisma(prisma, undefined as unknown as string)).toThrow();
    });

    it('throws on numeric tenantId (type guard)', () => {
      const { prisma } = createMockPrisma();
      expect(() => createTenantScopedPrisma(prisma, 42 as unknown as string)).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // TENANT_SCOPED_MODELS coverage
  // ---------------------------------------------------------------------------
  describe('TENANT_SCOPED_MODELS completeness', () => {
    const expectedModels = [
      'modelProvider',
      'modelConfig',
      'agentConfig',
      'engagement',
      'teamMember',
      'messageLog',
      'tenantMemory',
      'meeting',
      'pRD',
      'agentTask',
      'meetingInsights',
      'notification',
    ];

    expectedModels.forEach((model) => {
      it(`includes "${model}" in TENANT_SCOPED_MODELS`, () => {
        expect(TENANT_SCOPED_MODELS).toContain(model);
      });
    });

    it('has exactly the expected number of scoped models', () => {
      expect(TENANT_SCOPED_MODELS.length).toBe(expectedModels.length);
    });
  });

  // ---------------------------------------------------------------------------
  // WHERE injection for read operations
  // ---------------------------------------------------------------------------
  describe('WHERE clause injection (read/update/delete operations)', () => {
    const whereOperations = [
      'findMany',
      'findFirst',
      'findFirstOrThrow',
      'findUnique',
      'findUniqueOrThrow',
      'count',
      'aggregate',
      'groupBy',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
    ];

    let interceptor: any;

    beforeEach(() => {
      const { prisma, getInterceptor } = createMockPrisma();
      createTenantScopedPrisma(prisma, TENANT_ID);
      interceptor = getInterceptor();
    });

    whereOperations.forEach((operation) => {
      it(`injects tenantId into WHERE for "${operation}" on scoped model`, async () => {
        const args: any = { where: { id: 'some-id' } };
        const querySpy = vi.fn().mockResolvedValue([]);

        await interceptor({
          model: 'meeting',
          operation,
          args,
          query: querySpy,
        });

        expect(querySpy).toHaveBeenCalledTimes(1);
        const calledArgs = querySpy.mock.calls[0][0];
        expect(calledArgs.where.tenantId).toBe(TENANT_ID);
        // Original filter preserved
        expect(calledArgs.where.id).toBe('some-id');
      });
    });

    it('injects tenantId even when no WHERE clause exists', async () => {
      const args: any = {};
      const querySpy = vi.fn().mockResolvedValue([]);

      await interceptor({
        model: 'notification',
        operation: 'findMany',
        args,
        query: querySpy,
      });

      const calledArgs = querySpy.mock.calls[0][0];
      expect(calledArgs.where.tenantId).toBe(TENANT_ID);
    });

    it('does NOT allow caller to override injected tenantId', async () => {
      // Attacker passes a different tenantId in where clause
      const args: any = { where: { tenantId: 'attacker_tenant', id: 'target-id' } };
      const querySpy = vi.fn().mockResolvedValue([]);

      await interceptor({
        model: 'agentTask',
        operation: 'findFirst',
        args,
        query: querySpy,
      });

      const calledArgs = querySpy.mock.calls[0][0];
      // The interceptor spreads { ...args.where, tenantId } — tenantId wins because
      // it comes last, overwriting the attacker's value.
      expect(calledArgs.where.tenantId).toBe(TENANT_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // CREATE injection
  // ---------------------------------------------------------------------------
  describe('create operation injection', () => {
    let interceptor: any;

    beforeEach(() => {
      const { prisma, getInterceptor } = createMockPrisma();
      createTenantScopedPrisma(prisma, TENANT_ID);
      interceptor = getInterceptor();
    });

    it('injects tenantId into create data for scoped model', async () => {
      const args: any = { data: { name: 'Daily Standup' } };
      const querySpy = vi.fn().mockResolvedValue({});

      await interceptor({
        model: 'meeting',
        operation: 'create',
        args,
        query: querySpy,
      });

      const calledArgs = querySpy.mock.calls[0][0];
      expect(calledArgs.data.tenantId).toBe(TENANT_ID);
      expect(calledArgs.data.name).toBe('Daily Standup');
    });

    it('overrides attacker-supplied tenantId in create data', async () => {
      const args: any = { data: { tenantId: 'attacker_tenant', name: 'Hacked' } };
      const querySpy = vi.fn().mockResolvedValue({});

      await interceptor({
        model: 'notification',
        operation: 'create',
        args,
        query: querySpy,
      });

      const calledArgs = querySpy.mock.calls[0][0];
      expect(calledArgs.data.tenantId).toBe(TENANT_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // CREATE MANY injection
  // ---------------------------------------------------------------------------
  describe('createMany operation injection', () => {
    let interceptor: any;

    beforeEach(() => {
      const { prisma, getInterceptor } = createMockPrisma();
      createTenantScopedPrisma(prisma, TENANT_ID);
      interceptor = getInterceptor();
    });

    it('injects tenantId into each record when data is an array', async () => {
      const args: any = {
        data: [
          { name: 'Meeting A' },
          { name: 'Meeting B' },
        ],
      };
      const querySpy = vi.fn().mockResolvedValue({ count: 2 });

      await interceptor({
        model: 'meeting',
        operation: 'createMany',
        args,
        query: querySpy,
      });

      const calledArgs = querySpy.mock.calls[0][0];
      expect(calledArgs.data).toHaveLength(2);
      calledArgs.data.forEach((record: any) => {
        expect(record.tenantId).toBe(TENANT_ID);
      });
    });

    it('injects tenantId when createMany data is a single object', async () => {
      const args: any = { data: { name: 'Single Meeting' } };
      const querySpy = vi.fn().mockResolvedValue({ count: 1 });

      await interceptor({
        model: 'meeting',
        operation: 'createMany',
        args,
        query: querySpy,
      });

      const calledArgs = querySpy.mock.calls[0][0];
      expect(calledArgs.data.tenantId).toBe(TENANT_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // UPSERT injection
  // ---------------------------------------------------------------------------
  describe('upsert operation injection', () => {
    let interceptor: any;

    beforeEach(() => {
      const { prisma, getInterceptor } = createMockPrisma();
      createTenantScopedPrisma(prisma, TENANT_ID);
      interceptor = getInterceptor();
    });

    it('injects tenantId into both WHERE and create for upsert', async () => {
      const args: any = {
        where: { id: 'cfg-1' },
        create: { name: 'new config' },
        update: { name: 'updated config' },
      };
      const querySpy = vi.fn().mockResolvedValue({});

      await interceptor({
        model: 'agentConfig',
        operation: 'upsert',
        args,
        query: querySpy,
      });

      const calledArgs = querySpy.mock.calls[0][0];
      expect(calledArgs.where.tenantId).toBe(TENANT_ID);
      expect(calledArgs.create.tenantId).toBe(TENANT_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // Non-scoped models pass through unchanged
  // ---------------------------------------------------------------------------
  describe('non-scoped models are unmodified', () => {
    const nonScopedModels = ['Tenant', 'User', 'Invitation', 'PRDTemplate'];

    let interceptor: any;

    beforeEach(() => {
      const { prisma, getInterceptor } = createMockPrisma();
      createTenantScopedPrisma(prisma, TENANT_ID);
      interceptor = getInterceptor();
    });

    nonScopedModels.forEach((model) => {
      it(`does NOT inject tenantId for "${model}" model`, async () => {
        const args: any = { where: { id: 'some-id' } };
        const querySpy = vi.fn().mockResolvedValue(null);

        await interceptor({
          model,
          operation: 'findUnique',
          args,
          query: querySpy,
        });

        const calledArgs = querySpy.mock.calls[0][0];
        expect(calledArgs.where.tenantId).toBeUndefined();
      });
    });

    it('passes through when model is null/undefined (raw queries)', async () => {
      const args: any = {};
      const querySpy = vi.fn().mockResolvedValue([]);

      await interceptor({
        model: null,
        operation: '$queryRaw',
        args,
        query: querySpy,
      });

      expect(querySpy).toHaveBeenCalledWith(args);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-tenant data leak prevention
  // ---------------------------------------------------------------------------
  describe('cross-tenant data leak prevention', () => {
    it('two scoped clients for different tenants produce different WHERE clauses', async () => {
      const { prisma: prisma1, getInterceptor: getInt1 } = createMockPrisma();
      createTenantScopedPrisma(prisma1, 'tenant_A');
      const interceptorA = getInt1();

      const { prisma: prisma2, getInterceptor: getInt2 } = createMockPrisma();
      createTenantScopedPrisma(prisma2, 'tenant_B');
      const interceptorB = getInt2();

      const spy1 = vi.fn().mockResolvedValue([]);
      const spy2 = vi.fn().mockResolvedValue([]);

      await interceptorA({
        model: 'meeting',
        operation: 'findMany',
        args: { where: {} },
        query: spy1,
      });

      await interceptorB({
        model: 'meeting',
        operation: 'findMany',
        args: { where: {} },
        query: spy2,
      });

      expect(spy1.mock.calls[0][0].where.tenantId).toBe('tenant_A');
      expect(spy2.mock.calls[0][0].where.tenantId).toBe('tenant_B');
    });
  });

  // ---------------------------------------------------------------------------
  // All scoped models get injection for every operation type
  // ---------------------------------------------------------------------------
  describe('exhaustive: every scoped model + every operation', () => {
    let interceptor: any;

    beforeEach(() => {
      const { prisma, getInterceptor } = createMockPrisma();
      createTenantScopedPrisma(prisma, TENANT_ID);
      interceptor = getInterceptor();
    });

    TENANT_SCOPED_MODELS.forEach((model) => {
      it(`injects tenantId for findMany on "${model}"`, async () => {
        const args: any = { where: {} };
        const spy = vi.fn().mockResolvedValue([]);
        await interceptor({ model, operation: 'findMany', args, query: spy });
        expect(spy.mock.calls[0][0].where.tenantId).toBe(TENANT_ID);
      });

      it(`injects tenantId for create on "${model}"`, async () => {
        const args: any = { data: {} };
        const spy = vi.fn().mockResolvedValue({});
        await interceptor({ model, operation: 'create', args, query: spy });
        expect(spy.mock.calls[0][0].data.tenantId).toBe(TENANT_ID);
      });

      it(`injects tenantId for delete on "${model}"`, async () => {
        const args: any = { where: { id: 'x' } };
        const spy = vi.fn().mockResolvedValue({});
        await interceptor({ model, operation: 'delete', args, query: spy });
        expect(spy.mock.calls[0][0].where.tenantId).toBe(TENANT_ID);
      });
    });
  });
});
