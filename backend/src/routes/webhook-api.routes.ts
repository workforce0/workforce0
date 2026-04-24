/**
 * =============================================================================
 * WEBHOOK API ROUTES (Outgoing Webhooks Management)
 * =============================================================================
 *
 * CRUD endpoints for tenants to register and manage outgoing webhook endpoints.
 * These are NOT the incoming webhook handlers (see webhooks.routes.ts for those).
 *
 * Routes:
 *   GET    /webhooks          → List all endpoints
 *   POST   /webhooks          → Create an endpoint
 *   GET    /webhooks/:id      → Get endpoint details + recent deliveries
 *   PUT    /webhooks/:id      → Update an endpoint
 *   DELETE /webhooks/:id      → Delete an endpoint
 *   GET    /webhooks/:id/secret → Reveal signing secret
 *   POST   /webhooks/:id/test → Send a test event
 *
 * @module routes/webhook-api
 */

import { FastifyInstance } from 'fastify';
import { WEBHOOK_EVENTS, WebhookService } from '../services/webhook/webhook.service.js';

export async function webhookApiRoutes(fastify: FastifyInstance) {
  const webhookService = fastify.services.webhookService as WebhookService;

  // ─── List endpoints ────────────────────────────────────────────────────────

  fastify.get('/', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const endpoints = await webhookService.list(tenantId);
    return reply.send({ success: true, data: endpoints });
  });

  // ─── Create endpoint ──────────────────────────────────────────────────────

  fastify.post('/', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const body = request.body as { url: string; events: string[]; description?: string };

    if (!body.url || !body.events?.length) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'url and events are required' },
      });
    }

    // Validate URL format
    try {
      new URL(body.url);
    } catch {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid URL format' },
      });
    }

    // Validate event types
    const invalidEvents = body.events.filter(e => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (invalidEvents.length > 0) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid event types: ${invalidEvents.join(', ')}. Valid events: ${WEBHOOK_EVENTS.join(', ')}`,
        },
      });
    }

    const endpoint = await webhookService.create(tenantId, body);
    // Also return the secret on creation (only time it's shown automatically)
    const secret = await webhookService.getSecret(tenantId, endpoint.id);

    return reply.status(201).send({
      success: true,
      data: { ...endpoint, secret },
    });
  });

  // ─── Get endpoint details ─────────────────────────────────────────────────

  fastify.get('/:id', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };

    const endpoint = await webhookService.get(tenantId, id);
    if (!endpoint) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Webhook endpoint not found' },
      });
    }

    return reply.send({ success: true, data: endpoint });
  });

  // ─── Update endpoint ──────────────────────────────────────────────────────

  fastify.put('/:id', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const body = request.body as { url?: string; events?: string[]; active?: boolean; description?: string };

    if (body.url) {
      try { new URL(body.url); } catch {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid URL format' },
        });
      }
    }

    if (body.events) {
      const invalidEvents = body.events.filter(e => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
      if (invalidEvents.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid event types: ${invalidEvents.join(', ')}` },
        });
      }
    }

    const updated = await webhookService.update(tenantId, id, body);
    if (!updated) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Webhook endpoint not found' },
      });
    }

    return reply.send({ success: true, data: updated });
  });

  // ─── Delete endpoint ──────────────────────────────────────────────────────

  fastify.delete('/:id', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };

    const deleted = await webhookService.delete(tenantId, id);
    if (!deleted) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Webhook endpoint not found' },
      });
    }

    return reply.send({ success: true, data: { deleted: true } });
  });

  // ─── Reveal secret ────────────────────────────────────────────────────────

  fastify.get('/:id/secret', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };

    const secret = await webhookService.getSecret(tenantId, id);
    if (!secret) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Webhook endpoint not found' },
      });
    }

    return reply.send({ success: true, data: { secret } });
  });

  // ─── Send test event ──────────────────────────────────────────────────────

  fastify.post('/:id/test', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };

    const endpoint = await webhookService.get(tenantId, id);
    if (!endpoint) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Webhook endpoint not found' },
      });
    }

    // Deliver a test event
    await webhookService.deliver(tenantId, 'meeting.completed', {
      test: true,
      message: 'This is a test webhook delivery from Workforce0',
      endpointId: id,
    });

    return reply.send({ success: true, data: { sent: true } });
  });

  // ─── List available event types ────────────────────────────────────────────

  fastify.get('/events', async (_request, reply) => {
    return reply.send({ success: true, data: WEBHOOK_EVENTS });
  });
}
