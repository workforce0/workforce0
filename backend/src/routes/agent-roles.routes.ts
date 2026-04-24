/**
 * =============================================================================
 * AGENT ROLES ROUTES
 * =============================================================================
 *
 * REST surface for the pluggable agent-role table.
 *
 *   GET    /agent-roles         — list effective roles for this tenant
 *   PATCH  /agent-roles/:slug   — upsert a tenant-scoped override (admin)
 *   DELETE /agent-roles/:slug   — drop a tenant override (admin)
 *
 * Admin-only on mutations: roles are a governance surface. A rogue user
 * shouldn't be able to expand an agent's tool whitelist or disable its
 * budget cap.
 *
 * @module routes/agent-roles
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';
import { requireAdmin } from '../middleware/rbac.middleware.js';

const logger = createChildLogger({ route: 'agent-roles' });

const PatchSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  description: z.string().max(2_000).optional(),
  systemPromptTemplate: z.string().max(20_000).nullable().optional(),
  allowedTools: z.array(z.string().min(1).max(40)).max(32).optional(),
  monthlyBudgetTokens: z.number().int().positive().nullable().optional(),
  defaultConcurrency: z.number().int().min(1).max(32).optional(),
  /** N5: org-chart parent. Pass null to move to top level. */
  parentRoleSlug: z.string().min(1).max(64).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function agentRolesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const roles = await fastify.services.agentRoleService.listForTenant(tenantId);
    return reply.send({ success: true, data: roles });
  });

  fastify.patch('/:slug', { preHandler: [requireAdmin] }, async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string | undefined;
    const { slug } = request.params as { slug: string };

    const parsed = PatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
      });
    }

    const role = await fastify.services.agentRoleService.upsertOverride({
      tenantId,
      slug,
      ...parsed.data,
    });

    logger.info('Agent role override upserted', { tenantId, slug, userId });
    fastify.services.auditService.log({
      tenantId,
      userId,
      action: 'agent_role.override',
      resource: 'agent_role',
      resourceId: role.id,
      after: { slug, ...parsed.data },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.send({ success: true, data: role });
  });

  // M6: version history for a role (audit + rollback).
  fastify.get('/:slug/versions', { preHandler: [requireAdmin] }, async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { slug } = request.params as { slug: string };
    const versions = await fastify.services.agentRoleService.listVersions(tenantId, slug);
    return reply.send({ success: true, data: versions });
  });

  fastify.post('/:slug/rollback/:versionId', { preHandler: [requireAdmin] }, async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string | undefined;
    const { slug, versionId } = request.params as { slug: string; versionId: string };
    const note = (request.body as any)?.note as string | undefined;

    const restored = await fastify.services.agentRoleService.rollback(tenantId, slug, versionId, {
      changedBy: userId,
      note,
    });
    if (!restored) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `Version ${versionId} not found for slug ${slug}` },
      });
    }

    fastify.services.auditService.log({
      tenantId,
      userId,
      action: 'agent_role.rollback',
      resource: 'agent_role',
      resourceId: slug,
      after: { versionId, note },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    logger.info('Agent role rolled back', { tenantId, slug, versionId, userId });
    return reply.send({ success: true, data: restored });
  });

  fastify.delete('/:slug', { preHandler: [requireAdmin] }, async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string | undefined;
    const { slug } = request.params as { slug: string };

    // Drop the tenant override — built-ins live under tenantId=NULL and
    // are untouchable from this endpoint.
    const deleted = await (fastify.services.prisma as any).agentRole.deleteMany({
      where: { tenantId, slug },
    });

    if (deleted.count === 0) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `No override for slug "${slug}" on this tenant` },
      });
    }

    logger.info('Agent role override removed', { tenantId, slug, userId });
    fastify.services.auditService.log({
      tenantId,
      userId,
      action: 'agent_role.override_removed',
      resource: 'agent_role',
      resourceId: slug,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.send({ success: true });
  });
}
