import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTenantScopedPrisma, TENANT_SCOPED_MODELS } from '../tenant-prisma.js';

/**
 * Creates a mock PrismaClient with a mock $extends method.
 *
 * The mock captures the extension config so we can invoke the
 * $allOperations handler directly in tests without needing a
 * real database connection.
 */
function createMockPrisma() {
  let extensionConfig: any = null;

  const mockPrisma: any = {
    $extends: vi.fn((config: any) => {
      extensionConfig = config;
      return mockPrisma; // return self for chaining
    }),
  };

  /**
   * Simulate invoking the $allOperations handler that was passed to $extends.
   */
  function invokeHandler(params: {
    model: string | undefined;
    operation: string;
    args: any;
  }) {
    const handler = extensionConfig?.query?.$allOperations;
    if (!handler) {
      throw new Error('$allOperations handler not registered');
    }

    // The `query` callback just returns the args it received,
    // so we can inspect what was passed after tenant injection.
    const queryFn = vi.fn((args: any) => Promise.resolve(args));

    return handler({
      model: params.model,
      operation: params.operation,
      args: { ...params.args },
      query: queryFn,
    }).then((result: any) => ({ result, queryFn }));
  }

  return { mockPrisma, invokeHandler, getExtensionConfig: () => extensionConfig };
}

