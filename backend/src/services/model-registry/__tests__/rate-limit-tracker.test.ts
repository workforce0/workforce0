import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimitTracker, classifyError } from '../rate-limit-tracker.js';

describe('classifyError', () => {
  it('classifies 429 as rate_limit', () => {
    expect(classifyError({ status: 429 })).toBe('rate_limit');
    expect(classifyError({ statusCode: 429 })).toBe('rate_limit');
    expect(classifyError({ code: 'rate_limit_exceeded' })).toBe('rate_limit');
    expect(classifyError({ message: 'You have hit the rate limit' })).toBe('rate_limit');
  });

  it('classifies 5xx as server_error', () => {
    expect(classifyError({ status: 500 })).toBe('server_error');
    expect(classifyError({ statusCode: 502 })).toBe('server_error');
    expect(classifyError({ status: 599 })).toBe('server_error');
  });

  it('classifies timeouts', () => {
    expect(classifyError({ code: 'ETIMEDOUT' })).toBe('timeout');
    expect(classifyError({ code: 'ECONNABORTED' })).toBe('timeout');
    expect(classifyError({ message: 'Request timeout after 30s' })).toBe('timeout');
  });

  it('returns null for 4xx non-429 (caller errors)', () => {
    expect(classifyError({ status: 400 })).toBeNull();
    expect(classifyError({ status: 404 })).toBeNull();
    expect(classifyError({ status: 422 })).toBeNull();
  });

  it('returns null for non-error inputs', () => {
    expect(classifyError(null)).toBeNull();
    expect(classifyError(undefined)).toBeNull();
    expect(classifyError('string')).toBeNull();
  });
});

describe('RateLimitTracker', () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts healthy', () => {
    expect(tracker.snapshot('anthropic').state).toBe('healthy');
    expect(tracker.isCircuitOpen('anthropic')).toBe(false);
  });

  it('moves to throttled after 3 errors inside the window', () => {
    for (let i = 0; i < 3; i++) tracker.noteError('anthropic', 'rate_limit');
    expect(tracker.snapshot('anthropic').state).toBe('throttled');
  });

  it('opens the circuit after 6 errors', () => {
    for (let i = 0; i < 6; i++) tracker.noteError('anthropic', 'rate_limit');
    expect(tracker.isCircuitOpen('anthropic')).toBe(true);
    expect(tracker.snapshot('anthropic').state).toBe('circuit_open');
  });

  it('closes the circuit after the cooldown window', () => {
    for (let i = 0; i < 6; i++) tracker.noteError('anthropic', 'rate_limit');
    vi.advanceTimersByTime(31_000);
    expect(tracker.isCircuitOpen('anthropic')).toBe(false);
  });

  it('evicts errors older than the rolling window', () => {
    for (let i = 0; i < 3; i++) tracker.noteError('anthropic', 'rate_limit');
    vi.advanceTimersByTime(61_000);
    expect(tracker.snapshot('anthropic').recentErrors).toBe(0);
    expect(tracker.snapshot('anthropic').state).toBe('healthy');
  });

  it('noteSuccess clears errors and re-closes the circuit', () => {
    for (let i = 0; i < 6; i++) tracker.noteError('anthropic', 'rate_limit');
    expect(tracker.isCircuitOpen('anthropic')).toBe(true);
    tracker.noteSuccess('anthropic');
    expect(tracker.isCircuitOpen('anthropic')).toBe(false);
    expect(tracker.snapshot('anthropic').recentErrors).toBe(0);
  });

  it('suggestedBackoffMs grows exponentially with jitter', () => {
    const a = tracker.suggestedBackoffMs('anthropic', 1);
    const b = tracker.suggestedBackoffMs('anthropic', 2);
    const c = tracker.suggestedBackoffMs('anthropic', 3);
    expect(a).toBeGreaterThanOrEqual(500);
    expect(a).toBeLessThan(1100);
    expect(b).toBeGreaterThanOrEqual(1000);
    expect(c).toBeGreaterThanOrEqual(2000);
  });

  it('caps backoff at 30s', () => {
    const huge = tracker.suggestedBackoffMs('anthropic', 20);
    expect(huge).toBeLessThanOrEqual(30_000);
  });

  it('tracks providers independently', () => {
    for (let i = 0; i < 6; i++) tracker.noteError('anthropic', 'rate_limit');
    expect(tracker.isCircuitOpen('anthropic')).toBe(true);
    expect(tracker.isCircuitOpen('openai')).toBe(false);
  });
});
