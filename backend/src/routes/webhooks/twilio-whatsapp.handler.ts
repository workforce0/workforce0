/**
 * =============================================================================
 * INBOUND TWILIO WHATSAPP WEBHOOK — reply-to-approve
 * =============================================================================
 *
 * Receives Twilio WhatsApp (and SMS — same shape) inbound messages and
 * applies APPROVE / REJECT to the PRD identified by the 12-char token the
 * outbound message included.
 *
 * Route:  POST /webhooks/twilio/whatsapp
 * Body:   application/x-www-form-urlencoded (Twilio default)
 *         Fields: From, To, Body, MessageSid, AccountSid, ...
 *
 * Auth:   X-Twilio-Signature header. Reject any request that doesn't match
 *         an HMAC-SHA1 of (request URL + sorted form params) using the
 *         configured TWILIO_AUTH_TOKEN. In dev without TWILIO_AUTH_TOKEN
 *         set we log loudly and skip (consistent with twilio.routes.ts).
 *
 * Intents recognised (case-insensitive):
 *   - APPROVE <token>     approve the PRD
 *   - A <token>           same
 *   - REJECT <token>      reject
 *   - R <token> reason?   same, optional trailing reason
 *   - anything else       reply with help text, do nothing
 *
 * Every response is TwiML so Twilio delivers a WhatsApp reply back to the
 * sender confirming what happened (or explaining what did not).
 *
 * Setup guide: backend/docs/whatsapp-approvals-setup.md
 *
 * @module routes/webhooks/twilio-whatsapp
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import { config } from '../../config/index.js';
import { createChildLogger } from '../../lib/logger.js';
import { parseEscalationIntent } from '../../services/escalation/escalation.service.js';
// AgentDispatcherService is resolved through the Fastify services container; no direct import needed.

const logger = createChildLogger({ module: 'twilio-whatsapp-webhook' });

/** APPROVE / A / REJECT / R followed by a 12-hex token; reason optional on reject. */
const APPROVE_REGEX = /\b(?:APPROVE|A)\s+([a-f0-9]{12})\b/i;
const REJECT_REGEX = /\b(?:REJECT|R)\s+([a-f0-9]{12})(?:\s+(.+))?$/i;

/** Reply TwiML helper. Escapes the message body so Twilio renders it literally. */
function twiml(message: string): string {
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

/** Verify Twilio's webhook signature. Same logic as twilio.routes.ts but
 *  inlined here so the webhook doesn't depend on the voice module. */
function verifyTwilioSignature(request: FastifyRequest, reply: FastifyReply): boolean {
  const authToken = config.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    if (config.NODE_ENV === 'production') {
      logger.error('TWILIO_AUTH_TOKEN missing in production — rejecting');
      reply.status(500).send({ error: 'signature_verification_not_configured' });
      return false;
    }
    logger.warn('TWILIO_AUTH_TOKEN missing — signature verification skipped (non-prod only)');
    return true;
  }

  const signature = request.headers['x-twilio-signature'];
  if (typeof signature !== 'string' || !signature) {
    logger.warn('Missing X-Twilio-Signature header');
    reply.status(401).send({ error: 'missing_signature' });
    return false;
  }

  const protocol = request.headers['x-forwarded-proto'] || 'https';
  const host = request.headers['host'] || 'localhost';
  const url = `${protocol}://${host}${request.url}`;
  const params = (request.body as Record<string, unknown>) || {};

  const ok = twilio.validateRequest(authToken, signature, url, params);
  if (!ok) {
    logger.warn('Invalid Twilio signature', { url });
    reply.status(401).send({ error: 'invalid_signature' });
    return false;
  }
  return true;
}

interface TwilioInboundBody {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
  [key: string]: unknown;
}

/**
 * Strip the whatsapp: prefix so we can log a plain phone number.
 * Returns the original string if it did not have one.
 */
function normalizeSender(from: string | undefined): string {
  if (!from) return 'unknown';
  return from.replace(/^whatsapp:/i, '');
}

/**
 * Classify the inbound message into an action + token + optional reason.
 * Returns null when the message is not an approval action (e.g. "hi",
 * "thanks", or a bare "approve" without a token).
 */
export function parseApprovalIntent(body: string):
  | { action: 'approve' | 'reject'; token: string; reason?: string }
  | null {
  const approve = APPROVE_REGEX.exec(body);
  if (approve) {
    return { action: 'approve', token: approve[1]!.toLowerCase() };
  }
  const reject = REJECT_REGEX.exec(body);
  if (reject) {
    return {
      action: 'reject',
      token: reject[1]!.toLowerCase(),
      reason: reject[2]?.trim() || undefined,
    };
  }
  return null;
}

/**
 * Given a Twilio sender (normalised E.164 phone number), resolve which
 * tenant they belong to by matching the number against TeamMember
 * channelIds. Returns null when no unambiguous match exists — the handler
 * falls back to generic help text in that case rather than leaking data
 * across tenants.
 */
