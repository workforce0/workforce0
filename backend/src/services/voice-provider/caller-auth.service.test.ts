import { describe, it, expect, vi } from 'vitest';
import argon2 from 'argon2';
import { CallerAuthService } from './caller-auth.service.js';
import type { PinRateLimiter } from './pin-rate-limiter.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const buildPrisma = (settings: { voiceCallerAllowlist: string[]; voicePinHash: string | null } | null) => ({
  tenantSettings: { findUnique: vi.fn().mockResolvedValue(settings) },
});

const buildLimiter = (blocked = false): PinRateLimiter => ({
  isBlocked: vi.fn().mockResolvedValue(blocked),
  recordFailure: vi.fn().mockResolvedValue(undefined),
} as unknown as PinRateLimiter);

describe('CallerAuthService.checkCallerId', () => {
  it('returns not_configured when tenant has no row', async () => {
    const svc = new CallerAuthService(buildPrisma(null) as any, buildLimiter());
    expect(await svc.checkCallerId('t1', '+15551234567')).toBe('not_configured');
  });

  it('returns not_configured when allowlist is empty AND no PIN hash', async () => {
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: [], voicePinHash: null }) as any, buildLimiter());
    expect(await svc.checkCallerId('t1', '+15551234567')).toBe('not_configured');
  });

  it('returns allowed when caller is on allowlist', async () => {
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: ['+15551234567'], voicePinHash: null }) as any, buildLimiter());
    expect(await svc.checkCallerId('t1', '+15551234567')).toBe('allowed');
  });

  it('returns needs_pin when caller is NOT on allowlist but PIN is configured', async () => {
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: ['+15559999999'], voicePinHash: 'hash' }) as any, buildLimiter());
    expect(await svc.checkCallerId('t1', '+15551234567')).toBe('needs_pin');
  });
});

describe('CallerAuthService.verifyPin', () => {
  it('returns false when PIN is not configured', async () => {
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: [], voicePinHash: null }) as any, buildLimiter());
    expect(await svc.verifyPin('t1', '1234', '+15551234567')).toBe(false);
  });

  it('returns false when caller is rate-limited', async () => {
    const hash = await argon2.hash('1234');
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: [], voicePinHash: hash }) as any, buildLimiter(true));
    expect(await svc.verifyPin('t1', '1234', '+15551234567')).toBe(false);
  });

  it('returns true on PIN match', async () => {
    const hash = await argon2.hash('1234');
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: [], voicePinHash: hash }) as any, buildLimiter());
    expect(await svc.verifyPin('t1', '1234', '+15551234567')).toBe(true);
  });

  it('returns false + records failure on PIN mismatch', async () => {
    const hash = await argon2.hash('1234');
    const limiter = buildLimiter();
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: [], voicePinHash: hash }) as any, limiter);
    expect(await svc.verifyPin('t1', '9999', '+15551234567')).toBe(false);
    expect(limiter.recordFailure).toHaveBeenCalledWith('t1', '+15551234567');
  });
});
