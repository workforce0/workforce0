import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PinRateLimiter } from './pin-rate-limiter.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

interface FakeRedis {
  get(k: string): Promise<string | null>;
  incr(k: string): Promise<number>;
  expire(k: string, sec: number): Promise<void>;
}

const buildRedis = (): FakeRedis => {
  const store = new Map<string, number>();
  return {
    get: async (k) => (store.has(k) ? String(store.get(k)) : null),
    incr: async (k) => { const v = (store.get(k) ?? 0) + 1; store.set(k, v); return v; },
    expire: async () => undefined,
  };
};

describe('PinRateLimiter', () => {
  let redis: FakeRedis;
  let limiter: PinRateLimiter;
  beforeEach(() => { redis = buildRedis(); limiter = new PinRateLimiter(redis as any, 3); });

  it('allows up to 3 attempts', async () => {
    expect(await limiter.isBlocked('t1', '+15551234567')).toBe(false);
    await limiter.recordFailure('t1', '+15551234567');
    expect(await limiter.isBlocked('t1', '+15551234567')).toBe(false);
    await limiter.recordFailure('t1', '+15551234567');
    expect(await limiter.isBlocked('t1', '+15551234567')).toBe(false);
  });

  it('blocks on the 3rd failure', async () => {
    for (let i = 0; i < 3; i++) await limiter.recordFailure('t1', '+15551234567');
    expect(await limiter.isBlocked('t1', '+15551234567')).toBe(true);
  });

  it('isolates per tenant + caller', async () => {
    for (let i = 0; i < 3; i++) await limiter.recordFailure('t1', '+15551234567');
    expect(await limiter.isBlocked('t1', '+15559999999')).toBe(false);
    expect(await limiter.isBlocked('t2', '+15551234567')).toBe(false);
  });
});
