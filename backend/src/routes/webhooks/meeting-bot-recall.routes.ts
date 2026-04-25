/**
 * Recall.ai webhook route.
 *
 * Recall.ai delivers webhooks via Svix, so the signature scheme follows Svix's
 * spec (https://docs.recall.ai/docs/webhooks):
 *   - Headers: `svix-id`, `svix-timestamp`, `svix-signature`
 *   - Signed payload: `${svix-id}.${svix-timestamp}.${rawBody}`
 *   - Secret: stored as `whsec_<base64>`. Decode the base64 portion, then
 *     HMAC-SHA256 the signed payload and base64-encode the result.
 *   - Header value: space-separated `v1,<base64sig>` entries — any one of
 *     them matching is sufficient (lets Recall rotate secrets safely).
 *
 * @module routes/webhooks/meeting-bot-recall
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'RecallWebhook' });

/**
 * Decode the secret portion of a Svix-style `whsec_<base64>` secret. Plain
 * (legacy) secrets are accepted as-is — useful for self-hosted operators
 * who configured a raw HMAC secret before Recall moved to Svix.
 */
function decodeWebhookSecret(secret: string): Buffer {
  if (secret.startsWith('whsec_')) {
    return Buffer.from(secret.slice('whsec_'.length), 'base64');
  }
  return Buffer.from(secret, 'utf8');
}

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

    const svixId = request.headers['svix-id'];
    const svixTimestamp = request.headers['svix-timestamp'];
    const svixSignature = request.headers['svix-signature'];
    if (
      typeof svixId !== 'string' ||
      typeof svixTimestamp !== 'string' ||
      typeof svixSignature !== 'string' ||
      svixId.length === 0 ||
      svixTimestamp.length === 0 ||
      svixSignature.length === 0
    ) {
      return reply.status(401).send({ success: false, error: { code: 'MISSING_SIGNATURE' } });
    }

    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
    if (typeof rawBody !== 'string') {
      logger.error({}, 'Recall webhook: rawBody not captured (content-type parser not registered?)');
      return reply.status(500).send({ success: false, error: { code: 'RAW_BODY_MISSING' } });
    }

    const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
    const secretBytes = decodeWebhookSecret(secret);
    const expected = crypto
      .createHmac('sha256', secretBytes)
      .update(signedPayload)
      .digest('base64');
    const expectedBuf = Buffer.from(expected, 'base64');

    // Svix sends one or more space-separated `v1,<base64sig>` pairs.
    const candidateSigs = svixSignature
      .split(' ')
      .map((entry) => entry.split(','))
      .filter((parts) => parts[0] === 'v1' && typeof parts[1] === 'string' && parts[1].length > 0)
      .map((parts) => parts[1] as string);

    const valid = candidateSigs.some((sig) => {
      let buf: Buffer;
      try {
        buf = Buffer.from(sig, 'base64');
      } catch {
        return false;
      }
      if (buf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(buf, expectedBuf);
    });

    if (!valid) {
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
