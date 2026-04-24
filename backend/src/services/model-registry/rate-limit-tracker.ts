/**
 * =============================================================================
 * RATE-LIMIT TRACKER — cross-request 429/5xx handling with circuit break
 * =============================================================================
 *
 * Ported (algorithm only) from NousResearch/hermes-agent
 * `agent/rate_limit_tracker.py` + `agent/nous_rate_guard.py` + their retry
 * helpers.
 *
 * Tracks per-provider error windows. When a provider is "hot" (many recent
 * 429s or 5xxs), callers should back off entirely rather than keep hitting
 * the API — which just worsens the rate-limit window.
 *
 * Complements CredentialPool: the pool rotates individual keys, this tracks
 * whether the whole provider is effectively unavailable.
 *
 * @module services/model-registry/rate-limit-tracker
 */

import { createChildLogger } from '../../lib/logger.js';

export type ErrorCategory = 'rate_limit' | 'server_error' | 'timeout' | 'other';

export interface RateLimitSnapshot {
  provider: string;
  state: 'healthy' | 'throttled' | 'circuit_open';
  recentErrors: number;
  nextRetryAt: number | null;
}

interface TrackerEntry {
  errors: Array<{ category: ErrorCategory; at: number }>;
  circuitOpenUntil: number;
}

const WINDOW_MS = 60 * 1000;
const THROTTLE_THRESHOLD = 3;
const CIRCUIT_THRESHOLD = 6;
const CIRCUIT_OPEN_MS = 30 * 1000;

/**
 * Classify an HTTP error into one of our four categories. Returns null
 * when the error isn't rate-limit-y (caller should not call noteError).
 */
export function classifyError(err: unknown): ErrorCategory | null {
  if (!err || typeof err !== 'object') return null;
  const any = err as Record<string, unknown>;
  const status = Number(any.status ?? any.statusCode ?? 0);
  const code = String(any.code ?? '');
  const message = String((any.message as string) ?? '').toLowerCase();

  if (status === 429 || code === 'rate_limit_exceeded' || message.includes('rate limit')) {
    return 'rate_limit';
  }
  if (status >= 500 && status < 600) return 'server_error';
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED' || message.includes('timeout')) {
    return 'timeout';
  }
  if (status >= 400 && status < 500) {
    // 4xx other than 429 are caller errors — not rate-limit signals
    return null;
  }
  return 'other';
}

export class RateLimitTracker {
  private readonly logger = createChildLogger({ service: 'RateLimitTracker' });
  private readonly entries = new Map<string, TrackerEntry>();

  /**
   * Record an error for a provider. Caller runs after catching an API error.
   */
  noteError(provider: string, category: ErrorCategory): void {
    const entry = this.entry(provider);
    const now = Date.now();
    entry.errors.push({ category, at: now });
    this.evictOld(entry, now);

    if (entry.errors.length >= CIRCUIT_THRESHOLD && entry.circuitOpenUntil < now) {
      entry.circuitOpenUntil = now + CIRCUIT_OPEN_MS;
      this.logger.warn('Circuit opened', { provider, errors: entry.errors.length });
    }
  }

  /** Reset the error window on a successful call. */
  noteSuccess(provider: string): void {
    const entry = this.entries.get(provider);
    if (!entry) return;
    entry.errors = [];
    entry.circuitOpenUntil = 0;
  }

  /**
   * True when callers should defer the call entirely (circuit open). Use
   * to fail fast without touching the network.
   */
  isCircuitOpen(provider: string): boolean {
    const entry = this.entries.get(provider);
    if (!entry) return false;
    return entry.circuitOpenUntil > Date.now();
  }

  /**
   * Suggested backoff in ms before the next retry for this provider.
   * Exponential growth: 0 / 500ms / 1s / 2s / 4s / 8s with jitter.
   */
  suggestedBackoffMs(provider: string, attempt: number): number {
    if (attempt <= 0) return 0;
    const base = 500 * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * Math.min(base, 500));
    return Math.min(30_000, base + jitter);
  }

  /** Observability snapshot used by health endpoints + dashboards. */
  snapshot(provider: string): RateLimitSnapshot {
    const entry = this.entries.get(provider);
    const now = Date.now();
    if (!entry) {
      return { provider, state: 'healthy', recentErrors: 0, nextRetryAt: null };
    }
    this.evictOld(entry, now);
    const state =
      entry.circuitOpenUntil > now
        ? 'circuit_open'
        : entry.errors.length >= THROTTLE_THRESHOLD
          ? 'throttled'
          : 'healthy';
    return {
      provider,
      state,
      recentErrors: entry.errors.length,
      nextRetryAt: entry.circuitOpenUntil > now ? entry.circuitOpenUntil : null,
    };
  }

  private entry(provider: string): TrackerEntry {
    let e = this.entries.get(provider);
    if (!e) {
      e = { errors: [], circuitOpenUntil: 0 };
      this.entries.set(provider, e);
    }
    return e;
  }

  private evictOld(entry: TrackerEntry, now: number): void {
    entry.errors = entry.errors.filter((e) => now - e.at < WINDOW_MS);
  }
}
