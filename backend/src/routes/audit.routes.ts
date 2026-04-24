/**
 * =============================================================================
 * AUDIT LOG API ROUTES
 * =============================================================================
 *
 * Query audit trail for compliance. Admin/owner only.
 *
 * Endpoints:
 * ----------
 * GET /audit-log  → Paginated audit log with filters
 *
 * @module routes/audit
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/rbac.middleware.js';

const QuerySchema = z.object({
  action: z.string().optional(),
  resource: z.string().optional(),
  userId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export async function auditRoutes(fastify: FastifyInstance): Promise<void> {
  // All audit routes require admin+ role
  fastify.addHook('preHandler', requireAdmin);

  /**
   * GET /audit-log
   *
   * Returns paginated audit log entries filtered by action, resource, user, date range.
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const query = QuerySchema.parse(request.query);

    const result = await fastify.services.auditService.query(tenantId, {
      action: query.action,
      resource: query.resource,
      userId: query.userId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
    });

    return reply.send({
      success: true,
      data: result.entries,
      meta: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  });
}
