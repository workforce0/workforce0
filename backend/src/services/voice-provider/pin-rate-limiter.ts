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

/**
 * Server-side Lua: INCR the key, and EXPIRE it on first creation only.
 * Atomicity matters because a two-step `incr` then `expire` from the client
 * could leave the key without a TTL if the Node process crashed between the
 * two round-trips — that would lock the caller out forever (no expiry).
 */
const INCR_WITH_TTL_SCRIPT = [
  "local v = redis.call('INCR', KEYS[1])",
  "if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
  'return v',
].join('\n');

interface RedisScriptRunner {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}

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
    // ioredis types `eval` loosely; cast to a narrow runner shape so we can
    // call it without unsafe-any leaking out.
    const runner = this.redis as unknown as RedisScriptRunner;
    const count = (await runner.eval(
      INCR_WITH_TTL_SCRIPT,
      1,
      k,
      String(TTL_SEC),
    )) as number;
    logger.warn({ tenantId, fromNumber, count }, 'PIN failure recorded');
  }
}
