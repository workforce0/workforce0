/**
 * =============================================================================
 * WORKFORCE0 MVP - AI Workforce Platform
 * =============================================================================
 *
 * Main entry point for the Fastify server.
 *
 * Architecture Overview:
 * ----------------------
 * This application follows a layered architecture:
 *
 * 1. ROUTES LAYER (src/routes/)
 *    - HTTP endpoint definitions
 *    - Request validation using Zod schemas
 *    - Delegates to services, never contains business logic
 *
 * 2. SERVICES LAYER (src/services/)
 *    - Contains all business logic
 *    - Orchestrates between different components
 *    - Services are singleton instances injected via DI container
 *
 * 3. REPOSITORIES LAYER (src/repositories/)
 *    - Data access abstraction
 *    - All database queries go through repositories
 *    - Makes testing and swapping data sources easy
 *
 * 4. TYPES LAYER (src/types/)
 *    - TypeScript interfaces and types
 *    - Zod schemas for runtime validation
 *    - Shared across all layers
 *
 * Design Patterns Used:
 * --------------------
 * - Repository Pattern: Data access abstraction
 * - Service Layer: Business logic encapsulation
 * - Dependency Injection: Via Fastify decorators
 * - Factory Pattern: For creating complex objects (PRDs, tickets)
 * - Strategy Pattern: For different AI model providers
 * - Observer Pattern: Event-driven task processing via BullMQ
 *
 * @module index
 * @author Workforce0 Team
 * @version 0.1.0
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { setupDependencies } from './lib/di-container.js';
import { setupRoutes } from './routes/index.js';
import { setupErrorHandler } from './lib/error-handler.js';
import { setupGracefulShutdown } from './lib/graceful-shutdown.js';
import { initTelemetry, shutdownTelemetry } from './lib/telemetry.js';
import { setupTwilioMediaStreamWebSocket } from './routes/twilio.routes.js';
import { setupWebSocketDispatcher } from './lib/websocket-dispatcher.js';
import { WebSocketServer } from 'ws';

/**
 * Creates and configures the Fastify application instance.
 *
 * This function:
 * 1. Creates Fastify instance with logging
 * 2. Registers plugins (CORS, etc.)
 * 3. Sets up dependency injection container
 * 4. Registers all routes
 * 5. Configures error handling
 *
 * @returns Configured Fastify instance ready to start
 *
 * @example
 * ```typescript
 * const app = await buildApp();
 * await app.listen({ port: 3000 });
 * ```
 */
async function buildApp(): Promise<FastifyInstance> {
  // Create Fastify instance with custom logger
  // Note: Fastify 5 uses 'loggerInstance' for passing a pre-created Pino instance
  const app = Fastify({
    loggerInstance: logger as any,
    // Generate request IDs for tracing
    genReqId: () => `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  });

  // Add custom content type parser to preserve rawBody for webhook signature verification
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
    try {
      // Store the raw body for webhook signature verification
      (req as any).rawBody = body;
      // Parse JSON
      const json = JSON.parse(body);
      done(null, json);
    } catch (err) {
      const parseError = new Error('Invalid JSON in request body') as Error & { statusCode: number };
      parseError.statusCode = 400;
      done(parseError, undefined);
    }
  });

  // Register formbody parser for Twilio webhooks (they send application/x-www-form-urlencoded)
  await app.register(formbody);

  // Register cookie plugin for httpOnly JWT cookies
  await app.register(cookie);

  // Security headers (HSTS, X-Content-Type-Options, X-Frame-Options, etc.)
  await app.register(helmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production' ? undefined : false,
  });

  // Register CORS for cross-origin requests
  await app.register(cors, {
    origin: config.NODE_ENV === 'production'
      ? (config.ALLOWED_ORIGINS ? config.ALLOWED_ORIGINS.split(',') : ['https://workforce0.com'])
      : true, // Allow all origins in development
    credentials: true,
  });

  // Setup dependency injection - injects services into Fastify instance
  // After this, services are available via app.services.meetingService, etc.
  await setupDependencies(app as any);

  // Configure global error handler (must be before routes so child scopes inherit it)
  setupErrorHandler(app as any);

  // Register all HTTP routes
  await setupRoutes(app as any);

  return app as any;
}

/**
 * Main application entry point.
 *
 * Starts the server and sets up graceful shutdown handlers
 * for SIGTERM and SIGINT signals (important for container deployments).
 */
async function main(): Promise<void> {
  try {
    // Initialize OpenTelemetry BEFORE building the app (so auto-instrumentation catches everything)
    await initTelemetry();

    const app = await buildApp();

    // Setup graceful shutdown for containerized environments
    // Pass the queue service so workers are stopped BEFORE the server closes
    setupGracefulShutdown(app, app.services.queueService);

    // Start listening
    const address = await app.listen({
      port: config.PORT,
      host: config.HOST,
    });

    // ---- Shared WebSocket dispatcher ----
    // All WebSocket endpoints are registered here so there is a single
    // `server.on('upgrade')` listener instead of one per feature.
    const wsRoutes = new Map<string, WebSocketServer>();

    // Agent hub WebSocket (if the service is available)
    if ((app.services as any).agentHub) {
      const agentWss = new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024 });
      agentWss.on('connection', (ws) => {
        (app.services as any).agentHub.handleConnection(ws);
      });
      wsRoutes.set('/agent/ws', agentWss);
      logger.info('Agent hub WebSocket route registered');
    }

    // Twilio Media Stream WebSocket (for voice dial-in)
    if (app.services.twilioVoiceService && config.OPENAI_API_KEY) {
      const twilioWss = setupTwilioMediaStreamWebSocket({
        twilioVoiceService: app.services.twilioVoiceService,
        openaiApiKey: config.OPENAI_API_KEY,
      });
      wsRoutes.set('/media-stream/', twilioWss);
      logger.info('Twilio Media Stream WebSocket route registered (using OpenAI Realtime)');
    } else if (app.services.twilioVoiceService && !config.OPENAI_API_KEY) {
      logger.warn('Twilio service available but OPENAI_API_KEY not set - voice bot disabled');
    }

    // Activate the shared dispatcher
    if (wsRoutes.size > 0) {
      setupWebSocketDispatcher(app.server, wsRoutes);
      logger.info('Shared WebSocket dispatcher active', { routes: [...wsRoutes.keys()] });
    }

    logger.info(`Workforce0 MVP server running at ${address}`);
    logger.info(`Environment: ${config.NODE_ENV}`);
    logger.info(`Health check: ${address}/health`);

  } catch (error) {
    // Log the full error details
    console.error('Failed to start server:');
    console.error(error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Start the application
main();
