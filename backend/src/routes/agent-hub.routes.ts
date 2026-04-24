/**
 * =============================================================================
 * AGENT HUB API ROUTES
 * =============================================================================
 *
 * REST endpoints for managing agent tokens and viewing job status.
 *
 * Endpoints:
 * ----------
 * POST   /agents/tokens       — Create agent token (returns raw token ONCE)
 * GET    /agents/tokens       — List tokens (shows tokenHint, not raw token)
 * DELETE /agents/tokens/:id   — Revoke token (set revokedAt)
 * GET    /agents/status       — Connected agents (from agentHub if available)
 * GET    /agents/jobs         — List AgentJobs (filterable by status)
 * GET    /agents/jobs/:id     — Job detail
 *
 * @module routes/agent-hub
 */

import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'agent-hub' });

const CreateTokenSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function agentHubRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = fastify.services.prisma;

  // ===========================================================================
  // POST /agents/tokens — Create agent token (raw token returned ONCE)
  // ===========================================================================
  fastify.post('/tokens', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string;

    let body: z.infer<typeof CreateTokenSchema>;
    try {
      body = CreateTokenSchema.parse(request.body);
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: err.message },
      });
    }

    const rawToken = `wf0_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenHint = rawToken.slice(-4);

    logger.info('Creating agent token', { tenantId, name: body.name });

    await prisma.agentToken.create({
      data: {
        tenantId,
        name: body.name,
        tokenHash,
        tokenHint,
        createdBy: userId,
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        token: rawToken,
        tokenHint: `•••${tokenHint}`,
        name: body.name,
      },
    });
  });

  // ===========================================================================
  // GET /agents/tokens — List tokens (tokenHint only, never raw token)
  // ===========================================================================
  fastify.get('/tokens', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;

    const tokens = await prisma.agentToken.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        tokenHint: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      success: true,
      data: { tokens },
    });
  });

  // ===========================================================================
  // DELETE /agents/tokens/:id — Revoke token
  // ===========================================================================
  fastify.delete('/tokens/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };

    logger.info('Revoking agent token', { tenantId, tokenId: id });

    try {
      await prisma.agentToken.update({
        where: { id, tenantId },
        data: { revokedAt: new Date() },
      });
    } catch (err: any) {
      if (err.code === 'P2025') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Token not found' },
        });
      }
      throw err;
    }

    return reply.send({
      success: true,
      data: { message: 'Token revoked' },
    });
  });

  // ===========================================================================
  // GET /agents/status — Connected agents (from agentHub if available)
  // ===========================================================================
  fastify.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;

    const agents = (fastify.services as any).agentHub?.getAgentStatus(tenantId) || [];

    return reply.send({
      success: true,
      data: { agents, connected: agents.length },
    });
  });

  // ===========================================================================
  // GET /agents/jobs — List AgentJobs (filterable by ?status=)
  // ===========================================================================
  fastify.get('/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const status = (request.query as any).status as string | undefined;
    const limit = Math.min(parseInt((request.query as any).limit || '50', 10), 100);

    const jobs = await prisma.agentJob.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return reply.send({
      success: true,
      data: jobs,
    });
  });

  // ===========================================================================
  // GET /agents/jobs/:id — Job detail
  // ===========================================================================
  fastify.get('/jobs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };

    const job = await prisma.agentJob.findFirst({
      where: { id, tenantId },
    });

    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    return reply.send({
      success: true,
      data: { job },
    });
  });
}
