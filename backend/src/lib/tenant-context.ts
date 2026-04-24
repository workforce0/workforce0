/**
 * =============================================================================
 * TENANT CONTEXT
 * =============================================================================
 *
 * AsyncLocalStorage-based tenant context for multi-tenancy.
 *
 * Why AsyncLocalStorage?
 * ----------------------
 * - Thread-safe context per request (like Java's ThreadLocal)
 * - No need to pass tenantId through every function
 * - Automatic cleanup when request ends
 * - Works with async/await
 *
 * How It Works:
 * -------------
 * 1. Request comes in with tenant identifier (JWT or header)
 * 2. Middleware extracts tenant and calls tenantContext.run(tenantId, ...)
 * 3. Any code in that execution context can call getTenantId()
 * 4. Prisma middleware uses getTenantId() to auto-filter queries
 *
 * @module lib/tenant-context
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Tenant context data stored per request.
 */
export interface TenantContextData {
  tenantId: string;
  userId?: string;
  roles?: string[];
}

/**
 * AsyncLocalStorage instance for tenant context.
 * Each async execution chain gets its own isolated store.
 */
const tenantStorage = new AsyncLocalStorage<TenantContextData>();

/**
 * Run a function within a tenant context.
 *
 * All code executed within the callback (including async operations)
 * will have access to the tenant context.
 *
 * @param context - Tenant context data
 * @param fn - Function to execute within the context
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * await runWithTenant({ tenantId: 'tenant_123' }, async () => {
 *   // Inside here, getTenantId() returns 'tenant_123'
 *   const meetings = await meetingRepository.findMany({});
 *   // Prisma middleware auto-adds: WHERE tenantId = 'tenant_123'
 * });
 * ```
 */
export function runWithTenant<T>(
  context: TenantContextData,
  fn: () => T
): T {
  return tenantStorage.run(context, fn);
}

/**
 * Get the current tenant ID from context.
 *
 * @returns Current tenant ID or undefined if not in a tenant context
 *
 * @example
 * ```typescript
 * const tenantId = getTenantId();
 * if (!tenantId) {
 *   throw new Error('No tenant context');
 * }
 * ```
 */
export function getTenantId(): string | undefined {
  const store = tenantStorage.getStore();
  return store?.tenantId;
}

/**
 * Get the current tenant ID, throwing if not available.
 *
 * Use this when tenant context is required.
 *
 * @returns Current tenant ID
 * @throws Error if not in a tenant context
 *
 * @example
 * ```typescript
 * // Will throw if called outside tenant context
 * const tenantId = requireTenantId();
 * ```
 */
export function requireTenantId(): string {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error('Tenant context required but not available');
  }
  return tenantId;
}

/**
 * Get the full tenant context.
 *
 * @returns Current tenant context or undefined
 */
export function getTenantContext(): TenantContextData | undefined {
  return tenantStorage.getStore();
}

/**
 * Get the current user ID from context.
 *
 * @returns Current user ID or undefined
 */
export function getUserId(): string | undefined {
  const store = tenantStorage.getStore();
  return store?.userId;
}

/**
 * Check if current context has a specific role.
 *
 * @param role - Role to check
 * @returns True if context has the role
 */
export function hasRole(role: string): boolean {
  const store = tenantStorage.getStore();
  return store?.roles?.includes(role) ?? false;
}

/**
 * Check if we're currently in a tenant context.
 *
 * @returns True if tenant context is active
 */
export function hasTenantContext(): boolean {
  return tenantStorage.getStore() !== undefined;
}
