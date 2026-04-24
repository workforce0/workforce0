/**
 * Role-Based Access Control (RBAC) middleware.
 *
 * Permission matrix:
 *   Action                    | owner | admin | member | viewer
 *   View dashboard/meetings   |  Y    |  Y    |   Y    |   Y
 *   Schedule meetings         |  Y    |  Y    |   Y    |   N
 *   Trigger BA Agent          |  Y    |  Y    |   Y    |   N
 *   Approve/reject PRDs       |  Y    |  Y    |   N    |   N
 *   Create Jira tickets       |  Y    |  Y    |   N    |   N
 *   Manage integrations       |  Y    |  Y    |   N    |   N
 *   Manage team members       |  Y    |  Y    |   N    |   N
 *   Delete workspace          |  Y    |  N    |   N    |   N
 */

import { FastifyRequest, FastifyReply } from 'fastify';

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

/**
 * Creates a Fastify preHandler that checks if the request user has
 * one of the allowed roles.
 */
export function requireRole(allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = (request as any).userRole as UserRole | undefined;

    if (!role) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'No role information available' },
      });
    }

    if (!allowedRoles.includes(role)) {
      return reply.status(403).send({
        success: false,
        error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'You do not have permission to perform this action' },
      });
    }
  };
}

/**
 * Shorthand: requires at least the given minimum role level.
 */
export function requireMinRole(minRole: UserRole) {
  const minLevel = ROLE_HIERARCHY[minRole];
  const allowed = (Object.entries(ROLE_HIERARCHY) as [UserRole, number][])
    .filter(([, level]) => level >= minLevel)
    .map(([role]) => role);
  return requireRole(allowed);
}

/**
 * Convenience guards for common patterns.
 */
export const requireOwner = requireRole(['owner']);
export const requireAdmin = requireRole(['owner', 'admin']);
export const requireMember = requireRole(['owner', 'admin', 'member']);
export const requireViewer = requireRole(['owner', 'admin', 'member', 'viewer']);
