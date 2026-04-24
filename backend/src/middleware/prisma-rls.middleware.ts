/**
 * =============================================================================
 * PRISMA ROW-LEVEL SECURITY MIDDLEWARE
 * =============================================================================
 *
 * Automatically enforces tenant isolation at the database query level
 * using Prisma client extensions ($extends).
 *
 * What is RLS (Row-Level Security)?
 * ---------------------------------
 * RLS ensures that tenants can only access their own data. Even if application
 * code forgets to add a tenantId filter, this middleware adds it automatically.
 *
 * How It Works (Prisma 7 Client Extensions):
 * ------------------------------------------
 * 1. Creates an extended Prisma client using $extends
 * 2. Intercepts queries via the `query` extension
 * 3. Gets current tenantId from AsyncLocalStorage context
 * 4. Injects `WHERE tenantId = ?` on reads
 * 5. Injects `tenantId` field on creates
 * 6. Ensures updates/deletes only affect current tenant's data
 *
 * Models with RLS (every model with a tenantId column):
 * ------------------------------------------------------
 *   Core:       Meeting, AgentTask, PRD, Notification, Project, Ticket,
 *               Goal, Engagement, Tenant
 *   Identity:   User, Invitation, TeamMember
 *   Integrations: IntegrationConnection, GoogleOAuthToken, ModelProvider,
 *               ModelConfig, AgentConfig, AgentWebhook
 *   Obs/logs:   AuditLog, MessageLog, TenantMemory, TenantUsage,
 *               MeetingInsights, WebhookEndpoint
 *   Async:      AgentToken, AgentJob, ScheduledJob, ConversationThread
 *   Skills:     Skill (foundation skills are not tenant-scoped and live
 *               elsewhere)
 *
 * Models without RLS (tenant-scoped via relations, filtered via the parent):
 * --------------------------------------------------------------------------
 *   Transcript (via Meeting), JiraTicket (via PRD),
 *   ClarificationRequest (via AgentTask), TicketEvent (via Ticket),
 *   ConversationTurn (via ConversationThread).
 *
 * Nullable-tenantId globals (AgentRole, PRDTemplate, LearnedSkill,
 * AgentRoleVersion, SkillPackage, SubagentDefinition) are deliberately
 * NOT in the RLS set — a null tenantId is a shared/built-in row that all
 * tenants should see, and service-layer callers already pass an
 * `OR: [{ tenantId }, { tenantId: null }]` filter.
 *
 * @module middleware/prisma-rls
 */

import { PrismaClient } from '../../prisma/generated/client/index.js';
import { getTenantId, hasTenantContext } from '../lib/tenant-context.js';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ module: 'prisma-rls' });

/**
 * Models that have direct tenantId field and need RLS filtering.
 */
const TENANT_SCOPED_MODELS = new Set([
  // Core product entities
  'Meeting',
  'AgentTask',
  'PRD',
  'Notification',
  'Project',     // P1 — project-level isolation container
  'Ticket',      // M4 — role-keyed pull queue, tenant-critical
  'Goal',        // M2 — goal lineage
  'Engagement',  // engagement lifecycle
  'Tenant',      // Tenant table itself — only allow access to own tenant
  // Identity + auth (all carry tenantId)
  'User',
  'Invitation',
  'TeamMember',
  // Integrations + config (tenant-scoped credentials and config)
  'IntegrationConnection',
  'GoogleOAuthToken',
  'ModelProvider',
  'ModelConfig',
  'AgentConfig',
  'AgentWebhook',
  // Observability / usage / logs
  'AuditLog',
  'MessageLog',
  'TenantMemory',
  'TenantUsage',
  'MeetingInsights',
  'WebhookEndpoint',
  // Async execution bookkeeping
  'AgentToken',
  'AgentJob',
  'ScheduledJob',
  'ConversationThread',
  // Skills (tenant learned/custom; foundation is global)
  'Skill',
]);

/**
 * Lowercase model names for matching Prisma extension keys.
 */
