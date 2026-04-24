/**
 * Skills API routes — manage markdown playbooks that the agent loop
 * injects as user-message activations (see AGENTS.md § Skills as
 * User-Message Injection).
 *
 *   GET    /api/skills             — list active skills for the workspace
 *   POST   /api/skills             — create from raw markdown source
 *   GET    /api/skills/:slug       — fetch one by slug
 *   PUT    /api/skills/:id         — update (new source or toggle disabled)
 *   POST   /api/skills/:slug/invoke — build an activation payload for the
 *                                      agent loop to push as the next user turn
 *   DELETE /api/skills/:id         — permanent delete
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'skills' });

export async function skillsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const includeDisabled = (request.query as Record<string, string>)?.includeDisabled === 'true';
    const skills = await fastify.services.skillsService.list(tenantId, includeDisabled);
    return reply.send({ success: true, data: skills });
  });

  fastify.get('/:slug', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const { slug } = request.params as { slug: string };
    const skill = await fastify.services.skillsService.getBySlug(tenantId, slug);
    if (!skill) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `No skill with slug "${slug}"` },
      });
    }
    return reply.send({ success: true, data: skill });
  });

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const userId = (request as FastifyRequest & { userId?: string }).userId;
    const schema = z.object({
      source: z.string().min(1, 'Skill source cannot be empty'),
      fallbackName: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: parsed.error.issues.map((i) => i.message).join('; ') },
      });
    }
    try {
      const skill = await fastify.services.skillsService.create({
        tenantId,
        source: parsed.data.source,
        createdBy: userId,
        fallbackName: parsed.data.fallbackName,
      });
      return reply.status(201).send({ success: true, data: skill });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_SKILL', message: (err as Error).message },
      });
    }
  });

  fastify.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    const schema = z.object({
      source: z.string().min(1).optional(),
      disabled: z.boolean().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'Must supply source or disabled' },
      });
    }
    try {
      const updated = await fastify.services.skillsService.update(tenantId, id, parsed.data);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: (err as Error).message },
      });
    }
  });

  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const { id } = request.params as { id: string };
    try {
      await fastify.services.skillsService.delete(tenantId, id);
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: (err as Error).message },
      });
    }
  });

  fastify.post('/:slug/invoke', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const { slug } = request.params as { slug: string };
    const schema = z.object({
      userInstruction: z.string().optional(),
      config: z.record(z.string()).optional(),
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'userInstruction / config must match the schema' },
      });
    }
    const invocation = await fastify.services.skillsService.invoke(tenantId, slug, parsed.data);
    if (!invocation) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `Skill "${slug}" not found or disabled` },
      });
    }
    logger.info('Skill invoked via API', { tenantId, slug });
    return reply.send({ success: true, data: invocation });
  });
}
