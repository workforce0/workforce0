/**
 * =============================================================================
 * SHARED WEBSOCKET DISPATCHER
 * =============================================================================
 *
 * Routes WebSocket upgrade requests by URL path prefix to the appropriate
 * WebSocketServer instance. Replaces multiple fragile `server.on('upgrade')`
 * listeners with a single, centralized dispatcher.
 *
 * @module lib/websocket-dispatcher
 */

import type { Server } from 'http';
import type { WebSocketServer } from 'ws';
import { createChildLogger } from './logger.js';

const log = createChildLogger({ module: 'ws-dispatcher' });

/**
 * Attach a single `upgrade` listener to the HTTP server that dispatches
 * incoming WebSocket connections to the correct WebSocketServer based on
 * the request URL path prefix.
 *
 * @param server  - The raw Node.js HTTP server (e.g. `app.server` from Fastify)
 * @param routes  - Map of path prefixes to WebSocketServer instances.
 *                  Matching is performed with `pathname.startsWith(prefix)`.
 */
export function setupWebSocketDispatcher(
  server: Server,
  routes: Map<string, WebSocketServer>,
): void {
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);

    for (const [pathPrefix, wss] of routes) {
      if (url.pathname.startsWith(pathPrefix)) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
        return;
      }
    }

    log.warn('WebSocket upgrade rejected: no matching route', { path: url.pathname });
    socket.destroy();
  });
}