const TENANT_SCOPED_MODELS_LOWER = new Set(
  [...TENANT_SCOPED_MODELS].map(m => m.charAt(0).toLowerCase() + m.slice(1))
);

/**
 * Configuration for RLS middleware.
 */
export interface RLSMiddlewareConfig {
  /**
   * If true, queries without tenant context will be blocked.
   * If false, queries without context run without RLS (for webhooks, system tasks).
   */
  requireTenantContext: boolean;

  /**
   * Enable debug logging for all intercepted queries.
   */
  debug: boolean;
}

/**
 * Default RLS configuration.
 */
const defaultConfig: RLSMiddlewareConfig = {
  requireTenantContext: false,
  debug: false,
};

/**
 * Add tenantId filter to a where clause.
 */
function addTenantFilter(
  where: Record<string, unknown> | undefined,
  tenantId: string
): Record<string, unknown> {
  return {
    ...where,
    tenantId,
  };
}

/**
 * Add tenantId to create data, validating no mismatch.
 */
function addTenantToData(
  data: Record<string, unknown>,
  tenantId: string
): Record<string, unknown> {
  if (data.tenantId && data.tenantId !== tenantId) {
    throw new Error(
      `TenantId mismatch: provided ${data.tenantId}, context has ${tenantId}`
    );
  }
  return { ...data, tenantId };
}

/**
 * Create a helper that wraps a query operation with RLS tenant filtering.
 * This returns a function that can be used in the Prisma $extends query object.
 */
function createRLSQueryHandler(config: RLSMiddlewareConfig) {
  return function handleQuery(
    modelName: string,
    operation: string,
    args: any,
    query: (args: any) => Promise<any>
  ): Promise<any> {
    // Skip non-tenant-scoped models
    if (!TENANT_SCOPED_MODELS.has(modelName) && !TENANT_SCOPED_MODELS_LOWER.has(modelName)) {
      return query(args);
    }

    // Get tenant context
    const tenantId = getTenantId();

    if (!tenantId) {
      if (config.requireTenantContext) {
        logger.error(`Query attempted without tenant context: ${modelName}.${operation}`);
        throw new Error(
          `Tenant context required for ${modelName}.${operation}. ` +
          'Ensure request is wrapped in runWithTenant().'
        );
      }
      // No tenant context and not required - pass through (webhooks, system tasks)
      if (config.debug) {
        logger.debug(`RLS skipped (no tenant context): ${modelName}.${operation}`);
      }
      return query(args);
    }

    if (config.debug) {
      logger.debug(`RLS filtering: ${modelName}.${operation} for tenant ${tenantId}`);
    }

    // Apply tenant filtering based on operation type
    switch (operation) {
      // Read operations - add tenantId to WHERE
      case 'findUnique':
      case 'findUniqueOrThrow':
      case 'findFirst':
      case 'findFirstOrThrow':
      case 'findMany':
      case 'count':
      case 'aggregate':
      case 'groupBy':
        args = { ...args, where: addTenantFilter(args?.where, tenantId) };
        break;

      // Create - add tenantId to data
      case 'create':
        args = { ...args, data: addTenantToData(args?.data || {}, tenantId) };
        break;

      // CreateMany - add tenantId to each record
      case 'createMany':
        if (Array.isArray(args?.data)) {
          args = {
            ...args,
            data: args.data.map((record: Record<string, unknown>) =>
              addTenantToData(record, tenantId)
            ),
          };
        }
        break;

      // Update/Delete - add tenantId to WHERE
      case 'update':
      case 'delete':
      case 'updateMany':
      case 'deleteMany':
        args = { ...args, where: addTenantFilter(args?.where, tenantId) };
        break;

      // Upsert - add tenantId to WHERE and create
      case 'upsert':
        args = {
          ...args,
          where: addTenantFilter(args?.where, tenantId),
          create: addTenantToData(args?.create || {}, tenantId),
        };
        break;
    }

    return query(args);
  };
}

