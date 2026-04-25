/**
 * Cron scheduler API — manage recurring jobs (Hermes III M7).
 *
 *   GET    /api/cron         — list all scheduled jobs in this workspace
 *   POST   /api/cron         — create a scheduled job
 *   PATCH  /api/cron/:id     — enable/disable a scheduled job
 *   DELETE /api/cron/:id     — remove a scheduled job
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'cron' });

export async function cronRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const jobs = await fastify.services.cronSchedulerService.list(tenantId);
    return reply.send({ success: true, data: jobs });
  });

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const userId = (request as FastifyRequest & { userId?: string }).userId;
    const schema = z.object({
      name: z.string().min(1).max(200),
      cronExpression: z.string().min(1),
      timezone: z.string().optional(),
      jobType: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: parsed.error.issues.map((i) => i.message).join('; ') },
      });
    }
    try {
      const job = await fastify.services.cronSchedulerService.create({
        tenantId,
        ...parsed.data,
        createdBy: userId,
      });
      logger.info('Scheduled job created', { tenantId, name: parsed.data.name });
      return reply.status(201).send({ success: true, data: job });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_JOB', message: (err as Error).message },
      });
    }
  });

  fastify.patch('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const schema = z.object({ enabled: z.boolean() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'enabled (boolean) required' },
      });
    }
    try {
      const job = await fastify.services.cronSchedulerService.setEnabled(
        tenantId,
        id,
        parsed.data.enabled,
      );
      return reply.send({ success: true, data: job });
    } catch {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Scheduled job not found' },
      });
    }
  });

  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    await fastify.services.cronSchedulerService.delete(tenantId, id);
    return reply.send({ success: true });
  });
}
