/**
 * PROJECTS ROUTES
 * =============================================================================
 *
 *   GET    /projects         — list active projects (?includeArchived=1 to see all)
 *   POST   /projects         — create
 *   GET    /projects/:id     — fetch one
 *   PATCH  /projects/:id     — rename / recolor / archive / unarchive
 *   DELETE /projects/:id     — hard delete (only if no referring rows)
 *
 * @module routes/projects
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'projects' });

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(5_000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const PatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(5_000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  isArchived: z.boolean().optional(),
});

export async function projectsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const includeArchived = (request.query as any)?.includeArchived === '1';
    const projects = await fastify.services.projectService.listForTenant(tenantId, { includeArchived });
    return reply.send({ success: true, data: projects });
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
    const project = await fastify.services.projectService.create({
      tenantId,
      createdBy: userId,
      ...parsed.data,
    });
    logger.info('Project created via API', { tenantId, projectId: project.id, userId });
    return reply.status(201).send({ success: true, data: project });
  });

  fastify.get('/:id', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const project = await fastify.services.projectService.findById(tenantId, id);
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    return reply.send({ success: true, data: project });
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
    const project = await fastify.services.projectService.update(tenantId, id, parsed.data as any);
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    return reply.send({ success: true, data: project });
  });

  fastify.delete('/:id', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const r = await fastify.services.projectService.remove(tenantId, id);
    if (!r.deleted) {
      const status = r.reason === 'not_found' ? 404 : 400;
      return reply.status(status).send({
        success: false,
        error: { code: r.reason === 'not_found' ? 'NOT_FOUND' : 'HAS_REFERENCES', message: r.reason ?? '' },
      });
    }
    return reply.send({ success: true });
  });
}
