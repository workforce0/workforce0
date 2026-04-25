/**
 * Unified integration wizard routes.
 *
 * The in-app Stitch-designed wizards (see docs/stitch-prompts/05-integration-wizard.md)
 * talk to these endpoints — one URL pattern for every integration:
 *
 *   GET    /api/integrations                  — list all connections + status
 *   POST   /api/integrations/:name/connect    — paste credentials, save encrypted
 *   POST   /api/integrations/:name/test       — validate credentials
 *   DELETE /api/integrations/:name            — disconnect
 *   GET    /api/integrations/:name            — get status + safe metadata
 *
 * Credentials are encrypted at rest via AES-256-GCM (lib/encryption.ts).
 * The `credentials` blob is NEVER returned from these endpoints — only safe
 * metadata (connected email, default project) and status flags.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'integrations' });

const VALID_NAMES = [
  'jira',
  'slack',
  'github',
  'linear',
  'notion',
  'gchat',
  'gdocs',
  'gdrive',
  'twilio',
] as const;

type IntegrationName = (typeof VALID_NAMES)[number];

function isValidName(name: string): name is IntegrationName {
  return (VALID_NAMES as readonly string[]).includes(name);
}

export async function integrationRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/integrations — list all connections (status, metadata, no credentials)
   */
  fastify.get('/', async (request, reply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const service = fastify.services.integrationConnectionService;
    const connections = await service.listAll(tenantId);
    return reply.send({ success: true, data: connections });
  });

  /**
   * GET /api/integrations/:name — one connection's public state
   */
  fastify.get('/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!isValidName(name)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'UNKNOWN_INTEGRATION', message: `Unknown integration: ${name}` },
      });
    }
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const connection = await fastify.services.integrationConnectionService.get(tenantId, name);
    return reply.send({
      success: true,
      data: connection ?? { name, status: 'disconnected', metadata: {}, lastTestedAt: null, lastError: null, connectedBy: null, updatedAt: null },
    });
  });

  /**
   * POST /api/integrations/:name/connect — paste credentials, test, save
   *
   * Body accepts an arbitrary `credentials` object (shape depends on the
   * integration — e.g. Jira wants `{ baseUrl, email, apiToken }`). Optional
   * `metadata` is merged into the public state (safe to show in UI).
   */
  fastify.post('/:name/connect', async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!isValidName(name)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'UNKNOWN_INTEGRATION', message: `Unknown integration: ${name}` },
      });
    }

    const schema = z.object({
      credentials: z.record(z.string(), z.unknown()),
      metadata: z.record(z.string(), z.unknown()).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'Expected { credentials: {...}, metadata?: {...} }' },
      });
    }

    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const userId = (request as FastifyRequest & { userId?: string }).userId;
    const service = fastify.services.integrationConnectionService;

    // Test first — don't save credentials that don't work
    const testResult = await service.testConnection(tenantId, name, parsed.data.credentials);
    if (!testResult.ok) {
      return reply.status(400).send({
        success: false,
        error: { code: 'CONNECTION_TEST_FAILED', message: testResult.error ?? 'Connection test failed' },
      });
    }

    const connection = await service.connect({
      tenantId,
      name,
      credentials: parsed.data.credentials,
      metadata: { ...(parsed.data.metadata ?? {}), ...(testResult.metadata ?? {}) },
      connectedBy: userId,
    });

    logger.info('Integration connected via wizard', { tenantId, name, userId });
    return reply.send({ success: true, data: connection });
  });

  /**
   * POST /api/integrations/:name/test — re-run the connection test for an
   * existing saved connection (e.g. after a token rotation).
   */
  fastify.post('/:name/test', async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!isValidName(name)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'UNKNOWN_INTEGRATION', message: `Unknown integration: ${name}` },
      });
    }
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const result = await fastify.services.integrationConnectionService.testConnection(tenantId, name);
    return reply.send({ success: result.ok, data: result });
  });

  /**
   * DELETE /api/integrations/:name — forget credentials (irreversible).
   */
  fastify.delete('/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!isValidName(name)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'UNKNOWN_INTEGRATION', message: `Unknown integration: ${name}` },
      });
    }
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    await fastify.services.integrationConnectionService.disconnect(tenantId, name);
    return reply.send({ success: true });
  });
}
