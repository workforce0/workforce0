/**
 * =============================================================================
 * CREDENTIAL POOL — round-robin rotation across multiple provider API keys
 * =============================================================================
 *
 * Ported (algorithm only) from NousResearch/hermes-agent `agent/credential_pool.py`.
 *
 * Users at scale often have multiple keys per provider to survive per-key
 * rate limits. This class lets them register N keys for a provider and
 * hands them out round-robin, marking keys as "cooldown" when a 429 or
 * quota error comes back.
 *
 * @module services/model-registry/credential-pool
 */

import { createChildLogger } from '../../lib/logger.js';

const COOLDOWN_MS = 60 * 1000; // default 1 min after a rate-limit

interface PoolEntry {
  key: string;
  cooldownUntil: number; // ms epoch; 0 = available
  lastUsedAt: number;
  consecutiveFailures: number;
}

export class CredentialPool {
  private readonly logger = createChildLogger({ service: 'CredentialPool' });
  private readonly pools = new Map<string, PoolEntry[]>();
  private readonly cursors = new Map<string, number>();

  /**
   * Register a set of keys for a provider. Subsequent calls replace the
   * pool for that provider (useful on config reload).
   */
  set(provider: string, keys: string[]): void {
    const filtered = keys.map((k) => k.trim()).filter((k) => k.length > 0);
    if (filtered.length === 0) {
      this.pools.delete(provider);
      this.cursors.delete(provider);
      return;
    }
    this.pools.set(
      provider,
      filtered.map((key) => ({ key, cooldownUntil: 0, lastUsedAt: 0, consecutiveFailures: 0 })),
    );
    this.cursors.set(provider, 0);
    this.logger.info('Credential pool set', { provider, size: filtered.length });
  }

  /**
   * Get the next available key for a provider. Returns null if no keys
   * are available (either none registered or all in cooldown).
   */
  next(provider: string): string | null {
    const pool = this.pools.get(provider);
    if (!pool || pool.length === 0) return null;

    const now = Date.now();
    let cursor = this.cursors.get(provider) ?? 0;

    for (let i = 0; i < pool.length; i++) {
      const entry = pool[cursor % pool.length]!;
      cursor += 1;
      if (entry.cooldownUntil <= now) {
        entry.lastUsedAt = now;
        this.cursors.set(provider, cursor % pool.length);
        return entry.key;
      }
    }

    // All in cooldown — pick the one that cools down soonest
    this.logger.warn('All pool keys in cooldown', { provider });
    const soonest = pool.reduce((acc, e) => (e.cooldownUntil < acc.cooldownUntil ? e : acc), pool[0]!);
    return soonest.key;
  }

  /**
   * Mark a key as rate-limited. Exponential backoff based on recent failures
   * (1 min, 2 min, 4 min, capped at 15 min).
   */
  markRateLimited(provider: string, key: string): void {
    const pool = this.pools.get(provider);
    if (!pool) return;
    const entry = pool.find((e) => e.key === key);
    if (!entry) return;
    entry.consecutiveFailures = Math.min(4, entry.consecutiveFailures + 1);
    const cooldown = Math.min(15 * 60 * 1000, COOLDOWN_MS * Math.pow(2, entry.consecutiveFailures - 1));
    entry.cooldownUntil = Date.now() + cooldown;
    this.logger.info('Key cooled down', {
      provider,
      cooldownMs: cooldown,
      failures: entry.consecutiveFailures,
    });
  }

  /**
   * Reset failure counter on a successful call (sticky cooldowns stay).
   */
  markSuccess(provider: string, key: string): void {
    const pool = this.pools.get(provider);
    if (!pool) return;
    const entry = pool.find((e) => e.key === key);
    if (entry) entry.consecutiveFailures = 0;
  }

  /** Observability hook — how many keys per provider are available right now. */
  availability(): Record<string, { total: number; available: number }> {
    const now = Date.now();
    const out: Record<string, { total: number; available: number }> = {};
    for (const [provider, pool] of this.pools.entries()) {
      out[provider] = {
        total: pool.length,
        available: pool.filter((e) => e.cooldownUntil <= now).length,
      };
    }
    return out;
  }
}