/**
 * Create a tenant-aware Prisma client using $extends.
 *
 * This replaces the old $use() middleware with Prisma 7's client extensions.
 * The extended client automatically adds tenantId filtering to all queries
 * on tenant-scoped models when a tenant context is active.
 *
 * @param baseClient - Base Prisma client
 * @param config - RLS configuration
 * @returns Extended Prisma client with RLS enabled
 *
 * @example
 * ```typescript
 * const basePrisma = new PrismaClient();
 * const prisma = createTenantAwarePrisma(basePrisma, { debug: true });
 *
 * // Inside a request with tenant context:
 * await runWithTenant({ tenantId: 'tenant_123' }, async () => {
 *   // Automatically filters by tenantId = 'tenant_123'
 *   const meetings = await prisma.meeting.findMany({});
 * });
 * ```
 */
export function createTenantAwarePrisma(
  baseClient: PrismaClient,
  userConfig: Partial<RLSMiddlewareConfig> = {}
): PrismaClient {
  const options: RLSMiddlewareConfig = { ...defaultConfig, ...userConfig };
  const handler = createRLSQueryHandler(options);

  const extended = baseClient.$extends({
    query: {
      meeting: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'Meeting', operation, args, query);
        },
      },
      agentTask: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'AgentTask', operation, args, query);
        },
      },
      pRD: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'PRD', operation, args, query);
        },
      },
      notification: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'Notification', operation, args, query);
        },
      },
      project: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'Project', operation, args, query);
        },
      },
      ticket: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'Ticket', operation, args, query);
        },
      },
      goal: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'Goal', operation, args, query);
        },
      },
      engagement: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'Engagement', operation, args, query);
        },
      },
      tenant: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'Tenant', operation, args, query);
        },
      },
      // Identity + auth
      user: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'User', operation, args, query);
        },
      },
      invitation: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'Invitation', operation, args, query);
        },
      },
      teamMember: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'TeamMember', operation, args, query);
        },
      },
      // Integrations + config
      integrationConnection: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'IntegrationConnection', operation, args, query);
        },
      },
      googleOAuthToken: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'GoogleOAuthToken', operation, args, query);
        },
      },
      modelProvider: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'ModelProvider', operation, args, query);
        },
      },
      modelConfig: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'ModelConfig', operation, args, query);
        },
      },
      agentConfig: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'AgentConfig', operation, args, query);
        },
      },
      agentWebhook: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'AgentWebhook', operation, args, query);
        },
      },
      // Observability / usage / logs
      auditLog: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'AuditLog', operation, args, query);
        },
      },
      messageLog: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'MessageLog', operation, args, query);
        },
      },
      tenantMemory: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'TenantMemory', operation, args, query);
        },
      },
      tenantUsage: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'TenantUsage', operation, args, query);
        },
      },
      meetingInsights: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'MeetingInsights', operation, args, query);
        },
      },
      webhookEndpoint: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'WebhookEndpoint', operation, args, query);
        },
      },
      // Async execution bookkeeping
      agentToken: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'AgentToken', operation, args, query);
        },
      },
      agentJob: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'AgentJob', operation, args, query);
        },
      },
      scheduledJob: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'ScheduledJob', operation, args, query);
        },
      },
      conversationThread: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'ConversationThread', operation, args, query);
        },
      },
      skill: {
        $allOperations({ model, operation, args, query }) {
          return handler(model ?? 'Skill', operation, args, query);
        },
      },
    },
  });

  logger.info('RLS middleware applied via Prisma client extensions ($extends)');

  // The extended client is compatible with PrismaClient for our usage
  return extended as unknown as PrismaClient;
}

/**
 * Apply RLS middleware to a Prisma client instance.
 *
 * @deprecated Use createTenantAwarePrisma() instead - it returns the extended client.
 * This function is kept for backward compatibility but logs a deprecation warning.
 */
export function applyRLSMiddleware(
  _prisma: PrismaClient,
  _config: Partial<RLSMiddlewareConfig> = {}
): void {
  logger.warn(
    'applyRLSMiddleware() is deprecated. Use createTenantAwarePrisma() instead. ' +
    'RLS is NOT active when using this function.'
  );
}