describe('createTenantScopedPrisma', () => {
  const TENANT_ID = 'tenant_test_123';
  let mockPrisma: any;
  let invokeHandler: ReturnType<typeof createMockPrisma>['invokeHandler'];

  beforeEach(() => {
    const mock = createMockPrisma();
    mockPrisma = mock.mockPrisma;
    invokeHandler = mock.invokeHandler;

    // Create the scoped client, which calls $extends internally
    createTenantScopedPrisma(mockPrisma, TENANT_ID);
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  it('should throw if tenantId is empty', () => {
    const { mockPrisma: mp } = createMockPrisma();
    expect(() => createTenantScopedPrisma(mp, '')).toThrow(
      'createTenantScopedPrisma requires a non-empty tenantId string',
    );
  });

  it('should throw if tenantId is not a string', () => {
    const { mockPrisma: mp } = createMockPrisma();
    expect(() => createTenantScopedPrisma(mp, null as any)).toThrow(
      'createTenantScopedPrisma requires a non-empty tenantId string',
    );
  });

  it('should call $extends on the prisma client', () => {
    expect(mockPrisma.$extends).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // findMany — auto-inject tenantId
  // ---------------------------------------------------------------------------

  it('should auto-inject tenantId into findMany WHERE clause', async () => {
    const { result } = await invokeHandler({
      model: 'meeting',
      operation: 'findMany',
      args: { where: { status: 'active' } },
    });

    expect(result).toEqual({
      where: { status: 'active', tenantId: TENANT_ID },
    });
  });

  it('should inject tenantId into findMany even with empty args', async () => {
    const { result } = await invokeHandler({
      model: 'agentTask',
      operation: 'findMany',
      args: {},
    });

    expect(result).toEqual({
      where: { tenantId: TENANT_ID },
    });
  });

  // ---------------------------------------------------------------------------
  // findFirst / findUnique
  // ---------------------------------------------------------------------------

  it('should auto-inject tenantId into findFirst WHERE clause', async () => {
    const { result } = await invokeHandler({
      model: 'teamMember',
      operation: 'findFirst',
      args: { where: { email: 'alice@co.com' } },
    });

    expect(result).toEqual({
      where: { email: 'alice@co.com', tenantId: TENANT_ID },
    });
  });

  it('should auto-inject tenantId into findUnique WHERE clause', async () => {
    const { result } = await invokeHandler({
      model: 'modelConfig',
      operation: 'findUnique',
      args: { where: { id: 'mc_1' } },
    });

    expect(result).toEqual({
      where: { id: 'mc_1', tenantId: TENANT_ID },
    });
  });

  // ---------------------------------------------------------------------------
  // count / aggregate / groupBy
  // ---------------------------------------------------------------------------

  it('should auto-inject tenantId into count WHERE clause', async () => {
    const { result } = await invokeHandler({
      model: 'engagement',
      operation: 'count',
      args: { where: { phase: 'listen' } },
    });

    expect(result).toEqual({
      where: { phase: 'listen', tenantId: TENANT_ID },
    });
  });

  it('should auto-inject tenantId into aggregate WHERE clause', async () => {
    const { result } = await invokeHandler({
      model: 'messageLog',
      operation: 'aggregate',
      args: { where: {} },
    });

    expect(result).toEqual({
      where: { tenantId: TENANT_ID },
    });
  });

  // ---------------------------------------------------------------------------
  // create — auto-inject tenantId
  // ---------------------------------------------------------------------------

  it('should auto-inject tenantId into create data', async () => {
    const { result } = await invokeHandler({
      model: 'tenantMemory',
      operation: 'create',
      args: {
        data: { key: 'pref_1', value: { x: 1 }, category: 'preference', source: 'manual' },
      },
    });

    expect(result).toEqual({
      data: {
        key: 'pref_1',
        value: { x: 1 },
        category: 'preference',
        source: 'manual',
        tenantId: TENANT_ID,
      },
    });
  });

  it('should overwrite tenantId in create data (prevent cross-tenant writes)', async () => {
    const { result } = await invokeHandler({
      model: 'meeting',
      operation: 'create',
      args: {
        data: { title: 'Standup', tenantId: 'other_tenant' },
      },
    });

    // The scoped client enforces its own tenantId
    expect(result.data.tenantId).toBe(TENANT_ID);
  });

  // ---------------------------------------------------------------------------
  // createMany
  // ---------------------------------------------------------------------------

  it('should auto-inject tenantId into createMany array data', async () => {
    const { result } = await invokeHandler({
      model: 'teamMember',
      operation: 'createMany',
      args: {
        data: [
          { name: 'Alice', email: 'alice@co.com', role: 'pm' },
          { name: 'Bob', email: 'bob@co.com', role: 'dev' },
        ],
      },
    });

    expect(result.data).toEqual([
      { name: 'Alice', email: 'alice@co.com', role: 'pm', tenantId: TENANT_ID },
      { name: 'Bob', email: 'bob@co.com', role: 'dev', tenantId: TENANT_ID },
    ]);
  });

  it('should auto-inject tenantId into createMany single-object data', async () => {
    const { result } = await invokeHandler({
      model: 'agentConfig',
      operation: 'createMany',
      args: {
        data: { agentType: 'ba_agent', preset: 'recommended' },
      },
    });

    expect(result.data).toEqual({
      agentType: 'ba_agent',
      preset: 'recommended',
      tenantId: TENANT_ID,
    });
  });

  // ---------------------------------------------------------------------------
  // update / updateMany / delete / deleteMany
  // ---------------------------------------------------------------------------

  it('should auto-inject tenantId into update WHERE clause', async () => {
    const { result } = await invokeHandler({
      model: 'pRD',
      operation: 'update',
      args: {
        where: { id: 'prd_1' },
        data: { status: 'approved' },
      },
    });

    expect(result.where).toEqual({ id: 'prd_1', tenantId: TENANT_ID });
    expect(result.data).toEqual({ status: 'approved' });
  });

  it('should auto-inject tenantId into updateMany WHERE clause', async () => {
    const { result } = await invokeHandler({
      model: 'meeting',
      operation: 'updateMany',
      args: {
        where: { status: 'scheduled' },
        data: { status: 'cancelled' },
      },
    });

    expect(result.where).toEqual({ status: 'scheduled', tenantId: TENANT_ID });
  });

  it('should auto-inject tenantId into delete WHERE clause', async () => {
    const { result } = await invokeHandler({
      model: 'agentTask',
      operation: 'delete',
      args: { where: { id: 'task_1' } },
    });

    expect(result.where).toEqual({ id: 'task_1', tenantId: TENANT_ID });
  });

  it('should auto-inject tenantId into deleteMany WHERE clause', async () => {
    const { result } = await invokeHandler({
      model: 'messageLog',
      operation: 'deleteMany',
      args: { where: { status: 'failed' } },
    });

    expect(result.where).toEqual({ status: 'failed', tenantId: TENANT_ID });
  });

  // ---------------------------------------------------------------------------
  // upsert
  // ---------------------------------------------------------------------------

  it('should auto-inject tenantId into upsert WHERE and create', async () => {
    const { result } = await invokeHandler({
      model: 'modelProvider',
      operation: 'upsert',
      args: {
        where: { id: 'mp_1' },
        create: { name: 'openai', baseUrl: null },
        update: { isActive: true },
      },
    });

    expect(result.where).toEqual({ id: 'mp_1', tenantId: TENANT_ID });
    expect(result.create).toEqual({ name: 'openai', baseUrl: null, tenantId: TENANT_ID });
    // update data should NOT have tenantId injected (tenantId is immutable)
    expect(result.update).toEqual({ isActive: true });
  });

  // ---------------------------------------------------------------------------
  // Non-tenant models should NOT be modified
  // ---------------------------------------------------------------------------

  it('should NOT modify queries for the Tenant model', async () => {
    const { result } = await invokeHandler({
      model: 'tenant',
      operation: 'findMany',
      args: { where: { name: 'Acme' } },
    });

    // Should pass through untouched
    expect(result).toEqual({ where: { name: 'Acme' } });
  });

  it('should NOT modify queries for ClarificationRequest model', async () => {
    const { result } = await invokeHandler({
      model: 'clarificationRequest',
      operation: 'findFirst',
      args: { where: { status: 'pending' } },
    });

    expect(result).toEqual({ where: { status: 'pending' } });
  });

  it('should NOT modify queries for JiraTicket model', async () => {
    const { result } = await invokeHandler({
      model: 'jiraTicket',
      operation: 'create',
      args: { data: { summary: 'Fix bug', prdId: 'prd_1' } },
    });

    expect(result).toEqual({ data: { summary: 'Fix bug', prdId: 'prd_1' } });
  });

  it('should auto-inject tenantId for Notification model (tenant-scoped)', async () => {
    const { result } = await invokeHandler({
      model: 'notification',
      operation: 'findMany',
      args: { where: { status: 'pending' } },
    });

    expect(result).toEqual({ where: { status: 'pending', tenantId: TENANT_ID } });
  });

  it('should pass through when model is undefined', async () => {
    const { result } = await invokeHandler({
      model: undefined,
      operation: 'findMany',
      args: { where: { foo: 'bar' } },
    });

    expect(result).toEqual({ where: { foo: 'bar' } });
  });

  // ---------------------------------------------------------------------------
  // Existing tenantId in where is preserved (not overwritten with undefined)
  // ---------------------------------------------------------------------------

  it('should preserve existing tenantId in where (idempotent)', async () => {
    const { result } = await invokeHandler({
      model: 'meeting',
      operation: 'findMany',
      args: { where: { tenantId: TENANT_ID, status: 'active' } },
    });

    expect(result).toEqual({
      where: { tenantId: TENANT_ID, status: 'active' },
    });
  });

  it('should override a different tenantId in where (enforce scoping)', async () => {
    const { result } = await invokeHandler({
      model: 'engagement',
      operation: 'findMany',
      args: { where: { tenantId: 'wrong_tenant', phase: 'build' } },
    });

    // The scoped client's tenantId wins
    expect(result.where.tenantId).toBe(TENANT_ID);
    expect(result.where.phase).toBe('build');
  });

  // ---------------------------------------------------------------------------
  // TENANT_SCOPED_MODELS export
  // ---------------------------------------------------------------------------

  it('should export the list of tenant-scoped models', () => {
    expect(TENANT_SCOPED_MODELS).toContain('meeting');
    expect(TENANT_SCOPED_MODELS).toContain('pRD');
    expect(TENANT_SCOPED_MODELS).toContain('modelProvider');
    expect(TENANT_SCOPED_MODELS).toContain('meetingInsights');
    expect(TENANT_SCOPED_MODELS).toContain('notification');
    expect(TENANT_SCOPED_MODELS).not.toContain('tenant');
    expect(TENANT_SCOPED_MODELS).not.toContain('clarificationRequest');
    // transcript is scoped via Meeting relation, NOT directly
    expect(TENANT_SCOPED_MODELS).not.toContain('transcript');
  });

  // ---------------------------------------------------------------------------
  // All listed models are covered
  // ---------------------------------------------------------------------------

  it.each([
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
  ])('should inject tenantId for tenant-scoped model: %s', async (modelName) => {
    const { result } = await invokeHandler({
      model: modelName,
      operation: 'findMany',
      args: { where: {} },
    });

    expect(result.where.tenantId).toBe(TENANT_ID);
  });
});
