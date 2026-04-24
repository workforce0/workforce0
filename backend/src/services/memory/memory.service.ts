// =============================================================================
// Memory Service — 4-Tier Hierarchy (Hot/Warm/Long-Term/Archive)
// =============================================================================
//
// Tier 1 (Hot):       Redis cache — 30min TTL, instant recall
// Tier 2 (Warm):      PostgreSQL — persistent storage, cache-through on miss
// Tier 3 (Long-term): Future — vector embeddings for semantic search
// Tier 4 (Archive):   Future — compressed cold storage
//
// Current implementation covers Tiers 1 & 2.

import { logger } from '../../lib/logger.js';
import type { MemoryEntry, MemoryCategory } from './types.js';

const log = logger.child({ service: 'MemoryService' });

/** Redis TTL for hot-tier entries (30 minutes) */
const HOT_TTL_SECONDS = 1800;

/** Default limit for context retrieval */
const DEFAULT_CONTEXT_LIMIT = 50;

interface GetContextOptions {
  categories?: MemoryCategory[];
  limit?: number;
}

export class MemoryService {
  private prisma: any;
  private redis: any;

  constructor(prisma: any, redis: any) {
    this.prisma = prisma;
    this.redis = redis;
  }

  /**
   * Build the Redis key for a memory entry.
   * Format: mem:{tenantId}:{category}:{key}
   */
  private redisKey(tenantId: string, category: string, key: string): string {
    return `mem:${tenantId}:${category}:${key}`;
  }

  /**
   * Store a memory in both hot tier (Redis) and warm tier (PostgreSQL).
   */
  async remember(tenantId: string, entry: MemoryEntry): Promise<void> {
    const rKey = this.redisKey(tenantId, entry.category, entry.key);

    log.debug({ tenantId, category: entry.category, key: entry.key }, 'Storing memory');

    // Hot tier: Redis with 30min TTL
    await this.redis.set(rKey, JSON.stringify(entry.value), 'EX', HOT_TTL_SECONDS);

    // Warm tier: PostgreSQL upsert
    await this.prisma.tenantMemory.upsert({
      where: {
        tenantId_category_key: {
          tenantId,
          category: entry.category,
          key: entry.key,
        },
      },
      create: {
        tenantId,
        category: entry.category,
        key: entry.key,
        value: entry.value,
        source: entry.source,
        confidence: entry.confidence,
      },
      update: {
        value: entry.value,
        source: entry.source,
        confidence: entry.confidence,
      },
    });

    log.info({ tenantId, category: entry.category, key: entry.key }, 'Memory stored in hot + warm tiers');
  }

  /**
   * Recall a memory. Checks hot tier (Redis) first, falls through to
   * warm tier (PostgreSQL) on cache miss, and re-populates Redis on hit.
   */
  async recall(tenantId: string, category: string, key: string): Promise<unknown | null> {
    const rKey = this.redisKey(tenantId, category, key);

    // Tier 1: Check Redis (hot)
    const cached = await this.redis.get(rKey);
    if (cached !== null) {
      log.debug({ tenantId, category, key }, 'Memory recalled from hot tier');
      return JSON.parse(cached);
    }

    // Tier 2: Fall through to PostgreSQL (warm)
    const record = await this.prisma.tenantMemory.findFirst({
      where: { tenantId, category, key },
    });

    if (!record) {
      log.debug({ tenantId, category, key }, 'Memory not found in any tier');
      return null;
    }

    // Re-populate hot tier
    await this.redis.set(rKey, JSON.stringify(record.value), 'EX', HOT_TTL_SECONDS);

    // Track access count
    await this.prisma.tenantMemory.update({
      where: { id: record.id },
      data: {
        accessCount: { increment: 1 },
        lastAccessed: new Date(),
      },
    });

    log.debug({ tenantId, category, key }, 'Memory recalled from warm tier, promoted to hot');
    return record.value;
  }

  /**
   * Retrieve all memories for a tenant, optionally filtered by categories.
   * Returns entries ordered by confidence (descending).
   */
  async getContext(tenantId: string, options?: GetContextOptions): Promise<MemoryEntry[]> {
    const { categories, limit = DEFAULT_CONTEXT_LIMIT } = options ?? {};

    const where: any = { tenantId };
    if (categories && categories.length > 0) {
      where.category = { in: categories };
    }

    const records = await this.prisma.tenantMemory.findMany({
      where,
      orderBy: { confidence: 'desc' },
      take: limit,
    });

    log.debug({ tenantId, count: records.length }, 'Context memories retrieved');

    return records.map((r: any) => ({
      key: r.key,
      category: r.category,
      value: r.value,
      source: r.source,
      confidence: r.confidence,
    }));
  }

  /**
   * Forget a memory from both hot (Redis) and warm (PostgreSQL) tiers.
   */
  async forget(tenantId: string, category: string, key: string): Promise<void> {
    const rKey = this.redisKey(tenantId, category, key);

    log.debug({ tenantId, category, key }, 'Forgetting memory');

    await this.redis.del(rKey);
    await this.prisma.tenantMemory.deleteMany({
      where: { tenantId, category, key },
    });

    log.info({ tenantId, category, key }, 'Memory forgotten from all tiers');
  }
}
