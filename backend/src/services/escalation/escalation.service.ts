/**
 * =============================================================================
 * ESCALATION SERVICE (M7.5)
 * =============================================================================
 *
 * When ChiefOfStaffService gives up on a parent ticket (cap hit or
 * same-error-twice), it posts an escalation message to the user's
 * preferred channel: "Reply RETRY / PAUSE / CANCEL". Those replies come
 * back through the existing channel webhooks (WhatsApp, Slack, email,
 * GChat). This service is the glue:
 *
 *   - createToken(parentTicketId, tenantId) — mints a 12-hex token tied
 *     to the parent ticket and stores it in Redis with a TTL. The token
 *     is embedded in the escalation message so replies can resolve back
 *     to the right ticket without trusting sender identity alone.
 *
 *   - resolveToken(token) — looks up an active escalation token.
 *
 *   - apply(token, action) — drives the action:
 *       RETRY  → reset plan attempt to 1 and re-plan (chief_of_staff
 *                will pick a fresh strategy; replanReason carries prior
 *                error so the LLM steers around it).
 *       PAUSE  → mark parent ticket status='waiting'; plan stays
 *                superseded until the user follows up.
 *       CANCEL → mark parent ticket + plan status='cancelled'.
 *
 * Token storage follows the exact same TTL + Redis pattern as
 * ApprovalFanoutService so channel handlers can use the same
 * "12-hex substring" reply parser.
 *
 * @module services/escalation
 */

import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';
import type { ChiefOfStaffService } from '../chief-of-staff/chief-of-staff.service.js';

const logger = createChildLogger({ service: 'EscalationService' });

/** Keep tokens alive for 7 days — mirrors approval token TTL. */
const ESCALATION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ESCALATION_TOKEN_PREFIX = 'escalation:token:';

export type EscalationAction = 'retry' | 'pause' | 'cancel';

export interface EscalationToken {
  parentTicketId: string;
  tenantId: string;
  createdAt: string;
}

