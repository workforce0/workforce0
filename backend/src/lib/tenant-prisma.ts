/**
 * =============================================================================
 * TENANT-SCOPED PRISMA CLIENT
 * =============================================================================
 *
 * Creates a Prisma client that auto-injects tenantId on all queries for
 * tenant-scoped models. This eliminates the error-prone pattern of manually
 * including tenantId in every WHERE clause.
 *
 * Unlike prisma-rls.middleware.ts (which uses AsyncLocalStorage), this module
 * creates an extended client bound to a specific tenantId at construction time.
 * This is useful for per-request scoped clients or background jobs where the
 * tenant is known upfront.
 *
 * Usage:
 * ------
 * ```typescript
 * const scopedPrisma = createTenantScopedPrisma(prisma, 'tenant_abc123');
 *
 * // tenantId is auto-injected into WHERE clause
 * const meetings = await scopedPrisma.meeting.findMany({});
 *
 * // tenantId is auto-injected into create data
 * const task = await scopedPrisma.agentTask.create({ data: { ... } });
 *
 * // Non-tenant models work normally (no injection)
 * const tenant = await scopedPrisma.tenant.findUnique({ where: { id: '...' } });
 * ```
 *
 * @module lib/tenant-prisma
 */

import { PrismaClient } from '../../prisma/generated/client/index.js';

/**
 * Models that have a direct tenantId field and need automatic tenant scoping.
 *
 * These model names use Prisma's camelCase convention (matching the accessor
 * names on the PrismaClient, e.g. prisma.modelProvider, prisma.pRD).
 *
 * Models NOT in this list:
 * - Tenant, User, Invitation, PRDTemplate: system-level or no tenantId
 * - Transcript: scoped via Meeting relation (no direct tenantId field)
 * - ClarificationRequest: scoped via AgentTask relation
 * - JiraTicket: scoped via PRD relation
 */
export const TENANT_SCOPED_MODELS = [
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
] as const;

/**
 * Set for O(1) lookups.
 */
const TENANT_SCOPED_MODELS_SET = new Set<string>(TENANT_SCOPED_MODELS);

/**
 * Operations that filter by adding tenantId to the WHERE clause.
 */
const WHERE_OPERATIONS = new Set([
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
]);

/**
 * Create a tenant-scoped Prisma client using $extends.
 *
 * The returned client automatically injects `tenantId` into:
 * - WHERE clauses for read, update, and delete operations
 * - Data payloads for create and createMany operations
 * - Both WHERE and create for upsert operations
 *
 * Non-tenant-scoped models pass through unmodified.
 *
 * @param prisma - Base PrismaClient instance
 * @param tenantId - The tenant ID to scope all queries to
 * @returns Extended PrismaClient with automatic tenant scoping
 *
 * @example
 * ```typescript
 * const scopedPrisma = createTenantScopedPrisma(basePrisma, 'tenant_123');
 *
 * // Automatically adds WHERE tenantId = 'tenant_123'
 * const configs = await scopedPrisma.agentConfig.findMany({});
 *
 * // Automatically sets tenantId in create data
 * const member = await scopedPrisma.teamMember.create({
 *   data: { name: 'Alice', email: 'alice@co.com', role: 'pm' }
 * });
 * ```
 */
export function createTenantScopedPrisma(
  prisma: PrismaClient,
  tenantId: string,
): PrismaClient {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('createTenantScopedPrisma requires a non-empty tenantId string');
  }

  const extended = prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        // Skip models that don't have tenantId
        if (!model || !TENANT_SCOPED_MODELS_SET.has(model)) {
          return query(args);
        }

        // Read, update, delete operations: inject tenantId into WHERE
        if (WHERE_OPERATIONS.has(operation)) {
          args.where = { ...args.where, tenantId };
        }

        // Create: inject tenantId into data
        if (operation === 'create') {
          args.data = { ...args.data, tenantId };
        }

        // CreateMany: inject tenantId into each record
        if (operation === 'createMany') {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: Record<string, unknown>) => ({ ...d, tenantId }));
          } else {
            args.data = { ...args.data, tenantId };
          }
        }

        // Upsert: inject into both WHERE and create
        if (operation === 'upsert') {
          args.where = { ...args.where, tenantId };
          args.create = { ...args.create, tenantId };
        }

        return query(args);
      },
    },
  });

  // The extended client is API-compatible with PrismaClient for our usage
  return extended as unknown as PrismaClient;
}
