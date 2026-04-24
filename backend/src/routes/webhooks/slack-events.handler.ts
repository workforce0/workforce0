/**
 * =============================================================================
 * SLACK EVENTS WEBHOOK
 * =============================================================================
 *
 * Receives Slack Events API payloads (https://api.slack.com/apis/events-api).
 * Two things it handles:
 *
 *   1. URL verification challenge when the operator first configures the
 *      Slack app (Slack pings with {type: "url_verification", challenge}).
 *   2. Message events that contain an APPROVE/REJECT token. When an
 *      approver replies `APPROVE abc123def456` to a Workforce0 DM, this
 *      endpoint resolves the token and updates the PRD.
 *
 * Security: verifies the X-Slack-Signature HMAC using SLACK_SIGNING_SECRET.
 * Replays older than 5 minutes are rejected.
 *
 * Setup guide: mvp/docs/slack-setup.md
 *
 * @module routes/webhooks/slack-events
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createChildLogger } from '../../lib/logger.js';
import { config } from '../../config/index.js';
import { parseEscalationIntent } from '../../services/escalation/escalation.service.js';

const logger = createChildLogger({ module: 'slack-webhook' });

const APPROVE_REGEX = /\bAPPROVE\s+([a-f0-9]{12})\b/i;
const REJECT_REGEX = /\bREJECT\s+([a-f0-9]{12})(?:\s+(.+))?/i;

interface SlackUrlVerification {
  type: 'url_verification';
  challenge: string;
}

interface SlackEventCallback {
  type: 'event_callback';
  team_id?: string;
  event?: {
    type: string;
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
  };
}

type SlackEnvelope = SlackUrlVerification | SlackEventCallback;

function verifySignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string,
): boolean {
  if (!timestamp || !signature) return false;

  // Reject replays older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(base);
  const expected = `v0=${hmac.digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function registerSlackEventsWebhook(app: FastifyInstance): Promise<void> {
  app.post(
    '/slack/events',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signingSecret = config.SLACK_SIGNING_SECRET;
      if (!signingSecret) {
        logger.warn('Slack signing secret not configured; rejecting webhook');
        return reply.status(503).send({ error: 'slack_not_configured' });
      }

      const timestamp = request.headers['x-slack-request-timestamp'] as string | undefined;
      const signature = request.headers['x-slack-signature'] as string | undefined;
      const rawBody =
        (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(request.body);

      if (!timestamp || !signature || !verifySignature(signingSecret, rawBody, timestamp, signature)) {
        logger.warn('Slack signature mismatch');
        return reply.status(401).send({ error: 'invalid_signature' });
      }

      const envelope = request.body as SlackEnvelope;

      if (envelope.type === 'url_verification') {
        return reply.send({ challenge: envelope.challenge });
      }

      if (envelope.type === 'event_callback' && envelope.event) {
        const ev = envelope.event;

        // Ignore bot echoes
        if (ev.bot_id) return reply.status(200).send({ ok: true });
        if (ev.type !== 'message' || !ev.text) return reply.status(200).send({ ok: true });

        // 0) M7.5: chief_of_staff escalation replies (RETRY / PAUSE / CANCEL)
        // — checked before approvals. Same 12-hex token shape, different
        // verbs, so the two flows don't collide.
        const escalation = parseEscalationIntent(ev.text);
        if (escalation && app.services.escalationService) {
          const result = await app.services.escalationService.apply(
            escalation.token,
            escalation.action,
          );
          logger.info('Slack reply: escalation handled', {
            slackUser: ev.user,
            action: escalation.action,
            ok: result.ok,
            parentTicketId: result.parentTicketId,
          });
          // Post the status back to the same channel/thread so the user sees
          // what happened without opening the web UI.
          if (ev.channel) {
            await postSlackReply({
              channel: ev.channel,
              text: result.message,
              threadTs: ev.thread_ts ?? ev.ts,
              username: 'Workforce0',
            });
          }
          return reply.status(200).send({ ok: true });
        }

        // 1) Approval-token path — highest priority so existing reply-to-approve keeps working.
        const approveMatch = ev.text.match(APPROVE_REGEX);
        const rejectMatch = ev.text.match(REJECT_REGEX);

        if (approveMatch || rejectMatch) {
          const token = (approveMatch?.[1] ?? rejectMatch?.[1])!.toLowerCase();
          const action = approveMatch ? 'approve' : 'reject';
          const reason = rejectMatch?.[2]?.trim();

          const result = await app.services.approvalFanoutService.applyReplyAction({
            token,
            action,
            reason,
            source: 'slack',
            externalActorRef: ev.user,
          });

          if (!result) {
            logger.info('Slack reply with unknown/expired token', { token, action });
          } else {
            logger.info('Slack reply applied approval action', {
              prdId: result.prdId,
              action,
              slackUser: ev.user,
            });
          }
          return reply.status(200).send({ ok: true });
        }

        // 2) Agent-dispatch path. Tier 3b: route through the conversation
        // orchestrator so every message is recorded, runaway-loop + rate
        // limits are enforced, and agents can hand off to each other. The
        // orchestrator falls back to the plain dispatcher when Gemini is
        // not configured, so tier-1/2 behaviour is preserved.
        const orchestrator = app.services.conversationOrchestratorService;
        if (orchestrator && ev.text.includes('@')) {
          const tenantId = await resolveTenantForSlackUser(app, ev.user);
          if (!tenantId) {
            logger.info('Slack mention from unknown user — ignoring', { slackUser: ev.user });
            return reply.status(200).send({ ok: true });
          }
          const dispatched = await orchestrator.dispatchFromInbound({
            tenantId,
            channel: 'slack',
            channelRef: ev.channel ?? 'unknown',
            speaker: `human:${ev.user ?? 'unknown'}`,
            text: ev.text,
          });
          if (dispatched.handled && ev.channel && dispatched.agent) {
            const formatted = (
              await import('../../services/conversation/conversation-orchestrator.service.js')
            ).ConversationOrchestratorService.formatForChannel(
              dispatched.agent,
              dispatched.reply,
              'slack',
            );
            await postSlackReply({
              channel: ev.channel,
              text: formatted.text,
              threadTs: ev.thread_ts ?? ev.ts,
              username: formatted.username,
              iconEmoji: formatted.iconEmoji,
            });
            logger.info('Slack agent reply posted', {
              agent: dispatched.agent,
              channel: ev.channel,
              handoffs: dispatched.handoffs,
            });
          } else if (!dispatched.handled && dispatched.reason) {
            logger.info('Slack orchestrator blocked dispatch', {
              channel: ev.channel,
              reason: dispatched.reason,
            });
          }
        }
      }

      return reply.status(200).send({ ok: true });
    },
  );
}

/** Look up tenant by the Slack user who sent the message. Mirrors
 *  the WhatsApp handler's TeamMember.channelIds.slack match. */
