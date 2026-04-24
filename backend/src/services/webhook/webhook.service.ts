/**
 * =============================================================================
 * OUTGOING WEBHOOK SERVICE
 * =============================================================================
 *
 * Manages tenant-registered webhook endpoints and delivers event payloads.
 *
 * Flow: Platform event → find matching endpoints → sign & POST → log delivery.
 *
 * Signing: HMAC-SHA256 with per-endpoint secret in X-Webhook-Signature header.
 *
 * @module services/webhook
 */

import crypto from 'node:crypto';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'WebhookService' });

/** Supported outgoing webhook event types. */
export const WEBHOOK_EVENTS = [
  'meeting.completed',
  'meeting.failed',
  'prd.generated',
  'prd.approved',
  'prd.rejected',
  'tickets.created',
  'engagement.phase_changed',
  'clarification.requested',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  tenantId: string;
  data: Record<string, unknown>;
}

export class WebhookService {
  private readonly prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /** Generate a random signing secret for a new endpoint. */
  static generateSecret(): string {
    return `whsec_${crypto.randomBytes(24).toString('hex')}`;
  }

  /** Sign a payload using HMAC-SHA256. */
  static sign(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    data: { url: string; events: string[]; description?: string }
  ) {
    const secret = WebhookService.generateSecret();
    return this.prisma.webhookEndpoint.create({
      data: {
        tenantId,
        url: data.url,
        secret,
        events: data.events,
        description: data.description || null,
        active: true,
      },
      select: { id: true, url: true, events: true, active: true, description: true, createdAt: true },
    });
  }

  async list(tenantId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: { tenantId },
      select: { id: true, url: true, events: true, active: true, description: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(tenantId: string, id: string) {
    return this.prisma.webhookEndpoint.findFirst({
      where: { id, tenantId },
      select: {
        id: true, url: true, events: true, active: true, description: true,
        createdAt: true, updatedAt: true,
        deliveries: {
          select: { id: true, event: true, statusCode: true, success: true, attempts: true, error: true, duration: true, createdAt: true },
          orderBy: { createdAt: 'desc' as const },
          take: 20,
        },
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: { url?: string; events?: string[]; active?: boolean; description?: string }
  ) {
    // Verify ownership
    const existing = await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!existing) return null;

    return this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(data.url !== undefined && { url: data.url }),
        ...(data.events !== undefined && { events: data.events }),
        ...(data.active !== undefined && { active: data.active }),
        ...(data.description !== undefined && { description: data.description }),
      },
      select: { id: true, url: true, events: true, active: true, description: true, updatedAt: true },
    });
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const existing = await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!existing) return false;
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    return true;
  }

  /** Reveal the signing secret (only show once or on explicit request). */
  async getSecret(tenantId: string, id: string): Promise<string | null> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, tenantId },
      select: { secret: true },
    });
    return endpoint?.secret ?? null;
  }

  // ─── DELIVERY ──────────────────────────────────────────────────────────────

  /**
   * Deliver an event to all matching endpoints for a tenant.
   * Fire-and-forget — never throws. Logs delivery results.
   */
  async deliver(tenantId: string, event: WebhookEventType, data: Record<string, unknown>): Promise<void> {
    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { tenantId, active: true, events: { has: event } },
        select: { id: true, url: true, secret: true },
      });

      if (endpoints.length === 0) return;

      const payload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        tenantId,
        data,
      };

      const body = JSON.stringify(payload);

      // Deliver to all endpoints in parallel
      await Promise.allSettled(
        endpoints.map((ep: { id: string; url: string; secret: string }) =>
          this.deliverToEndpoint(ep, body)
        )
      );
    } catch (err) {
      logger.error('Failed to deliver webhook event', {
        tenantId, event, error: (err as Error).message,
      });
    }
  }

  private async deliverToEndpoint(
    endpoint: { id: string; url: string; secret: string },
    body: string
  ): Promise<void> {
    const signature = WebhookService.sign(body, endpoint.secret);
    const startTime = Date.now();
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let success = false;
    let error: string | null = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'User-Agent': 'Workforce0-Webhooks/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      statusCode = res.status;
      success = res.status >= 200 && res.status < 300;

      try {
        const text = await res.text();
        responseBody = text.slice(0, 1024); // Cap at 1KB
      } catch {
        // Ignore response body errors
      }
    } catch (err) {
      error = (err as Error).message;
    }

    const duration = Date.now() - startTime;

    // Log delivery result
    try {
      await this.prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          event: JSON.parse(body).event,
          payload: JSON.parse(body),
          statusCode,
          responseBody,
          success,
          error,
          duration,
        },
      });
    } catch (logErr) {
      logger.error('Failed to log webhook delivery', {
        endpointId: endpoint.id, error: (logErr as Error).message,
      });
    }

    if (!success) {
      logger.warn('Webhook delivery failed', {
        endpointId: endpoint.id,
        url: endpoint.url,
        statusCode,
        error,
        duration,
      });
    }
  }
}
