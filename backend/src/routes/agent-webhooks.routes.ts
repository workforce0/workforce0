/**
 * AGENT WEBHOOKS ROUTES
 * =============================================================================
 *
 *   GET    /agent-webhooks            — list registrations for this tenant
 *   POST   /agent-webhooks            — register a webhook (shared secret
 *                                        returned in full, once)
 *   PATCH  /agent-webhooks/:id        — toggle isActive
 *   DELETE /agent-webhooks/:id        — remove
 *
 * Admin-only: webhooks are a surface for code execution on our side
 * (we're POST'ing to whatever URL the caller gives us). Non-admin users
 * shouldn't be able to quietly redirect agent traffic.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';
import { requireAdmin } from '../middleware/rbac.middleware.js';

const logger = createChildLogger({ route: 'agent-webhooks' });

const RegisterSchema = z.object({
  roleSlug: z.string().min(1).max(64),
  callbackUrl: z.string().url(),
  name: z.string().max(80).optional(),
  sharedSecret: z.string().min(16).max(128).optional(),
});

const PatchSchema = z.object({
  isActive: z.boolean(),
});

export async function agentWebhooksRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const hooks = await fastify.services.agentWebhookService.listForTenant(tenantId);
    return reply.send({ success: true, data: hooks });
  });

  fastify.post('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string | undefined;
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
      });
    }
    const hook = await fastify.services.agentWebhookService.register({
      tenantId,
      createdBy: userId,
      ...parsed.data,
    });
    logger.info('Agent webhook registered', { tenantId, id: hook.id, role: parsed.data.roleSlug });
    fastify.services.auditService.log({
      tenantId,
      userId,
      action: 'agent_webhook.register',
      resource: 'agent_webhook',
      resourceId: hook.id,
      after: { roleSlug: parsed.data.roleSlug, callbackUrl: parsed.data.callbackUrl },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return reply.status(201).send({ success: true, data: hook });
  });

  fastify.patch('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const parsed = PatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'isActive (boolean) required' },
      });
    }
    const hook = await fastify.services.agentWebhookService.setActive(tenantId, id, parsed.data.isActive);
    if (!hook) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    return reply.send({ success: true, data: hook });
  });

  fastify.delete('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const ok = await fastify.services.agentWebhookService.remove(tenantId, id);
    if (!ok) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    return reply.send({ success: true });
  });
}