async function resolveTenantForSlackUser(
  app: FastifyInstance,
  slackUserId: string | undefined,
): Promise<string | null> {
  if (!slackUserId) return null;
  const prisma = app.services.prisma as {
    teamMember: { findFirst: (args: unknown) => Promise<{ tenantId: string } | null> };
  };
  try {
    const match = await prisma.teamMember.findFirst({
      where: {
        isActive: true,
        channelIds: { path: ['slack'], equals: slackUserId },
      },
      select: { tenantId: true },
    });
    return match?.tenantId ?? null;
  } catch (err) {
    logger.warn('slack tenant resolution failed', {
      slackUser: slackUserId,
      err: (err as Error).message,
    });
    return null;
  }
}

/** Post a threaded reply to the same channel the event came from. Accepts
 *  optional per-message persona (username + iconEmoji) so different agents
 *  appear as distinct speakers in the channel. */
async function postSlackReply(params: {
  channel: string;
  text: string;
  threadTs?: string;
  username?: string;
  iconEmoji?: string;
}): Promise<void> {
  const botToken = config.SLACK_BOT_TOKEN;
  if (!botToken) {
    logger.warn('Slack bot token missing — cannot post reply');
    return;
  }
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: params.channel,
        text: params.text,
        ...(params.threadTs ? { thread_ts: params.threadTs } : {}),
        ...(params.username ? { username: params.username } : {}),
        ...(params.iconEmoji ? { icon_emoji: params.iconEmoji } : {}),
      }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      logger.warn('Slack chat.postMessage failed', { error: data.error });
    }
  } catch (err) {
    logger.warn('Slack postSlackReply threw', { err: (err as Error).message });
  }
}
