/**
 * =============================================================================
 * RATE LIMITING MIDDLEWARE
 * =============================================================================
 *
 * Configures rate limiting for different route groups:
 * - Auth endpoints: Strict (prevent brute force)
 * - AI processing endpoints: Moderate (expensive operations)
 * - General API: Relaxed
 *
 * @module middleware/rate-limit
 */

import rateLimit from '@fastify/rate-limit';
import { FastifyInstance } from 'fastify';
import { createChildLogger } from '../lib/logger.js';
import { Redis } from 'ioredis';

const logger = createChildLogger({ module: 'rate-limit' });

export interface RateLimitConfig {
  /** Redis instance for distributed rate limiting */
  redis: Redis;
  /** Whether rate limiting is enabled */
  enabled: boolean;
}

/**
 * Register global rate limit plugin on the Fastify instance.
 * This sets a default rate limit; individual routes/prefixes can override.
 */
export async function registerRateLimiting(
  app: FastifyInstance,
  config: RateLimitConfig
): Promise<void> {
  if (!config.enabled) {
    logger.warn('Rate limiting disabled');
    return;
  }

  await app.register(rateLimit, {
    global: true,
    max: 100, // Default: 100 requests per minute
    timeWindow: '1 minute',
    redis: config.redis,
    keyGenerator: (request) => {
      // Use tenant ID if available, fall back to IP.
      // Note: tenantId is set by the auth/tenant middleware which runs AFTER
      // rate limiting on some routes (e.g. /api/auth/*). In those cases this
      // correctly falls back to IP-based limiting, which is the desired
      // behavior for unauthenticated endpoints like login and signup.
      const tenantId = (request as any).tenantId;
      return tenantId || request.ip;
    },
    errorResponseBuilder: (_request, context) => ({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Limit: ${context.max} per ${context.after}. Try again later.`,
        retryAfter: context.after,
      },
    }),
    onExceeding: (_req, key) => {
      logger.debug('Rate limit nearing', { key });
    },
    onExceeded: (_req, key) => {
      logger.warn('Rate limit exceeded', { key });
    },
  });

  logger.info('Rate limiting registered (global: 100/min)');
}

/**
 * Create route-level rate limit config for auth endpoints.
 * Returns Fastify route config object with rate limiting.
 */
export const authLoginRateLimit = {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => request.ip, // Always use IP for auth
    },
  },
};

export const authSignupRateLimit = {
  config: {
    rateLimit: {
      max: 3,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => request.ip,
    },
  },
};

/**
 * Rate limit config for AI processing endpoints (expensive operations).
 */
export const aiProcessingRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute',
    },
  },
};
