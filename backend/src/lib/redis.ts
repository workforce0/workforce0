/**
 * =============================================================================
 * Redis Connection Factory — Supports standalone and Sentinel modes
 * =============================================================================
 *
 * Builds ioredis connection options based on environment config:
 *   - Standalone: Uses REDIS_URL (default)
 *   - Sentinel: Uses REDIS_SENTINEL_HOSTS + REDIS_SENTINEL_MASTER
 *
 * Usage:
 *   const redis = createRedisConnection(config, { name: 'main' });
 *   const bullmq = createRedisConnection(config, { name: 'bullmq', maxRetriesPerRequest: null });
 */

import { Redis } from 'ioredis';
import type { EnvConfig } from '../config/index.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger({ module: 'redis-factory' });

export interface RedisConnectionOptions {
  name: string;
  maxRetriesPerRequest?: number | null;
}

/**
 * Parse REDIS_SENTINEL_HOSTS into an array of { host, port } objects.
 * Format: "host1:port1,host2:port2,host3:port3"
 */
function parseSentinelHosts(raw: string): Array<{ host: string; port: number }> {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, portStr] = entry.split(':');
      return { host, port: parseInt(portStr || '26379', 10) };
    });
}

/**
 * Create a Redis connection with automatic Sentinel detection.
 */
export function createRedisConnection(
  cfg: EnvConfig,
  opts: RedisConnectionOptions,
): Redis {
  const retryStrategy = (times: number) => {
    if (times > 5) {
      log.error(`Redis [${opts.name}] connection failed after 5 retries`);
      return null;
    }
    return Math.min(times * 200, 5000);
  };

  // Sentinel mode
  if (cfg.REDIS_SENTINEL_HOSTS) {
    const sentinels = parseSentinelHosts(cfg.REDIS_SENTINEL_HOSTS);
    const masterName = cfg.REDIS_SENTINEL_MASTER || 'mymaster';

    log.info(`Creating Redis [${opts.name}] via Sentinel`, {
      sentinels: sentinels.map((s) => `${s.host}:${s.port}`),
      master: masterName,
    });

    return new Redis({
      sentinels,
      name: masterName,
      password: cfg.REDIS_PASSWORD || undefined,
      db: cfg.REDIS_DB || 0,
      maxRetriesPerRequest: opts.maxRetriesPerRequest !== undefined ? opts.maxRetriesPerRequest : 3,
      retryStrategy,
      sentinelRetryStrategy: retryStrategy,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }

  // Standalone mode
  log.info(`Creating Redis [${opts.name}] via standalone URL`);

  return new Redis(cfg.REDIS_URL, {
    maxRetriesPerRequest: opts.maxRetriesPerRequest !== undefined ? opts.maxRetriesPerRequest : 3,
    retryStrategy,
  });
}

export { parseSentinelHosts };
