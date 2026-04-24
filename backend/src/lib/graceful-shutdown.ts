/**
 * =============================================================================
 * GRACEFUL SHUTDOWN HANDLER
 * =============================================================================
 *
 * Handles application shutdown gracefully in containerized environments.
 *
 * Why Graceful Shutdown?
 * ----------------------
 * When running in Kubernetes/Docker, the orchestrator sends SIGTERM before
 * killing the container. We need to:
 *
 * 1. Stop accepting new connections
 * 2. Wait for in-flight requests to complete
 * 3. Close database/cache connections cleanly
 * 4. Release any held resources
 *
 * Timeout Strategy:
 * -----------------
 * - Kubernetes default terminationGracePeriodSeconds: 30s
 * - Our shutdown timeout: 10s (force exit if cleanup hangs)
 * - If requests don't complete in time, force exit
 *
 * @module lib/graceful-shutdown
 */

import { FastifyInstance } from 'fastify';
import { logger } from './logger.js';
import { shutdownTelemetry } from './telemetry.js';

/** Maximum time to wait for graceful shutdown (ms) */
const SHUTDOWN_TIMEOUT = 10000;

/** Maximum time to wait for queue workers to finish in-progress jobs (ms) */
const QUEUE_DRAIN_TIMEOUT = 8000;

/**
 * Interface for the queue service shutdown contract.
 */
interface ShutdownableQueueService {
  stop(): Promise<void>;
}

/**
 * Sets up graceful shutdown handlers for SIGTERM and SIGINT.
 *
 * SIGTERM: Sent by Kubernetes/Docker for graceful termination
 * SIGINT: Sent when pressing Ctrl+C (development)
 *
 * @param app - Fastify instance to shut down
 * @param queueService - Optional queue service to stop before closing the server
 *
 * @example
 * ```typescript
 * const app = Fastify();
 * setupGracefulShutdown(app, queueService);
 * await app.listen({ port: 3000 });
 * ```
 */
export function setupGracefulShutdown(
  app: FastifyInstance,
  queueService?: ShutdownableQueueService,
): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    // Prevent multiple shutdown attempts
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress, ignoring signal', { signal });
      return;
    }
    isShuttingDown = true;

    logger.info('Shutting down gracefully...');
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    // Set a timeout for forced shutdown
    const forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);

    try {
      // STEP 1: Stop queue workers BEFORE closing the server.
      // This lets in-progress jobs finish while Redis is still available.
      if (queueService) {
        logger.info('Stopping queue workers (waiting for in-progress jobs)...');
        try {
          await Promise.race([
            queueService.stop(),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('Queue drain timeout')), QUEUE_DRAIN_TIMEOUT)
            ),
          ]);
          logger.info('Queue workers stopped successfully');
        } catch (queueErr) {
          logger.warn('Queue workers did not stop cleanly within timeout, proceeding with shutdown', {
            error: (queueErr as Error).message,
          });
        }
      }

      // STEP 1.5: Shut down AgentHub (closes all WebSocket agent connections)
      if ((app as any).services?.agentHub) {
        logger.info('Shutting down AgentHub...');
        await (app as any).services.agentHub.shutdown();
        logger.info('AgentHub shutdown complete');
      }

      // STEP 2: Close the Fastify server (stops accepting new connections)
      // This also triggers the 'onClose' hooks which clean up DB/Redis
      await app.close();

      // STEP 3: Flush OpenTelemetry spans
      await shutdownTelemetry();

      logger.info('Graceful shutdown completed successfully');
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', { error });
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  };

  // Register signal handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions (should not happen, but safety net)
  process.on('uncaughtException', (error) => {
    logger.fatal('Uncaught exception', { error: error.message, stack: error.stack });
    shutdown('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    logger.fatal('Unhandled promise rejection', { reason });
    shutdown('unhandledRejection');
  });

  logger.debug('Graceful shutdown handlers registered');
}
