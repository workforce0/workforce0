/**
 * =============================================================================
 * ADMIN: LEARNED SKILLS ROUTES
 * =============================================================================
 *
 * Admin endpoints for managing AI-learned skills (kill switch & listing).
 *
 * Endpoints:
 * ----------
 * GET  /admin/learned-skills        → List all learned skills
 * PATCH /admin/learned-skills/:id   → Activate or demote a skill (kill switch)
 *
 * @module routes/learned-skills
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';
import { requireAdmin } from '../middleware/rbac.middleware.js';

const logger = createChildLogger({ route: 'learned-skills' });

const PatchStatusSchema = z.object({
  status: z.enum(['active', 'demoted']),
});

export async function learnedSkillsRoutes(fastify: FastifyInstance): Promise<void> {
  // All routes in this module require admin+ role
  fastify.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/learned-skills
   *
   * Returns all learned skills (across all statuses) for admin review.
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const prisma = fastify.services.prisma;

    const skills = await prisma.learnedSkill.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return reply.send({
      success: true,
      data: skills,
      meta: { total: skills.length },
    });
  });

  /**
   * PATCH /admin/learned-skills/:id
   *
   * Activate or demote a single learned skill (kill switch).
   * Body: { status: 'active' | 'demoted' }
   */
  fastify.patch('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const parsed = PatchStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Status must be "active" or "demoted"' },
      });
    }

    const prisma = fastify.services.prisma;
    const redis = fastify.services.redis;

    try {
      const skill = await prisma.learnedSkill.update({
        where: { id },
        data: { status: parsed.data.status },
      });

      logger.info('Learned skill status updated', {
        skillId: id,
        name: skill.name,
        status: parsed.data.status,
        userId: (request as any).userId,
      });

      // Invalidate Redis skill cache so agents pick up the change immediately
      if (redis) {
        const keys = await redis.keys('skills:learned:*');
        if (keys.length > 0) await redis.del(...keys);
      }

      // Audit log: skill kill-switch used
      fastify.services.auditService.log({
        tenantId: (request as any).tenantId,
        userId: (request as any).userId,
        action: 'admin.learned_skill.status_update',
        resource: 'learned_skill',
        resourceId: id,
        after: { status: parsed.data.status },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send({ success: true, data: skill });
    } catch (err) {
      logger.warn('Learned skill not found', { skillId: id, error: (err as Error).message });
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Learned skill not found' },
      });
    }
  });

  /**
   * POST /admin/learned-skills/distill
   *
   * Runs one skill-distillation pass on demand. Scans AgentOutcome rows
   * from the last 30 days, clusters approved runs by (agentType, tool
   * signature), and asks the LLM to turn each cluster of >= 3 examples
   * into a markdown playbook. Results land as candidate rows in the same
   * `learned_skills` table this module already manages — the admin flips
   * them to active or demoted via the PATCH above.
   */
  fastify.post('/distill', async (request: FastifyRequest, reply: FastifyReply) => {
    const distiller = fastify.services.skillDistillerService;
    if (!distiller) {
      return reply.status(503).send({
        success: false,
        error: { code: 'NOT_CONFIGURED', message: 'Skill distillation service is not wired.' },
      });
    }
    const result = await distiller.distill();
    logger.info('Manual distill pass completed', { ...result, userId: (request as any).userId });
    fastify.services.auditService.log({
      tenantId: (request as any).tenantId,
      userId: (request as any).userId,
      action: 'admin.learned_skill.distill_run',
      resource: 'learned_skill',
      after: result,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return reply.send({ success: true, data: result });
  });

  /**
   * POST /admin/learned-skills/rerank
   *
   * Runs one outcome-based ranking pass. Reads AgentOutcome rows from the
   * last 14 days, aggregates approval rate per agent type, and nudges
   * each active learned skill's confidence up or down accordingly. Skills
   * that fall below 0.2 confidence auto-demote to status="demoted" and
   * stop being injected into agent prompts.
   */
  fastify.post('/rerank', async (request: FastifyRequest, reply: FastifyReply) => {
    const ranker = fastify.services.skillRankingService;
    if (!ranker) {
      return reply.status(503).send({
        success: false,
        error: { code: 'NOT_CONFIGURED', message: 'Skill ranking service is not wired.' },
      });
    }
    const result = await ranker.recompute();
    logger.info('Manual rerank pass completed', { ...result, userId: (request as any).userId });
    fastify.services.auditService.log({
      tenantId: (request as any).tenantId,
      userId: (request as any).userId,
      action: 'admin.learned_skill.rerank_run',
      resource: 'learned_skill',
      after: result,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return reply.send({ success: true, data: result });
  });
}
