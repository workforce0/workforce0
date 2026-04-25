/**
 * Recall.ai webhook route. HMAC-validated via x-recall-signature header.
 *
 * @module routes/webhooks/meeting-bot-recall
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'RecallWebhook' });

export async function meetingBotRecallWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/recall', async (request: FastifyRequest, reply: FastifyReply) => {
    const services = (fastify as unknown as {
      services: {
        recallWebhookSecret: string | undefined;
        meetingService?: { handleBotEvent?: (e: unknown) => Promise<void> };
      };
    }).services;
    const secret = services.recallWebhookSecret;
    if (!secret) {
      return reply.status(503).send({
        success: false,
        error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'RECALL_WEBHOOK_SECRET is not set' },
      });
    }

    const sig = request.headers['x-recall-signature'];
    if (typeof sig !== 'string' || sig.length === 0) {
      return reply.status(401).send({ success: false, error: { code: 'MISSING_SIGNATURE' } });
    }

    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
    if (typeof rawBody !== 'string') {
      logger.error({}, 'Recall webhook: rawBody not captured (content-type parser not registered?)');
      return reply.status(500).send({ success: false, error: { code: 'RAW_BODY_MISSING' } });
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      logger.warn({ ip: request.ip }, 'Recall webhook signature mismatch');
      return reply.status(401).send({ success: false, error: { code: 'BAD_SIGNATURE' } });
    }

    try {
      if (services.meetingService?.handleBotEvent) {
        await services.meetingService.handleBotEvent(request.body);
      } else {
        logger.info(
          { event: (request.body as { event?: string })?.event },
          'Recall event received but no handler registered',
        );
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Recall event handler threw');
      return reply.status(500).send({ success: false, error: { code: 'HANDLER_ERROR' } });
    }

    return reply.status(200).send({ success: true });
  });
}
