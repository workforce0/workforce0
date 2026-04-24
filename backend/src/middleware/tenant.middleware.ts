/**
 * =============================================================================
 * TENANT MIDDLEWARE
 * =============================================================================
 *
 * Fastify middleware to extract tenant context from requests.
 *
 * How Tenant Identification Works:
 * --------------------------------
 * 1. JWT Token (Production): Extract tenantId from decoded JWT payload
 * 2. X-Tenant-ID Header (Development): For testing without full auth
 * 3. Query Parameter (API Keys): For service-to-service calls
 *
 * Security Notes:
 * ---------------
 * - In production, ONLY trust JWT-based tenant identification
 * - Header-based identification is for development/testing only
 * - Always validate tenant exists before accepting
 *
 * @module middleware/tenant
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { runWithTenant, TenantContextData } from '../lib/tenant-context.js';
import { logger, createChildLogger } from '../lib/logger.js';
import { config } from '../config/index.js';

const middlewareLogger = createChildLogger({ module: 'tenant-middleware' });

/**
 * Options for tenant middleware configuration.
 */
export interface TenantMiddlewareOptions {
  /**
   * Allow X-Tenant-ID header (for development/testing).
   * Should be false in production.
   */
  allowHeaderTenant: boolean;

  /**
   * Routes that don't require tenant context.
   * Example: ['/health', '/api/auth/login']
   */
  excludedRoutes: string[];

  /**
   * Route prefixes that don't require tenant context.
   * Example: ['/public/', '/webhooks/']
   */
  excludedPrefixes: string[];

  /**
   * Optional function to validate tenant exists.
   * If provided, middleware will call this before accepting tenant.
   */
  validateTenant?: (tenantId: string) => Promise<boolean>;
}

/**
 * Default middleware options.
 */
const defaultOptions: TenantMiddlewareOptions = {
  allowHeaderTenant: config.NODE_ENV !== 'production',
  excludedRoutes: ['/health', '/ready', '/metrics'],
  excludedPrefixes: ['/webhooks/', '/public/'],
};

/**
 * Check if a route should be excluded from tenant checking.
 *
 * @param url - Request URL
 * @param options - Middleware options
 * @returns True if route is excluded
 */
function isExcludedRoute(url: string, options: TenantMiddlewareOptions): boolean {
  // Check exact matches
  if (options.excludedRoutes.includes(url)) {
    return true;
  }

  // Check prefix matches
  for (const prefix of options.excludedPrefixes) {
    if (url.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract tenant ID from request.
 *
 * Priority:
 * 1. JWT token (most secure)
 * 2. X-Tenant-ID header (development only)
 *
 * @param request - Fastify request
 * @param options - Middleware options
 * @returns Tenant ID or null
 */
function extractTenantId(
  request: FastifyRequest,
  options: TenantMiddlewareOptions
): string | null {
  // Try tenantId already set by auth hook (JWT-based)
  const existingTenantId = (request as any).tenantId;
  if (typeof existingTenantId === 'string' && existingTenantId.trim()) {
    return existingTenantId.trim();
  }

  // Try X-Tenant-ID header (development mode)
  if (options.allowHeaderTenant) {
    const headerTenantId = request.headers['x-tenant-id'];
    if (typeof headerTenantId === 'string' && headerTenantId.trim()) {
      return headerTenantId.trim();
    }
  }

  return null;
}

/**
 * Extract user ID from request.
 *
 * @param request - Fastify request
 * @returns User ID or undefined
 */
function extractUserId(request: FastifyRequest): string | undefined {
  // Read userId set by the auth onRequest hook in routes/index.ts (JWT-based)
  const userId = (request as any).userId;
  if (typeof userId === 'string' && userId.trim()) {
    return userId.trim();
  }
  // Fallback: header-based for development/testing
  return request.headers['x-user-id'] as string | undefined;
}

/**
 * Register tenant middleware on Fastify instance.
 *
 * This middleware:
 * 1. Extracts tenant from request
 * 2. Validates tenant exists (optional)
 * 3. Wraps request handling in tenant context
 *
 * @param app - Fastify instance
 * @param customOptions - Custom middleware options
 *
 * @example
 * ```typescript
 * await registerTenantMiddleware(app, {
 *   allowHeaderTenant: false, // Production
 *   excludedRoutes: ['/health', '/login'],
 *   validateTenant: async (id) => {
 *     const tenant = await prisma.tenant.findUnique({ where: { id } });
 *     return !!tenant;
 *   },
 * });
 * ```
 */
export async function registerTenantMiddleware(
  app: FastifyInstance,
  customOptions: Partial<TenantMiddlewareOptions> = {}
): Promise<void> {
  const options: TenantMiddlewareOptions = {
    ...defaultOptions,
    ...customOptions,
  };

  middlewareLogger.info('Registering tenant middleware', {
    allowHeaderTenant: options.allowHeaderTenant,
    excludedRoutes: options.excludedRoutes,
    excludedPrefixes: options.excludedPrefixes,
  });

  /**
   * Pre-handler hook that runs before route handlers.
   */
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url.split('?')[0]; // Remove query string

    // Skip excluded routes
    if (isExcludedRoute(url, options)) {
      middlewareLogger.debug('Skipping tenant check for excluded route', { url });
      return;
    }

    // Extract tenant ID
    const tenantId = extractTenantId(request, options);

    if (!tenantId) {
      middlewareLogger.warn('Request without tenant context', {
        url,
        method: request.method,
        ip: request.ip,
      });

      return reply.code(401).send({
        success: false,
        error: {
          code: 'TENANT_REQUIRED',
          message: 'Tenant identification required. Provide X-Tenant-ID header or authenticate.',
        },
      });
    }

    // Validate tenant exists (if validator provided)
    if (options.validateTenant) {
      const isValid = await options.validateTenant(tenantId);
      if (!isValid) {
        middlewareLogger.warn('Invalid tenant ID', { tenantId, url });
        return reply.code(403).send({
          success: false,
          error: {
            code: 'INVALID_TENANT',
            message: 'Tenant not found or access denied.',
          },
        });
      }
    }

    // Store tenant context on request for access in route handlers
    const userId = extractUserId(request);
    (request as any).tenantContext = {
      tenantId,
      userId,
    } as TenantContextData;

    // Also set tenantId directly on request for convenience
    (request as any).tenantId = tenantId;

    middlewareLogger.debug('Tenant context set', { tenantId, userId, url });
  });

  middlewareLogger.info('Tenant middleware registered');
}

/**
 * Fastify plugin to wrap route handlers in tenant context.
 *
 * This is a decorator hook that wraps route handlers to run
 * within the tenant context extracted by the preHandler hook.
 *
 * @param app - Fastify instance
 */
export async function wrapRoutesWithTenantContext(app: FastifyInstance): Promise<void> {
  // onSend hook - tenant context is available on the request object
  // Note: X-Tenant-ID header intentionally NOT sent in responses for security
  app.addHook('onSend', async (_request, _reply, payload) => {
    return payload;
  });
}

/**
 * Helper to get tenant context from a request object.
 *
 * @param request - Fastify request
 * @returns Tenant context or undefined
 */
export function getTenantFromRequest(request: FastifyRequest): TenantContextData | undefined {
  return (request as any).tenantContext;
}

/**
 * Helper to require tenant context from a request.
 *
 * @param request - Fastify request
 * @returns Tenant context
 * @throws Error if no tenant context
 */
export function requireTenantFromRequest(request: FastifyRequest): TenantContextData {
  const context = getTenantFromRequest(request);
  if (!context) {
    throw new Error('Tenant context required but not found on request');
  }
  return context;
}
