/**
 * =============================================================================
 * SSE (Server-Sent Events) Routes
 * =============================================================================
 *
 * Endpoints:
 * ----------
 * GET /api/events — SSE stream for real-time updates (requires auth)
 *
 * @module routes/sse
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createChildLogger } from '../lib/logger.js';
import { config } from '../config/index.js';

const logger = createChildLogger({ route: 'sse' });

export async function sseRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /events
   *
   * Opens an SSE connection for real-time updates.
   * The client receives events for their tenant: engagement changes,
   * notifications, agent status updates, etc.
   *
   * Note: reply.hijack() bypasses Fastify's response pipeline (including CORS plugin),
   * so we manually set CORS headers on the raw response before handing off to SSEService.
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;

    if (!tenantId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    logger.info('SSE client connecting', { tenantId });

    // Set CORS headers manually since reply.hijack() bypasses Fastify's CORS plugin
    const origin = request.headers.origin;
    const allowedOrigins = config.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) ?? [];
    if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes('*'))) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin);
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Prevent Fastify from ending the response — we'll manage it
    reply.hijack();

    // Register with SSE service
    fastify.services.sseService.addClient(tenantId, reply.raw);
  });
}
