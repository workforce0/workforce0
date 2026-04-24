/**
 * =============================================================================
 * GRACEFUL SHUTDOWN TESTS
 * =============================================================================
 *
 * Tests for setupGracefulShutdown (src/lib/graceful-shutdown.ts):
 *   - Registers SIGTERM & SIGINT handlers
 *   - Stops queue workers BEFORE closing the Fastify server
 *   - Falls through to server close when queue drain times out
 *   - Shuts down correctly when queueService is not provided
 *
 * Strategy:
 *   We stub process.on/process.exit, mock the Fastify app, and mock the
 *   queueService. Then we manually fire the captured signal handlers to
 *   verify the ordering and timeout behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock logger before importing module under test
// ---------------------------------------------------------------------------

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../lib/telemetry.js', () => ({
  shutdownTelemetry: vi.fn().mockResolvedValue(undefined),
  initTelemetry: vi.fn().mockResolvedValue(undefined),
  getTracer: vi.fn(),
  resetTelemetry: vi.fn(),
}));

import { setupGracefulShutdown } from '../../lib/graceful-shutdown.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockApp() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockQueueService(stopBehaviour: 'resolve' | 'reject' | 'hang' = 'resolve') {
  return {
    stop: vi.fn().mockImplementation(() => {
      if (stopBehaviour === 'resolve') return Promise.resolve();
      if (stopBehaviour === 'reject') return Promise.reject(new Error('stop failed'));
      // 'hang' — never resolves (simulates stuck workers)
      return new Promise(() => {});
    }),
  };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('setupGracefulShutdown', () => {
  // Save originals
  const originalProcessOn = process.on;
  const originalProcessExit = process.exit;

  // Captured handlers
  let signalHandlers: Record<string, (...args: any[]) => void>;
  let processExitSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signalHandlers = {};

    // Stub process.on to capture signal handlers instead of actually registering them
    process.on = vi.fn((event: string, handler: any) => {
      signalHandlers[event] = handler;
      return process;
    }) as any;

    // Stub process.exit to prevent actually exiting
    processExitSpy = vi.fn();
    process.exit = processExitSpy as any;

    vi.useFakeTimers();
  });

  afterEach(() => {
    process.on = originalProcessOn;
    process.exit = originalProcessExit;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Signal handler registration
  // =========================================================================

  describe('registers signal handlers', () => {
    it('should register handlers for SIGTERM, SIGINT, uncaughtException, and unhandledRejection', () => {
      const app = createMockApp();
      setupGracefulShutdown(app);

      expect(signalHandlers['SIGTERM']).toBeDefined();
      expect(signalHandlers['SIGINT']).toBeDefined();
      expect(signalHandlers['uncaughtException']).toBeDefined();
      expect(signalHandlers['unhandledRejection']).toBeDefined();
    });
  });

  // =========================================================================
  // Shutdown ordering: queue workers BEFORE server
  // =========================================================================

  describe('shutdown stops queue workers BEFORE closing server', () => {
    it('should call queueService.stop() before app.close()', async () => {
      const app = createMockApp();
      const queue = createMockQueueService('resolve');
      const callOrder: string[] = [];

      queue.stop.mockImplementation(() => {
        callOrder.push('queue.stop');
        return Promise.resolve();
      });
      app.close.mockImplementation(() => {
        callOrder.push('app.close');
        return Promise.resolve();
      });

      setupGracefulShutdown(app, queue);

      // Fire SIGTERM
      signalHandlers['SIGTERM']();

      // Let promises resolve
      await vi.advanceTimersByTimeAsync(100);

      expect(callOrder[0]).toBe('queue.stop');
      expect(callOrder[1]).toBe('app.close');
    });

    it('should call process.exit(0) on successful shutdown', async () => {
      const app = createMockApp();
      const queue = createMockQueueService('resolve');

      setupGracefulShutdown(app, queue);
      signalHandlers['SIGTERM']();

      await vi.advanceTimersByTimeAsync(100);

      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

  // =========================================================================
  // Queue drain timeout
  // =========================================================================

  describe('queue drain timeout falls through to server close', () => {
    it('should proceed to app.close() when queue.stop() hangs past 8s timeout', async () => {
      const app = createMockApp();
      const queue = createMockQueueService('hang'); // never resolves

      setupGracefulShutdown(app, queue);
      signalHandlers['SIGTERM']();

      // Fast-forward past QUEUE_DRAIN_TIMEOUT (8000ms)
      await vi.advanceTimersByTimeAsync(8100);

      // app.close should still be called even though queue.stop never resolved
      expect(app.close).toHaveBeenCalled();
    });

    it('should still call process.exit after drain timeout + server close', async () => {
      const app = createMockApp();
      const queue = createMockQueueService('hang');

      setupGracefulShutdown(app, queue);
      signalHandlers['SIGTERM']();

      await vi.advanceTimersByTimeAsync(8200);

      expect(processExitSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Shutdown without queueService
  // =========================================================================

  describe('shutdown without queueService still closes server', () => {
    it('should call app.close() directly when queueService is undefined', async () => {
      const app = createMockApp();

      setupGracefulShutdown(app); // no queueService

      signalHandlers['SIGTERM']();
      await vi.advanceTimersByTimeAsync(100);

      expect(app.close).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

  // =========================================================================
  // Idempotent shutdown (double signal)
  // =========================================================================

  describe('idempotent shutdown', () => {
    it('should ignore subsequent signals once shutdown is in progress', async () => {
      const app = createMockApp();
      const queue = createMockQueueService('resolve');

      setupGracefulShutdown(app, queue);

      // Fire SIGTERM twice
      signalHandlers['SIGTERM']();
      signalHandlers['SIGINT']();

      await vi.advanceTimersByTimeAsync(100);

      // queue.stop should only be called once
      expect(queue.stop).toHaveBeenCalledTimes(1);
      expect(app.close).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Error during app.close
  // =========================================================================

  describe('error during app.close', () => {
    it('should call process.exit(1) when app.close() throws', async () => {
      const app = createMockApp();
      app.close.mockRejectedValue(new Error('close failed'));

      setupGracefulShutdown(app);

      signalHandlers['SIGTERM']();
      await vi.advanceTimersByTimeAsync(100);

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // =========================================================================
  // Force exit timeout
  // =========================================================================

  describe('force exit timeout', () => {
    it('should force process.exit(1) if overall shutdown exceeds 10s', async () => {
      const app = createMockApp();
      // app.close never resolves
      app.close.mockImplementation(() => new Promise(() => {}));

      setupGracefulShutdown(app); // no queue, but app.close hangs

      signalHandlers['SIGTERM']();

      // Advance past SHUTDOWN_TIMEOUT (10000ms)
      await vi.advanceTimersByTimeAsync(10100);

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
