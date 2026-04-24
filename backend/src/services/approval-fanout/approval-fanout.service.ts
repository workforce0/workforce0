/**
 * =============================================================================
 * APPROVAL FAN-OUT SERVICE — reach approvers on THEIR channel
 * =============================================================================
 *
 * When a PRD needs human review, this service finds the approvers
 * (founders + admins by default) and DMs each one through their preferred
 * channel (Slack, email, WhatsApp, Teams, SMS) with a deep link back to
 * the approval page — plus a short action token so the recipient can just
 * reply `APPROVE <token>` or `REJECT <token>` to decide without touching
 * the web UI.
 *
 * The token→PRD mapping is stored in Redis with a 7-day TTL; webhook
 * handlers in mvp/src/routes/webhooks/ look tokens up here and call the
 * internal approve/reject paths.
 *
 * @module services/approval-fanout
 */

import crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';
import type { CommunicationRouter } from '../communication/router.js';

const APPROVAL_TOKEN_PREFIX = 'approval-token:';
const APPROVAL_TOKEN_TTL = 60 * 60 * 24 * 7; // 7 days

export interface ApprovalToken {
  prdId: string;
  tenantId: string;
  createdAt: number;
}

export interface FanoutResult {
  notified: number;
  skipped: number;
  token: string;
}

export class ApprovalFanoutService {
  private readonly logger = createChildLogger({ service: 'ApprovalFanoutService' });

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly router: CommunicationRouter,
    private readonly publicUrl: string,
  ) {}

  /**
   * Fan out an approval request for a PRD.
   *
   * Resolves approvers (all active `founder` + `admin` team members for
   * the tenant by default), stores a token mapping, and sends a message
   * to each via their preferred channel. Idempotent — you can call this
   * multiple times and the same token will be reused on the same day.
   */
  async notify(prdId: string): Promise<FanoutResult> {
    const prd = await this.prisma.pRD.findUnique({
      where: { id: prdId },
      select: { id: true, tenantId: true, title: true, summary: true },
    });

    if (!prd) {
      this.logger.warn('PRD not found for fanout', { prdId });
      return { notified: 0, skipped: 0, token: '' };
    }

    const approvers = await this.prisma.teamMember.findMany({
      where: {
        tenantId: prd.tenantId,
        isActive: true,
        role: { in: ['founder', 'admin', 'cto', 'pm'] },
      },
    });

    if (approvers.length === 0) {
      this.logger.info('No approvers configured — skipping fanout', { prdId, tenantId: prd.tenantId });
      return { notified: 0, skipped: 0, token: '' };
    }

    const token = await this.getOrCreateToken(prd.id, prd.tenantId);
    const approvalUrl = `${this.publicUrl}/approvals?prd=${prd.id}`;

    const content = [
      `Workforce0 has a new brief ready for your review.`,
      ``,
      `Title: ${prd.title}`,
      prd.summary ? `Summary: ${prd.summary.slice(0, 280)}${prd.summary.length > 280 ? '…' : ''}` : '',
      ``,
      `Open to review: ${approvalUrl}`,
      ``,
      `Or reply:`,
      `  APPROVE ${token}`,
      `  REJECT ${token} [optional reason]`,
    ]
      .filter(Boolean)
      .join('\n');

    let notified = 0;
    let skipped = 0;

    for (const approver of approvers) {
      try {
        const result = await this.router.send({
          tenantId: prd.tenantId,
          recipientId: approver.id,
          recipientRole: approver.role,
          messageType: 'approval_request',
          content,
          metadata: { prdId: prd.id, approvalToken: token, approvalUrl },
        });
        if (result.success) {
          notified += 1;
        } else {
          skipped += 1;
          this.logger.warn('Approver delivery failed', {
            prdId,
            approverId: approver.id,
            error: result.error,
          });
        }
      } catch (err) {
        skipped += 1;
        this.logger.error('Approver fanout threw', {
          prdId,
          approverId: approver.id,
          error: (err as Error).message,
        });
      }
    }

    this.logger.info('Approval fanout complete', { prdId, notified, skipped });
    return { notified, skipped, token };
  }

  /**
   * Resolve a reply-ingested action token to its PRD.
   * Used by Slack and email reply webhook handlers.
   */
  async resolveToken(token: string): Promise<ApprovalToken | null> {
    const raw = await this.redis.get(`${APPROVAL_TOKEN_PREFIX}${token}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ApprovalToken;
    } catch {
      return null;
    }
  }

  /**
   * Invalidate a token after it's been acted on (approved or rejected).
   */
  async consumeToken(token: string): Promise<void> {
    await this.redis.del(`${APPROVAL_TOKEN_PREFIX}${token}`);
  }

  /**
   * Apply an approval decision that arrived via a reply channel (Slack DM
   * reply, email reply, etc.). Resolves the token, updates the PRD,
   * writes an audit log, and invalidates the token.
   *
   * `source` identifies where the reply came from (e.g. "slack", "email").
   * `externalActorRef` is a human-readable identifier of the acting
   * recipient (Slack user ID, email address) — stored in audit log.
   *
   * Returns the updated PRD summary or null if the token was invalid.
   */
  async applyReplyAction(params: {
    token: string;
    action: 'approve' | 'reject';
    reason?: string;
    source: string;
    externalActorRef?: string;
  }): Promise<{ prdId: string; tenantId: string } | null> {
    const resolved = await this.resolveToken(params.token);
    if (!resolved) return null;

    const { prdId, tenantId } = resolved;

    const prd = await this.prisma.pRD.findUnique({
      where: { id: prdId },
      select: { id: true, tenantId: true, status: true },
    });
    if (!prd || prd.tenantId !== tenantId) return null;
    if (prd.status !== 'draft' && prd.status !== 'pending_approval' && prd.status !== 'review') {
      // Already decided — consume the token so the reply channel gets a
      // clean "already acted on" confirmation upstream.
      await this.consumeToken(params.token);
      return { prdId, tenantId };
    }

    const nextStatus = params.action === 'approve' ? 'approved' : 'rejected';
    await this.prisma.pRD.update({
      where: { id: prdId },
      data: { status: nextStatus },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: null,
        action: `prd.${params.action}.${params.source}`,
        resource: 'prd',
        resourceId: prdId,
        after: {
          reason: params.reason ?? null,
          source: params.source,
          externalActorRef: params.externalActorRef ?? null,
        },
      },
    });

    await this.consumeToken(params.token);

    this.logger.info('Reply action applied', {
      prdId,
      action: params.action,
      source: params.source,
    });
    return { prdId, tenantId };
  }

  private async getOrCreateToken(prdId: string, tenantId: string): Promise<string> {
    // Reuse any existing token for this PRD so the same DM can be retried
    const existingMapKey = `approval-prd:${prdId}`;
    const existing = await this.redis.get(existingMapKey);
    if (existing) return existing;

    const token = crypto.randomBytes(6).toString('hex'); // 12 chars, easy to type
    const payload: ApprovalToken = { prdId, tenantId, createdAt: Date.now() };
    await Promise.all([
      this.redis.setex(`${APPROVAL_TOKEN_PREFIX}${token}`, APPROVAL_TOKEN_TTL, JSON.stringify(payload)),
      this.redis.setex(existingMapKey, APPROVAL_TOKEN_TTL, token),
    ]);
    return token;
  }
}