export class EscalationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly chiefOfStaff: ChiefOfStaffService,
  ) {}

  /**
   * Mint a fresh 12-hex token for an escalation. Idempotent within a
   * single parent ticket — if a live token already exists we reuse it
   * so consecutive escalations don't strand old tokens.
   */
  async createToken(parentTicketId: string, tenantId: string): Promise<string> {
    // Check if there's already a live token for this parent.
    const existing = await this.redis.get(`escalation:by-parent:${parentTicketId}`);
    if (existing) return existing;

    const token = randomBytes(6).toString('hex'); // 12 chars
    const payload: EscalationToken = {
      parentTicketId,
      tenantId,
      createdAt: new Date().toISOString(),
    };
    await this.redis.set(
      `${ESCALATION_TOKEN_PREFIX}${token}`,
      JSON.stringify(payload),
      'EX',
      ESCALATION_TOKEN_TTL_SECONDS,
    );
    // Reverse index so we can find the active token for a given parent.
    await this.redis.set(
      `escalation:by-parent:${parentTicketId}`,
      token,
      'EX',
      ESCALATION_TOKEN_TTL_SECONDS,
    );
    return token;
  }

  async resolveToken(token: string): Promise<EscalationToken | null> {
    const raw = await this.redis.get(`${ESCALATION_TOKEN_PREFIX}${token}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as EscalationToken;
    } catch {
      return null;
    }
  }

  /**
   * Apply an action to the parent ticket behind this token. Returns a
   * short status string suitable for channel replies so webhooks can
   * echo back what happened.
   */
  async apply(token: string, action: EscalationAction): Promise<{
    ok: boolean;
    message: string;
    parentTicketId?: string;
  }> {
    const entry = await this.resolveToken(token);
    if (!entry) {
      return { ok: false, message: "That token is expired or unknown. Nothing changed." };
    }

    const parent = await (this.prisma as any).ticket.findFirst({
      where: { id: entry.parentTicketId, tenantId: entry.tenantId },
    });
    if (!parent) {
      return {
        ok: false,
        message: "I can't find that ticket anymore. It may have been deleted.",
      };
    }

    try {
      if (action === 'retry') {
        await this.invalidate(entry.parentTicketId, token);
        await (this.prisma as any).executionPlan.updateMany({
          where: { parentTicketId: entry.parentTicketId, status: 'failed' },
          data: { status: 'superseded' },
        });
        const { planId } = await this.chiefOfStaff.planTicket({
          tenantId: entry.tenantId,
          parentTicket: parent,
          attempt: 1,
          replanReason: 'user requested retry after escalation',
        });
        logger.info('escalation.retry created new plan', {
          parentTicketId: entry.parentTicketId,
          planId,
        });
        return {
          ok: true,
          message: `Retrying "${parent.title}" with a fresh plan.`,
          parentTicketId: entry.parentTicketId,
        };
      }

      if (action === 'pause') {
        await (this.prisma as any).ticket.update({
          where: { id: entry.parentTicketId },
          data: { status: 'waiting' },
        });
        logger.info('escalation.pause → parent ticket paused', {
          parentTicketId: entry.parentTicketId,
        });
        return {
          ok: true,
          message: `Paused "${parent.title}". Reply RETRY ${token} or CANCEL ${token} when you're ready.`,
          parentTicketId: entry.parentTicketId,
        };
      }

      if (action === 'cancel') {
        await this.invalidate(entry.parentTicketId, token);
        await (this.prisma as any).ticket.update({
          where: { id: entry.parentTicketId },
          data: { status: 'cancelled' },
        });
        await (this.prisma as any).executionPlan.updateMany({
          where: { parentTicketId: entry.parentTicketId, status: { in: ['active', 'failed'] } },
          data: { status: 'superseded' },
        });
        logger.info('escalation.cancel → parent ticket cancelled', {
          parentTicketId: entry.parentTicketId,
        });
        return {
          ok: true,
          message: `Cancelled "${parent.title}". I'll drop it.`,
          parentTicketId: entry.parentTicketId,
        };
      }

      return { ok: false, message: `Unknown action: ${action}` };
    } catch (err) {
      logger.error('escalation.apply failed', {
        parentTicketId: entry.parentTicketId,
        action,
        error: (err as Error).message,
      });
      return {
        ok: false,
        message: "Something went wrong applying that. Check the audit log in a moment.",
      };
    }
  }

  private async invalidate(parentTicketId: string, token: string): Promise<void> {
    await this.redis.del(`${ESCALATION_TOKEN_PREFIX}${token}`);
    await this.redis.del(`escalation:by-parent:${parentTicketId}`);
  }
}

/**
 * Parse an inbound channel reply for an escalation decision.
 *
 * Recognises (case-insensitive):
 *   - RETRY <12-hex token>
 *   - PAUSE <12-hex token>
 *   - CANCEL <12-hex token>
 *
 * Returns null when no match — callers then fall through to approval
 * parsing. The 12-hex shape matches the approval token format so the
 * two flows coexist without colliding: approval keyed on APPROVE/REJECT,
 * escalation on RETRY/PAUSE/CANCEL.
 */
const RETRY_REGEX = /\bRETRY\s+([a-f0-9]{12})\b/i;
const PAUSE_REGEX = /\bPAUSE\s+([a-f0-9]{12})\b/i;
const CANCEL_REGEX = /\bCANCEL\s+([a-f0-9]{12})\b/i;

export function parseEscalationIntent(
  body: string,
): { action: EscalationAction; token: string } | null {
  const retry = body.match(RETRY_REGEX);
  if (retry) return { action: 'retry', token: retry[1]!.toLowerCase() };
  const pause = body.match(PAUSE_REGEX);
  if (pause) return { action: 'pause', token: pause[1]!.toLowerCase() };
  const cancel = body.match(CANCEL_REGEX);
  if (cancel) return { action: 'cancel', token: cancel[1]!.toLowerCase() };
  return null;
}
