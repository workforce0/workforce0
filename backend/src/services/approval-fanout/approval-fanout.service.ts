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
    /**
     * Optional dispatch hooks. When wired (DI passes them in), an
     * `applyReplyAction` that approves a PRD also kicks off the same
     * engagement-advance + dev-job-dispatch chain that the web-UI
     * approve route runs. Without these, replying APPROVE on
     * WhatsApp/Slack flips the PRD status but does nothing else, so the
     * exec sees "Approved" but no PR is ever opened. See task #192.
     */
    private readonly engagementService?: {
      advancePhase: (
        tenantId: string,
        engagementId: string,
        input: { confidence: number; targetPhase: string; output: Record<string, unknown> },
      ) => Promise<unknown>;
    },
    private readonly ticketService?: {
      createAsNewWork: (input: {
        tenantId: string;
        roleSlug: string;
        title: string;
        agentTaskInput: Record<string, unknown>;
        payload: Record<string, unknown>;
      }) => Promise<{ agentTaskId: string; ticket: { id: string } }>;
    },
    private readonly queueService?: {
      addJob: (jobType: string, data: Record<string, unknown>) => Promise<unknown>;
    },
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

    // Mirror the route handler: when approving via reply, also walk the
    // engagement to `build` and dispatch the dev job. Without this the
    // exec sees "Approved" in WhatsApp/Slack but the daemon never gets
    // a job. See task #192.
    if (params.action === 'approve') {
      try {
        await this.dispatchAfterApproval(prdId, tenantId);
      } catch (err) {
        // Non-fatal — the PRD is already marked approved; the exec can
        // re-trigger from the web UI if dispatch fails.
        this.logger.error(
          { prdId, error: (err as Error).message, stack: (err as Error).stack },
          'Failed to dispatch dev work after reply-to-approve',
        );
      }
    }

    return { prdId, tenantId };
  }

  /**
   * Engagement advance + dev-agent ticket+task creation, mirroring the
   * web-UI approve route. Idempotent-ish: each call mints a new ticket
   * (so a double-approve will queue two jobs); upstream code should not
   * call applyReplyAction twice for the same token (we consume it).
   */
  private async dispatchAfterApproval(prdId: string, tenantId: string): Promise<void> {
    // Always need ticketService — both branches mint a ticket+task.
    // The engagement branch additionally needs engagementService (it
    // hands the work off to engagement.advancePhase which dispatches
    // through its own internal queue). The no-engagement branch
    // additionally needs queueService (it enqueues directly). We
    // check each combination per-branch below rather than gating
    // everything behind a single all-or-nothing guard.
    if (!this.ticketService) {
      this.logger.debug({ prdId }, 'No ticket service wired — reply-to-approve skips dispatch');
      return;
    }

    // Idempotency guard: if a dev_agent ticket already exists for this
    // PRD (because a previous reply already kicked off implementation,
    // or two webhook deliveries raced through the token-consume window),
    // don't mint another one. Without this guard, the second call would
    // create a duplicate Ticket + AgentTask + queue job and the daemon
    // would do the same work twice.
    const existingDev = await (this.prisma as any).ticket.findFirst({
      where: {
        tenantId,
        roleSlug: 'dev_agent',
        payload: { path: ['prdId'], equals: prdId },
        status: { notIn: ['cancelled', 'failed'] },
      },
      select: { id: true, status: true },
    });
    if (existingDev) {
      this.logger.info(
        { prdId, existingTicketId: existingDev.id, existingStatus: existingDev.status },
        'Dev work already in flight for this PRD — skipping duplicate dispatch',
      );
      return;
    }

    // Find the engagement linked to this PRD's meeting (if any).
    const prdRecord = await this.prisma.pRD.findUnique({
      where: { id: prdId },
      select: { meetingId: true },
    });
    let engagementId: string | null = null;
    if (prdRecord?.meetingId) {
      const engagement = await (this.prisma as any).engagement.findFirst({
        where: { tenantId, meetingId: prdRecord.meetingId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
      if (engagement) engagementId = engagement.id;
    }

    if (engagementId && this.engagementService) {
      // Mint the dev_agent ticket+task here so the engagement-path
      // dispatcher in engagement.service.ts can forward both IDs to the
      // queued job (matching the route handler's behaviour). If
      // advancePhase throws (e.g. wrong current phase, prisma error)
      // we cancel the freshly minted ticket so a retry doesn't leave
      // an orphan + duplicate work.
      const created = await this.ticketService.createAsNewWork({
        tenantId,
        roleSlug: 'dev_agent',
        title: `Implement PRD ${prdId}`,
        agentTaskInput: { type: 'prd_implementation', prdId },
        payload: { type: 'prd_implementation', prdId },
      });
      try {
        await this.engagementService.advancePhase(tenantId, engagementId, {
          confidence: 1.0,
          targetPhase: 'build',
          output: {
            prdId,
            approvedAt: new Date().toISOString(),
            taskId: created.agentTaskId,
            ticketId: created.ticket.id,
          },
        });
      } catch (err) {
        await this.cancelOrphanTicket(created.ticket.id, created.agentTaskId, prdId);
        throw err;
      }
      this.logger.info(
        { prdId, engagementId, taskId: created.agentTaskId, ticketId: created.ticket.id },
        'Engagement advanced + dev job dispatched via reply-to-approve',
      );
      return;
    }

    // No engagement → fall back to the no-engagement path the route
    // uses (direct queue dispatch). This branch needs queueService.
    if (!this.queueService) {
      this.logger.debug(
        { prdId },
        'No queue service wired — reply-to-approve cannot dispatch the no-engagement path',
      );
      return;
    }
    const created = await this.ticketService.createAsNewWork({
      tenantId,
      roleSlug: 'dev_agent',
      title: `Implement PRD ${prdId}`,
      agentTaskInput: { type: 'prd_implementation', prdId },
      payload: { type: 'prd_implementation', prdId },
    });
    try {
      await this.queueService.addJob('dev_agent_process', {
        prdId,
        engagementId: '',
        tenantId,
        taskId: created.agentTaskId,
        ticketId: created.ticket.id,
      });
    } catch (err) {
      await this.cancelOrphanTicket(created.ticket.id, created.agentTaskId, prdId);
      throw err;
    }
    this.logger.info(
      { prdId, taskId: created.agentTaskId, ticketId: created.ticket.id },
      'Dev job queued directly via reply-to-approve (no engagement)',
    );
  }

  /**
   * Best-effort cleanup when we minted a Ticket+AgentTask but the
   * follow-up dispatch failed. Marks both rows as cancelled so a retry
   * doesn't leave dangling open work.
   */
  private async cancelOrphanTicket(ticketId: string, agentTaskId: string, prdId: string): Promise<void> {
    try {
      await (this.prisma as any).ticket.update({
        where: { id: ticketId },
        data: { status: 'cancelled', error: 'Dispatch failed after ticket creation' },
      });
      await (this.prisma as any).agentTask.update({
        where: { id: agentTaskId },
        data: { status: 'failed', error: 'Dispatch failed after task creation' },
      });
      this.logger.warn({ prdId, ticketId, agentTaskId }, 'Cancelled orphan ticket+task after dispatch failure');
    } catch (cleanupErr) {
      this.logger.error(
        { prdId, ticketId, agentTaskId, error: (cleanupErr as Error).message },
        'Failed to clean up orphan ticket — manual cleanup required',
      );
    }
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
