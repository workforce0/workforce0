/**
 * =============================================================================
 * INBOUND EMAIL REPLY WEBHOOK
 * =============================================================================
 *
 * Receives inbound-email payloads from an email provider (Mailgun routes,
 * Zapier Email Parser, Postmark inbound, or any service that can POST JSON)
 * and applies APPROVE/REJECT actions to a PRD based on the reply text.
 *
 * The payload contract is intentionally simple so you can wire any provider:
 *
 *   POST /webhooks/email/reply
 *   Header:  X-Workforce0-Secret: <EMAIL_WEBHOOK_SECRET>
 *   Body:    { "from": "you@company.com", "subject": "...", "text": "APPROVE abcdef012345" }
 *
 * Auth: shared secret via X-Workforce0-Secret header, timing-safe compared
 * against EMAIL_WEBHOOK_SECRET env var.
 *
 * Setup guide: (to be added at mvp/docs/email-reply-setup.md)
 *
 * @module routes/webhooks/email-reply
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../../lib/logger.js';
import { config } from '../../config/index.js';
import { parseEscalationIntent } from '../../services/escalation/escalation.service.js';

const logger = createChildLogger({ module: 'email-reply-webhook' });

const APPROVE_REGEX = /\bAPPROVE\s+([a-f0-9]{12})\b/i;
const REJECT_REGEX = /\bREJECT\s+([a-f0-9]{12})(?:\s+([^\n]+))?/i;

const InboundSchema = z.object({
  from: z.string().min(1),
  subject: z.string().optional(),
  text: z.string().min(1),
  messageId: z.string().optional(),
});

function secretsMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  try {
    return (
      provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}

export async function registerEmailReplyWebhook(app: FastifyInstance): Promise<void> {
  app.post('/email/reply', async (request: FastifyRequest, reply: FastifyReply) => {
    const expected = config.EMAIL_WEBHOOK_SECRET;
    if (!expected) {
      logger.warn('EMAIL_WEBHOOK_SECRET not configured; rejecting inbound');
      return reply.status(503).send({ error: 'not_configured' });
    }

    const provided = request.headers['x-workforce0-secret'] as string | undefined;
    if (!secretsMatch(provided, expected)) {
      logger.warn('Email reply webhook: bad shared secret');
      return reply.status(401).send({ error: 'invalid_signature' });
    }

    const parsed = InboundSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }

    const { from, text } = parsed.data;

    // M7.5: chief_of_staff escalation replies (RETRY / PAUSE / CANCEL) go first.
    const escalation = parseEscalationIntent(text);
    if (escalation && app.services.escalationService) {
      const result = await app.services.escalationService.apply(
        escalation.token,
        escalation.action,
      );
      logger.info('Email reply: escalation handled', {
        from,
        action: escalation.action,
        ok: result.ok,
        parentTicketId: result.parentTicketId,
      });
      return reply.status(200).send({
        ok: true,
        acted: result.ok,
        action: escalation.action,
        message: result.message,
      });
    }

    const approve = APPROVE_REGEX.exec(text);
    const reject = REJECT_REGEX.exec(text);

    if (!approve && !reject) {
      // Might be a greeting, autoresponder, or unrelated reply — ack quietly
      return reply.status(200).send({ ok: true, acted: false });
    }

    const token = (approve?.[1] ?? reject?.[1])!.toLowerCase();
    const action = approve ? 'approve' : 'reject';
    const reason = reject?.[2]?.trim();

    const result = await app.services.approvalFanoutService.applyReplyAction({
      token,
      action,
      reason,
      source: 'email',
      externalActorRef: from,
    });

    if (!result) {
      logger.info('Email reply with unknown/expired token', { token, action, from });
      return reply.status(200).send({ ok: true, acted: false });
    }

    logger.info('Email reply applied approval action', {
      prdId: result.prdId,
      action,
      from,
    });
    return reply.status(200).send({ ok: true, acted: true, prdId: result.prdId });
  });
}
