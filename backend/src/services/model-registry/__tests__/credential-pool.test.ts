import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CredentialPool } from '../credential-pool.js';

describe('CredentialPool', () => {
  let pool: CredentialPool;

  beforeEach(() => {
    pool = new CredentialPool();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null with no keys registered', () => {
    expect(pool.next('anthropic')).toBeNull();
  });

  it('rotates keys round-robin', () => {
    pool.set('anthropic', ['k1', 'k2', 'k3']);
    const hands = [pool.next('anthropic'), pool.next('anthropic'), pool.next('anthropic'), pool.next('anthropic')];
    expect(hands).toEqual(['k1', 'k2', 'k3', 'k1']);
  });

  it('skips a rate-limited key during cooldown', () => {
    pool.set('anthropic', ['k1', 'k2']);
    pool.markRateLimited('anthropic', 'k1');
    // k1 is in cooldown — cursor should advance past it
    const a = pool.next('anthropic');
    const b = pool.next('anthropic');
    expect([a, b]).not.toContain('k1');
  });

  it('returns a cooled-down key after the window passes', () => {
    pool.set('anthropic', ['k1']);
    pool.markRateLimited('anthropic', 'k1');
    vi.advanceTimersByTime(61_000);
    expect(pool.next('anthropic')).toBe('k1');
  });

  it('uses exponential backoff for repeat failures on the same key', () => {
    pool.set('anthropic', ['k1']);
    pool.markRateLimited('anthropic', 'k1');
    // after 1 min, first cooldown expired
    vi.advanceTimersByTime(61_000);
    pool.markRateLimited('anthropic', 'k1');
    // second failure gives 2-minute cooldown; advancing 1 min is not enough
    vi.advanceTimersByTime(61_000);
    // now 2 min passed total since the second mark; still not available
    // (second cooldown was 2 min, and we only advanced 1 min after it started)
    const snapshot = pool.availability();
    expect(snapshot.anthropic.available).toBe(0);
  });

  it('resets failure counter on markSuccess', () => {
    pool.set('anthropic', ['k1']);
    pool.markRateLimited('anthropic', 'k1');
    pool.markSuccess('anthropic', 'k1');
    pool.markRateLimited('anthropic', 'k1');
    // second cooldown should still be 1 min (since counter reset to 0, bumped to 1)
    vi.advanceTimersByTime(61_000);
    expect(pool.next('anthropic')).toBe('k1');
  });

  it('returns soonest-to-cool key when everything is in cooldown', () => {
    pool.set('anthropic', ['k1', 'k2']);
    pool.markRateLimited('anthropic', 'k1');
    vi.advanceTimersByTime(1_000);
    pool.markRateLimited('anthropic', 'k2');
    // k1 cools first — after ~59s of k1's cooldown, should be returned
    const key = pool.next('anthropic');
    expect(key).toBe('k1');
  });

  it('availability() reports counts per provider', () => {
    pool.set('anthropic', ['a1', 'a2']);
    pool.set('openai', ['o1']);
    pool.markRateLimited('anthropic', 'a1');
    expect(pool.availability()).toEqual({
      anthropic: { total: 2, available: 1 },
      openai: { total: 1, available: 1 },
    });
  });
});
