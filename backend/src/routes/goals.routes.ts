/**
 * =============================================================================
 * GOALS ROUTES
 * =============================================================================
 *
 *   GET    /goals           — list for tenant (optional ?status=)
 *   POST   /goals           — create
 *   GET    /goals/:id       — fetch one
 *   PATCH  /goals/:id       — update
 *   GET    /goals/:id/ancestors  — walk up parent chain (for UI breadcrumb)
 *
 * @module routes/goals
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'goals' });

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5_000).optional(),
  outcome: z.string().max(2_000).optional(),
  parentGoalId: z.string().nullable().optional(),
  targetDate: z.string().datetime().nullable().optional(),
});

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5_000).optional(),
  outcome: z.string().max(2_000).optional(),
  parentGoalId: z.string().nullable().optional(),
  status: z.enum(['active', 'achieved', 'abandoned']).optional(),
  targetDate: z.string().datetime().nullable().optional(),
});

export async function goalsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const projectId = (request as any).projectId as string | null;
    const status = (request.query as any)?.status as string | undefined;
    const goals = await fastify.services.goalService.listForTenant(tenantId, { status, projectId });
    return reply.send({ success: true, data: goals });
  });

  fastify.post('/', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string | undefined;
    const parsed = CreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
      });
    }
    const goal = await fastify.services.goalService.create({
      tenantId,
      title: parsed.data.title,
      description: parsed.data.description,
      outcome: parsed.data.outcome,
      parentGoalId: parsed.data.parentGoalId ?? null,
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : null,
      createdBy: userId,
    });
    logger.info('Goal created via API', { tenantId, goalId: goal.id, userId });
    return reply.status(201).send({ success: true, data: goal });
  });

  fastify.get('/:id', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const goal = await fastify.services.goalService.findById(tenantId, id);
    if (!goal) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Goal not found' } });
    return reply.send({ success: true, data: goal });
  });

  fastify.patch('/:id', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const parsed = PatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
      });
    }
    const patch = {
      ...parsed.data,
      targetDate: parsed.data.targetDate === undefined
        ? undefined
        : parsed.data.targetDate === null
          ? null
          : new Date(parsed.data.targetDate),
    };
    const goal = await fastify.services.goalService.update(tenantId, id, patch as any);
    if (!goal) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Goal not found' } });
    return reply.send({ success: true, data: goal });
  });

  fastify.get('/:id/ancestors', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const chain = await fastify.services.goalService.listAncestors(tenantId, id);
    return reply.send({ success: true, data: chain });
  });
}
