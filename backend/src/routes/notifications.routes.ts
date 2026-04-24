/**
 * =============================================================================
 * NOTIFICATIONS API ROUTES
 * =============================================================================
 *
 * In-app notifications for clarifications, approvals, and system events.
 * These ensure users always see pending items on the dashboard, even when
 * external channels (GChat, Slack, etc.) are not configured.
 *
 * Endpoints:
 * ----------
 * GET    /notifications          → List notifications for current tenant
 * PATCH  /notifications/:id      → Mark a notification as read/dismissed
 *
 * @module routes/notifications
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'notifications' });

const ListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['pending', 'read', 'all']).default('pending'),
  type: z.string().optional(),
});

const UpdateBodySchema = z.object({
  status: z.enum(['read', 'dismissed']),
});

export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /notifications
   *
   * Returns notifications for the current tenant, filtered by status.
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const query = ListQuerySchema.parse(request.query);
    const prisma = fastify.services.prisma;

    const where: Record<string, unknown> = { tenantId };
    if (query.status !== 'all') {
      where.status = query.status;
    }
    if (query.type) {
      where.type = query.type;
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
      prisma.notification.count({ where }),
    ]);

    return reply.send({
      success: true,
      data: notifications,
      meta: { total, returned: notifications.length },
    });
  });

  /**
   * PATCH /notifications/:id
   *
   * Mark a notification as read or dismissed.
   */
  fastify.patch('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const body = UpdateBodySchema.parse(request.body);
    const prisma = fastify.services.prisma;

    const notification = await prisma.notification.findFirst({
      where: { id, tenantId },
    });

    if (!notification) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Notification not found' },
      });
    }

    const updated = await prisma.notification.update({
      where: { id, tenantId },
      data: { status: body.status },
    });

    return reply.send({ success: true, data: updated });
  });
}
