/**
 * =============================================================================
 * AGENT WEBHOOK SERVICE — N4: cross-language agents
 * =============================================================================
 *
 * Fires outbound HTTP POSTs to registered agent URLs on ticket.ready.
 * Any language that can host a webhook endpoint becomes a valid agent.
 *
 * Payload shape (base64url signature over the JSON body, HMAC-SHA256):
 *   {
 *     event: 'ticket.ready',
 *     tenantId: string,
 *     ticketId: string,
 *     roleSlug: string,
 *     signature: string,   // receiver verifies to confirm we sent this
 *     ts: number           // ms epoch — receivers can enforce a freshness window
 *   }
 *
 * The service subscribes to TicketService.events in its constructor, so
 * webhook fan-out is automatic once created. Non-2xx responses retry
 * with exponential backoff up to 3 times, then we log and move on —
 * a flaky agent shouldn't block other subscribers.
 *
 * @module services/agent-webhook
 */

import crypto from 'node:crypto';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';
import type { TicketService, TicketReadyEvent } from '../ticket/ticket.service.js';

const logger = createChildLogger({ service: 'AgentWebhookService' });

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface WebhookRegistrationInput {
  tenantId: string;
  roleSlug: string;
  callbackUrl: string;
  name?: string;
  /** If omitted, we generate a fresh 32-byte base64url secret. */
  sharedSecret?: string;
  createdBy?: string;
}

export interface WebhookDTO {
  id: string;
  tenantId: string;
  roleSlug: string;
  callbackUrl: string;
  name: string | null;
  isActive: boolean;
  lastFiredAt: Date | null;
  lastStatus: string | null;
  sharedSecret: string; // returned on create ONCE; obfuscated on list
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(row: any, revealSecret = false): WebhookDTO {
  return {
    id: row.id,
    tenantId: row.tenantId,
    roleSlug: row.roleSlug,
    callbackUrl: row.callbackUrl,
    name: row.name ?? null,
    isActive: row.isActive,
    lastFiredAt: row.lastFiredAt ?? null,
    lastStatus: row.lastStatus ?? null,
    sharedSecret: revealSecret
      ? row.sharedSecret
      : `•••${(row.sharedSecret as string).slice(-4)}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function signBody(body: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');
}

function backoffMs(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.min(base, MAX_DELAY_MS);
}

export class AgentWebhookService {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    /**
     * Injected because the webhook service's main job is to fan out
     * TicketService events. Wiring the subscription here (vs at the
     * DI-container) keeps the contract narrow and testable.
     */
    private readonly tickets: TicketService | null,
  ) {
    if (!tickets) return;
    const onReady = (ev: TicketReadyEvent) => {
      // Don't await in the listener — fan out to webhooks in background.
      // Listener-thrown errors were already handled by TicketService's
      // captureRejections wrapper, so even if fanOut crashes, the
      // ticket write path is unaffected.
      this.fanOut(ev).catch((err) => {
        logger.warn('Webhook fan-out crashed', { error: (err as Error).message });
      });
    };
    tickets.events.on('ticket.ready', onReady);
    this.unsubscribe = () => tickets.events.off('ticket.ready', onReady);
  }

  /** Cleanup hook for tests + graceful shutdown. */
  shutdown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async register(input: WebhookRegistrationInput): Promise<WebhookDTO> {
    const sharedSecret = input.sharedSecret ?? crypto.randomBytes(32).toString('base64url');
    const row = await (this.prisma as any).agentWebhook.create({
      data: {
        tenantId: input.tenantId,
        roleSlug: input.roleSlug,
        callbackUrl: input.callbackUrl,
        sharedSecret,
        name: input.name ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
    logger.info('Agent webhook registered', {
      tenantId: input.tenantId,
      roleSlug: input.roleSlug,
      id: row.id,
    });
    // Only this one-time response exposes the secret in full; list()
    // masks to last-4.
    return toDTO(row, true);
  }

  async listForTenant(tenantId: string): Promise<WebhookDTO[]> {
    const rows = (await (this.prisma as any).agentWebhook.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })) as any[];
    return rows.map((r) => toDTO(r, false));
  }

  async setActive(tenantId: string, id: string, isActive: boolean): Promise<WebhookDTO | null> {
    const found = await (this.prisma as any).agentWebhook.findFirst({ where: { id, tenantId } });
    if (!found) return null;
    const updated = await (this.prisma as any).agentWebhook.update({
      where: { id },
      data: { isActive },
    });
    return toDTO(updated, false);
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const deleted = await (this.prisma as any).agentWebhook.deleteMany({
      where: { id, tenantId },
    });
    return deleted.count > 0;
  }

  /**
   * Fan a ticket.ready out to every active webhook subscribed to its
   * role. Parallel POSTs; each with its own retry loop. Kept public
   * so tests can trigger fan-out without going through the emitter.
   */
  async fanOut(ev: TicketReadyEvent): Promise<void> {
    const webhooks = (await (this.prisma as any).agentWebhook.findMany({
      where: { tenantId: ev.tenantId, roleSlug: ev.roleSlug, isActive: true },
    })) as any[];

    if (webhooks.length === 0) return;

    await Promise.all(webhooks.map((hook) => this.postWithRetry(hook, ev)));
  }

  private async postWithRetry(hook: any, ev: TicketReadyEvent): Promise<void> {
    const body = JSON.stringify({
      event: 'ticket.ready',
      tenantId: ev.tenantId,
      ticketId: ev.ticketId,
      roleSlug: ev.roleSlug,
      ts: Date.now(),
    });
    const signature = signBody(body, hook.sharedSecret);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const res = await fetch(hook.callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Workforce0-Signature': signature,
            'X-Workforce0-Event': 'ticket.ready',
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        await this.recordResult(hook.id, res.ok ? String(res.status) : `${res.status}`);
        if (res.ok) return;
        // 4xx: don't retry — the agent's rejection is final.
        if (res.status >= 400 && res.status < 500) {
          logger.info('Webhook returned 4xx, not retrying', { hookId: hook.id, status: res.status });
          return;
        }
        // 5xx: fall through to retry
      } catch (err) {
        const status = (err as Error).name === 'AbortError' ? 'timeout' : 'connection_refused';
        await this.recordResult(hook.id, status);
        logger.warn('Webhook attempt failed', {
          hookId: hook.id,
          attempt,
          status,
          error: (err as Error).message,
        });
      }

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      }
    }
    logger.warn('Webhook abandoned after max retries', { hookId: hook.id, ticketId: ev.ticketId });
  }

  private async recordResult(hookId: string, status: string): Promise<void> {
    try {
      await (this.prisma as any).agentWebhook.update({
        where: { id: hookId },
        data: { lastFiredAt: new Date(), lastStatus: status },
      });
    } catch { /* best-effort bookkeeping */ }
  }
}
