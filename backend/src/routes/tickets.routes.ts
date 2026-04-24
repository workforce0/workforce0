/**
 * =============================================================================
 * TICKETS ROUTES
 * =============================================================================
 *
 *   GET    /tickets                 — list (optional ?role=&status=&limit=)
 *   POST   /tickets                 — create
 *   GET    /tickets/:id             — fetch one
 *   GET    /tickets/:id/events      — event timeline
 *   POST   /tickets/claim           — claim next ready ticket for a role
 *   POST   /tickets/:id/transition  — move to a new status
 *   POST   /tickets/:id/comment     — append a comment to the event log
 *
 * @module routes/tickets
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'tickets' });

const CreateSchema = z.object({
  roleSlug: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  goalId: z.string().nullable().optional(),
  parentTicketId: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
});

const ClaimSchema = z.object({
  roleSlug: z.string().min(1).max(64),
  agentId: z.string().min(1).max(128),
});

const TransitionSchema = z.object({
  status: z.enum(['ready', 'claimed', 'waiting', 'done', 'failed', 'cancelled']),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(5_000).optional(),
});

const CommentSchema = z.object({
  text: z.string().min(1).max(5_000),
});

export async function ticketsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const projectId = (request as any).projectId as string | null;
    const q = request.query as Record<string, string | undefined>;
    const limit = q.limit ? Number(q.limit) : undefined;
    const tickets = await fastify.services.ticketService.listForTenant(tenantId, {
      roleSlug: q.role,
      status: q.status as any,
      projectId,
      limit,
    });
    return reply.send({ success: true, data: tickets });
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
    const ticket = await fastify.services.ticketService.create({
      tenantId,
      createdBy: userId,
      ...parsed.data,
    });
    logger.info('Ticket created via API', { tenantId, ticketId: ticket.id, roleSlug: ticket.roleSlug });
    return reply.status(201).send({ success: true, data: ticket });
  });

  fastify.post('/claim', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const parsed = ClaimSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
      });
    }
    const ticket = await fastify.services.ticketService.claimNext(
      tenantId,
      parsed.data.roleSlug,
      parsed.data.agentId,
    );
    return reply.send({ success: true, data: ticket /* null when queue is empty */ });
  });

  fastify.get('/:id', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const ticket = await fastify.services.ticketService.findById(tenantId, id);
    if (!ticket) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
    return reply.send({ success: true, data: ticket });
  });

  fastify.get('/:id/events', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const events = await fastify.services.ticketService.listEvents(tenantId, id);
    return reply.send({ success: true, data: events });
  });

  fastify.post('/:id/transition', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string | undefined;
    const { id } = request.params as { id: string };
    const parsed = TransitionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
      });
    }
    try {
      const ticket = await fastify.services.ticketService.transition(tenantId, id, parsed.data.status, {
        actor: userId ?? 'user',
        result: parsed.data.result,
        error: parsed.data.error,
      });
      return reply.send({ success: true, data: ticket });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: { code: 'ILLEGAL_TRANSITION', message: (err as Error).message },
      });
    }
  });

  fastify.post('/:id/comment', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string | undefined;
    const { id } = request.params as { id: string };
    const parsed = CommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
      });
    }
    // Verify tenant scope before commenting
    const ticket = await fastify.services.ticketService.findById(tenantId, id);
    if (!ticket) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
    const ev = await fastify.services.ticketService.comment(id, userId ?? 'user', parsed.data.text);
    return reply.status(201).send({ success: true, data: ev });
  });
}