async function resolveTenantForSender(
  app: FastifyInstance,
  sender: string,
): Promise<string | null> {
  const prisma = app.services.prisma as { teamMember: { findFirst: (args: unknown) => Promise<{ tenantId: string } | null> } } | undefined;
  if (!prisma) return null;
  try {
    // TeamMember stores channelIds as a JSON map (e.g. { whatsapp: "+1…", sms: "+1…" }).
    // A raw Prisma $queryRaw would be safest but we rely on the simpler
    // "findFirst with JSON path" which Postgres supports via Prisma's
    // JSON filter. For dev + small tenants the table is small enough that
    // a full scan is fine.
    const match = await prisma.teamMember.findFirst({
      where: {
        isActive: true,
        OR: [
          { channelIds: { path: ['whatsapp'], equals: sender } },
          { channelIds: { path: ['sms'], equals: sender } },
        ],
      },
      select: { tenantId: true },
    });
    return match?.tenantId ?? null;
  } catch (err) {
    logger.warn('tenant resolution failed for sender', { sender, err: (err as Error).message });
    return null;
  }
}

export async function registerTwilioWhatsAppWebhook(app: FastifyInstance): Promise<void> {
  app.post(
    '/twilio/whatsapp',
    async (request: FastifyRequest<{ Body: TwilioInboundBody }>, reply: FastifyReply) => {
      if (!verifyTwilioSignature(request, reply)) return;

      const { From, Body } = (request.body ?? {}) as TwilioInboundBody;
      const sender = normalizeSender(From);
      const messageBody = (Body ?? '').toString().trim();

      if (!messageBody) {
        reply.type('text/xml');
        return reply.send(twiml('Workforce0 here. Reply APPROVE <token> or REJECT <token> to act on a brief.'));
      }

      // M7.5: escalation replies (RETRY / PAUSE / CANCEL) take precedence.
      // Same 12-hex token shape as approvals but different verbs — no
      // collision. If parseEscalationIntent matches, run the action
      // against EscalationService and reply directly.
      const escalation = parseEscalationIntent(messageBody);
      if (escalation && app.services.escalationService) {
        const result = await app.services.escalationService.apply(
          escalation.token,
          escalation.action,
        );
        logger.info('WhatsApp inbound: escalation reply', {
          sender,
          action: escalation.action,
          ok: result.ok,
          parentTicketId: result.parentTicketId,
        });
        reply.type('text/xml');
        return reply.send(twiml(result.message));
      }

      const intent = parseApprovalIntent(messageBody);

      if (!intent) {
        // No approval token — route through the conversation orchestrator
        // (tier 3b). It records the turn, applies guardrails, and either
        // runs an LLM-backed reply or falls back to the tier-1 dispatcher.
        const orchestrator = app.services.conversationOrchestratorService;
        if (orchestrator) {
          const tenantId = await resolveTenantForSender(app, sender);
          if (tenantId) {
            const dispatched = await orchestrator.dispatchFromInbound({
              tenantId,
              channel: 'whatsapp',
              channelRef: sender,
              speaker: `external:${sender}`,
              text: messageBody,
            });
            if (dispatched.handled && dispatched.agent) {
              const { ConversationOrchestratorService } = await import(
                '../../services/conversation/conversation-orchestrator.service.js'
              );
              const formatted = ConversationOrchestratorService.formatForChannel(
                dispatched.agent,
                dispatched.reply,
                'whatsapp',
              );
              logger.info('WhatsApp inbound: agent reply sent', {
                sender,
                agent: dispatched.agent,
                handoffs: dispatched.handoffs,
              });
              reply.type('text/xml');
              return reply.send(twiml(formatted.text));
            } else if (!dispatched.handled && dispatched.reason) {
              logger.info('WhatsApp orchestrator blocked dispatch', {
                sender,
                reason: dispatched.reason,
              });
            }
          }
        }

        // Unrecognised — emit a gentle help message. Do NOT echo the body
        // back verbatim (spam risk on group chats that forwarded the link).
        logger.info('WhatsApp inbound: no approval intent', {
          sender,
          bodyLen: messageBody.length,
        });
        reply.type('text/xml');
        return reply.send(
          twiml(
            'Workforce0 did not recognise that. Reply APPROVE <token> / REJECT <token> ' +
              'to act on a brief, or @help to list the ask-an-agent commands.',
          ),
        );
      }

      const result = await app.services.approvalFanoutService.applyReplyAction({
        token: intent.token,
        action: intent.action,
        reason: intent.reason,
        source: 'whatsapp',
        externalActorRef: sender,
      });

      reply.type('text/xml');
      if (!result) {
        logger.info('WhatsApp inbound: unknown or expired token', {
          sender,
          action: intent.action,
          token: intent.token,
        });
        return reply.send(
          twiml(
            'That approval code was not recognised (or it already expired). ' +
              'Check the most recent Workforce0 message for a current code.',
          ),
        );
      }

      logger.info('WhatsApp inbound: approval action applied', {
        prdId: result.prdId,
        action: intent.action,
        sender,
      });

      const confirmMsg =
        intent.action === 'approve'
          ? 'Approved. Workforce0 is creating tickets now — you will get a link when they are ready.'
          : 'Sent back for revision. The AI will regenerate and ping you again.';
      return reply.send(twiml(confirmMsg));
    },
  );
}
