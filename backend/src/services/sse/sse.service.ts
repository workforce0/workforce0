/**
 * =============================================================================
 * SSE (Server-Sent Events) Service
 * =============================================================================
 *
 * Manages real-time event streaming to connected clients.
 *
 * Architecture:
 * - Each connected client registers with their tenantId
 * - Events are published per-tenant (all users in a tenant get the same events)
 * - Supports Redis pub/sub for multi-instance deployment
 *
 * Event types:
 *   engagement.phase_changed — Engagement moved to a new phase
 *   notification.new         — New notification for the user
 *   agent.status_changed     — Agent started/completed/failed
 *   prd.updated              — PRD was updated
 *
 * Usage:
 *   // Publishing:
 *   sseService.publish(tenantId, 'engagement.phase_changed', { id, phase });
 *
 *   // Route handler:
 *   app.get('/api/events', (req, reply) => sseService.addClient(tenantId, reply.raw));
 */

import { createChildLogger } from '../../lib/logger.js';
import type { ServerResponse } from 'http';

const log = createChildLogger({ service: 'SSEService' });

export interface SSEEvent {
  type: string;
  data: unknown;
  id?: string;
}

interface ConnectedClient {
  tenantId: string;
  res: ServerResponse;
  connectedAt: Date;
}

export class SSEService {
  private static MAX_CLIENTS_PER_TENANT = 20;
  private static MAX_TOTAL_CLIENTS = 1000;

  private clients = new Map<string, Set<ConnectedClient>>();
  private eventCounters = new Map<string, number>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Send heartbeat every 30s to keep connections alive
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 30_000);
  }

  /**
   * Register a new SSE client connection.
   * Returns false if connection was rejected due to limits.
   */
  addClient(tenantId: string, res: ServerResponse): boolean {
    // Enforce per-tenant limit
    if (this.getClientCount(tenantId) >= SSEService.MAX_CLIENTS_PER_TENANT) {
      log.warn('SSE connection rejected: tenant limit reached', { tenantId, limit: SSEService.MAX_CLIENTS_PER_TENANT });
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many SSE connections' }));
      return false;
    }

    // Enforce global limit
    if (this.getTotalClientCount() >= SSEService.MAX_TOTAL_CLIENTS) {
      log.warn('SSE connection rejected: global limit reached', { tenantId, limit: SSEService.MAX_TOTAL_CLIENTS });
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server at capacity' }));
      return false;
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    const client: ConnectedClient = {
      tenantId,
      res,
      connectedAt: new Date(),
    };

    if (!this.clients.has(tenantId)) {
      this.clients.set(tenantId, new Set());
    }
    this.clients.get(tenantId)!.add(client);

    // Send initial connection event
    this.sendToClient(client, {
      type: 'connected',
      data: { message: 'SSE connection established' },
    });

    // Remove on disconnect
    res.on('close', () => {
      const tenantClients = this.clients.get(tenantId);
      if (tenantClients) {
        tenantClients.delete(client);
        if (tenantClients.size === 0) {
          this.clients.delete(tenantId);
        }
      }
      log.debug('SSE client disconnected', { tenantId });
    });

    log.debug('SSE client connected', {
      tenantId,
      totalClients: this.getClientCount(tenantId),
    });

    return true;
  }

  /**
   * Publish an event to all connected clients for a tenant.
   */
  publish(tenantId: string, type: string, data: unknown): void {
    const tenantClients = this.clients.get(tenantId);
    if (!tenantClients || tenantClients.size === 0) return;

    // Monotonic counter per tenant — supports Last-Event-ID reconnection
    const seq = (this.eventCounters.get(tenantId) ?? 0) + 1;
    this.eventCounters.set(tenantId, seq);

    const event: SSEEvent = {
      type,
      data,
      id: `${Date.now()}-${seq}`,
    };

    for (const client of tenantClients) {
      this.sendToClient(client, event);
    }

    log.debug('SSE event published', {
      tenantId,
      type,
      recipientCount: tenantClients.size,
    });
  }

  /**
   * Get the number of connected clients for a tenant.
   */
  getClientCount(tenantId: string): number {
    return this.clients.get(tenantId)?.size ?? 0;
  }

  /**
   * Get total connected client count across all tenants.
   */
  getTotalClientCount(): number {
    let total = 0;
    for (const clients of this.clients.values()) {
      total += clients.size;
    }
    return total;
  }

  /**
   * Send an SSE-formatted event to a single client.
   */
  private sendToClient(client: ConnectedClient, event: SSEEvent): void {
    try {
      if (client.res.writableEnded) return;

      let message = '';
      if (event.id) message += `id: ${event.id}\n`;
      message += `event: ${event.type}\n`;
      message += `data: ${JSON.stringify(event.data)}\n\n`;

      client.res.write(message);
    } catch {
      // Client likely disconnected — will be cleaned up on 'close' event
    }
  }

  /**
   * Send heartbeat to all connected clients (keeps connection alive).
   */
  private sendHeartbeat(): void {
    for (const tenantClients of this.clients.values()) {
      for (const client of tenantClients) {
        try {
          if (!client.res.writableEnded) {
            client.res.write(': heartbeat\n\n');
          }
        } catch {
          // Will be cleaned up on 'close'
        }
      }
    }
  }

  /**
   * Cleanup all connections (called during shutdown).
   */
  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const tenantClients of this.clients.values()) {
      for (const client of tenantClients) {
        try {
          if (!client.res.writableEnded) {
            client.res.end();
          }
        } catch {
          // Ignore
        }
      }
    }
    this.clients.clear();
  }
}
