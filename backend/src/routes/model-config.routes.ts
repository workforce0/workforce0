/**
 * =============================================================================
 * MODEL CONFIGURATION API ROUTES
 * =============================================================================
 *
 * Per-tenant model selection and configuration for AI agents.
 *
 * Endpoints:
 * ----------
 * GET /models/config     -> Get tenant's model configuration
 * PUT /models/config     -> Update model assignments for an agent
 * GET /models/available  -> List available models and providers
 *
 * @module routes/model-config
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';
import { requireAdmin, requireMember } from '../middleware/rbac.middleware.js';

const logger = createChildLogger({ route: 'model-config' });

const UpdateConfigSchema = z.object({
  agentType: z.enum([
    'meeting_brain',
    'ba_agent',
    'dev_agent',
    'qa_agent',
    'supervisor',
    'memory_optimizer',
  ]),
  primaryModelId: z.string().min(1),
  reviewerModelIds: z.array(z.string()).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  maxSteps: z.number().int().min(1).max(200).optional(),
  preset: z.enum(['recommended', 'budget', 'premium', 'custom']).optional(),
});

export async function modelConfigRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /models/config
   *
   * Get the authenticated tenant's full model configuration:
   * all agent configs with their associated model + provider info.
   */
  fastify.get('/config', { preHandler: [requireMember] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const prisma = fastify.services.prisma;

    logger.info({ tenantId }, 'Fetching model configuration');

    const [agentConfigs, providers] = await Promise.all([
      prisma.agentConfig.findMany({
        where: { tenantId },
        orderBy: { agentType: 'asc' },
      }),
      prisma.modelProvider.findMany({
        where: { tenantId, isActive: true },
        include: { models: { where: { isActive: true } } },
      }),
    ]);

    return reply.send({
      success: true,
      data: {
        agents: agentConfigs,
        providers,
      },
    });
  });

  /**
   * PUT /models/config
   *
   * Update model assignments for a specific agent type.
   * Creates the config if it doesn't exist yet (upsert).
   */
  fastify.put('/config', { preHandler: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const body = UpdateConfigSchema.parse(request.body);
    const prisma = fastify.services.prisma;

    logger.info(
      { tenantId, agentType: body.agentType, primaryModelId: body.primaryModelId },
      'Updating model configuration',
    );

    // Verify the primary model exists and belongs to the tenant
    const primaryModel = await prisma.modelConfig.findFirst({
      where: { id: body.primaryModelId, tenantId },
    });

    if (!primaryModel) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_MODEL', message: 'Primary model not found for this tenant' },
      });
    }

    // Verify reviewer models if provided
    if (body.reviewerModelIds && body.reviewerModelIds.length > 0) {
      const reviewerModels = await prisma.modelConfig.findMany({
        where: { id: { in: body.reviewerModelIds }, tenantId },
      });

      if (reviewerModels.length !== body.reviewerModelIds.length) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_MODEL', message: 'One or more reviewer models not found for this tenant' },
        });
      }
    }

    const updated = await prisma.agentConfig.upsert({
      where: {
        tenantId_agentType: { tenantId, agentType: body.agentType },
      },
      update: {
        primaryModelId: body.primaryModelId,
        reviewerModelIds: body.reviewerModelIds ?? undefined,
        confidenceThreshold: body.confidenceThreshold,
        maxSteps: body.maxSteps,
        preset: body.preset ?? 'custom',
      },
      create: {
        tenantId,
        agentType: body.agentType,
        primaryModelId: body.primaryModelId,
        reviewerModelIds: body.reviewerModelIds ?? [],
        confidenceThreshold: body.confidenceThreshold ?? 0.85,
        maxSteps: body.maxSteps ?? 25,
        preset: body.preset ?? 'custom',
        isActive: true,
      },
    });

    logger.info({ tenantId, agentType: body.agentType }, 'Model configuration updated');

    return reply.send({
      success: true,
      data: updated,
    });
  });

  /**
   * GET /models/available
   *
   * List all available providers and models for the tenant.
   */
  fastify.get('/available', { preHandler: [requireMember] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const prisma = fastify.services.prisma;

    logger.info({ tenantId }, 'Listing available models');

    const providers = await prisma.modelProvider.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });

    const models = await prisma.modelConfig.findMany({
      where: { tenantId, isActive: true },
      include: { provider: true },
      orderBy: { displayName: 'asc' },
    });

    return reply.send({
      success: true,
      data: {
        providers,
        models,
      },
    });
  });
}
