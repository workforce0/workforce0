/**
 * =============================================================================
 * ENGAGEMENT API ROUTES
 * =============================================================================
 *
 * Manage engagement lifecycle through the 8-phase state machine.
 *
 * Endpoints:
 * ----------
 * GET  /engagements          -> List engagements for tenant
 * GET  /engagements/:id      -> Get engagement details
 * POST /engagements/:id/advance -> Advance to next phase
 * POST /engagements/:id/pause   -> Pause engagement
 * POST /engagements/:id/resume  -> Resume paused engagement
 *
 * @module routes/engagements
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';
import { EngagementService } from '../services/engagement/engagement.service.js';

const logger = createChildLogger({ route: 'engagements' });

const StatusFilterSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'failed']).optional(),
});

const AdvanceSchema = z.object({
  confidence: z.number().min(0).max(1).optional(),
  output: z.any().optional(),
});

const PauseSchema = z.object({
  reason: z.string().optional(),
});

export async function engagementRoutes(fastify: FastifyInstance): Promise<void> {
  const engagementService = new EngagementService(fastify.services.prisma);

  /**
   * GET /engagements
   *
   * List engagements for the authenticated tenant.
   * Optionally filter by status query param.
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const projectId = (request as any).projectId as string | null;
    const { status } = StatusFilterSchema.parse(request.query);

    logger.info({ tenantId, projectId, status }, 'Listing engagements');

    const engagements = await engagementService.listByTenant(
      tenantId,
      status as any,
      projectId,
    );

    return reply.send({
      success: true,
      data: engagements,
    });
  });

  /**
   * GET /engagements/:id
   *
   * Get a single engagement by ID.
   */
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };

    try {
      const engagement = await engagementService.get(id);

      // Ensure the engagement belongs to the requesting tenant
      if (engagement.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Engagement not found' },
        });
      }

      return reply.send({
        success: true,
        data: engagement,
      });
    } catch (error) {
      if ((error as Error).message === 'Engagement not found') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Engagement not found' },
        });
      }
      throw error;
    }
  });

  /**
   * POST /engagements/:id/advance
   *
   * Advance an engagement to the next phase in the lifecycle.
   */
  fastify.post('/:id/advance', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const body = AdvanceSchema.parse(request.body);

    logger.info({ tenantId, engagementId: id }, 'Advancing engagement');

    try {
      const updated = await engagementService.advancePhase(tenantId, id, {
        confidence: body.confidence,
        output: body.output,
      });

      return reply.send({
        success: true,
        data: updated,
      });
    } catch (error) {
      const message = (error as Error).message;

      if (message === 'Engagement not found') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Engagement not found' },
        });
      }

      if (message.includes('cannot advance') || message.includes('Invalid transition')) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TRANSITION', message },
        });
      }

      throw error;
    }
  });

  /**
   * POST /engagements/:id/ship
   *
   * Mark the PR as shipped/merged and advance to the 'learn' phase.
   * This is the human trigger that completes the build cycle.
   */
  fastify.post('/:id/ship', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const body = z.object({
      prUrl: z.string().optional(),
      notes: z.string().optional(),
    }).parse(request.body ?? {});

    logger.info({ tenantId, engagementId: id }, 'Shipping engagement');

    try {
      const engagement = await engagementService.get(id);

      if (engagement.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Engagement not found' },
        });
      }

      if (engagement.phase !== 'ship') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PHASE',
            message: `Engagement is in '${engagement.phase}' phase, not 'ship'. Cannot mark as shipped.`,
          },
        });
      }

      const updated = await engagementService.advancePhase(tenantId, id, {
        confidence: 1.0,
        targetPhase: 'learn',
        output: {
          shippedAt: new Date().toISOString(),
          prUrl: body.prUrl,
          notes: body.notes,
          shippedBy: (request as any).userId ?? 'human',
        },
      });

      return reply.send({
        success: true,
        data: updated,
        message: 'PR shipped. Memory optimization agent has been dispatched to learn from this engagement.',
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'Engagement not found') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message },
        });
      }
      throw error;
    }
  });

  /**
   * POST /engagements/:id/pause
   *
   * Pause an active engagement.
   */
  fastify.post('/:id/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const body = PauseSchema.parse(request.body);

    logger.info({ tenantId, engagementId: id, reason: body.reason }, 'Pausing engagement');

    try {
      const updated = await engagementService.pause(tenantId, id, body.reason);

      return reply.send({
        success: true,
        data: updated,
      });
    } catch (error) {
      if ((error as Error).message === 'Engagement not found') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Engagement not found' },
        });
      }
      throw error;
    }
  });

  /**
   * POST /engagements/:id/resume
   *
   * Resume a paused engagement.
   */
  fastify.post('/:id/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };

    logger.info({ tenantId, engagementId: id }, 'Resuming engagement');

    try {
      const updated = await engagementService.resume(tenantId, id);

      return reply.send({
        success: true,
        data: updated,
      });
    } catch (error) {
      if ((error as Error).message === 'Engagement not found') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Engagement not found' },
        });
      }
      throw error;
    }
  });
}
