/**
 * Tests for CallContextStore — short-lived in-memory map of CallSid → caller.
 *
 * @module services/voice-provider/call-context.store.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CallContextStore } from './call-context.store.js';

describe('CallContextStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips set → get', () => {
    const s = new CallContextStore();
    s.set('CA1', { fromNumber: '+15551234567', toNumber: '+18001112222', acceptedAt: Date.now() });
    expect(s.get('CA1')?.fromNumber).toBe('+15551234567');
  });

  it('returns null after delete', () => {
    const s = new CallContextStore();
    s.set('CA2', { fromNumber: '+1', toNumber: '+2', acceptedAt: Date.now() });
    s.delete('CA2');
    expect(s.get('CA2')).toBeNull();
  });

  it('returns null and lazy-evicts expired entries', () => {
    const ttlMs = 1000;
    const s = new CallContextStore(ttlMs);
    s.set('CA3', { fromNumber: '+1', toNumber: '+2', acceptedAt: Date.now() });
    vi.advanceTimersByTime(ttlMs + 1);
    expect(s.get('CA3')).toBeNull();
  });

  it('shutdown() clears the sweep interval and empties the map', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const s = new CallContextStore();
    s.set('CA4', { fromNumber: '+1', toNumber: '+2', acceptedAt: Date.now() });
    // First set() starts the sweep timer.
    s.shutdown();
    expect(clearSpy).toHaveBeenCalled();
    // Map cleared — get() returns null even before TTL.
    expect(s.get('CA4')).toBeNull();
    // Subsequent shutdown() is idempotent (no throw).
    expect(() => s.shutdown()).not.toThrow();
  });

  it('shutdown() is safe even when no sweep timer was ever started', () => {
    const s = new CallContextStore();
    // No set() — sweep timer was never started.
    expect(() => s.shutdown()).not.toThrow();
  });
});
