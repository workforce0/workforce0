/**
 * PinRateLimiter — Redis counter keyed by tenantId+callerNumber with 1h TTL.
 * After `maxAttempts` failures, isBlocked returns true until the key expires.
 *
 * @module services/voice-provider/pin-rate-limiter
 */

import type { Redis } from 'ioredis';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'PinRateLimiter' });
const TTL_SEC = 3600;

export class PinRateLimiter {
  constructor(private readonly redis: Redis, private readonly maxAttempts: number = 3) {}

  private key(tenantId: string, fromNumber: string): string {
    return `voice:pin-fails:${tenantId}:${fromNumber}`;
  }

  async isBlocked(tenantId: string, fromNumber: string): Promise<boolean> {
    const v = await this.redis.get(this.key(tenantId, fromNumber));
    return Number(v ?? 0) >= this.maxAttempts;
  }

  async recordFailure(tenantId: string, fromNumber: string): Promise<void> {
    const k = this.key(tenantId, fromNumber);
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, TTL_SEC);
    logger.warn({ tenantId, fromNumber, count }, 'PIN failure recorded');
  }
}
