/**
 * CallerAuthService — caller-ID allowlist + PIN authentication for inbound voice.
 *
 * @module services/voice-provider/caller-auth.service
 */

import argon2 from 'argon2';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';
import type { CallerCheckResult } from './voice-provider.types.js';
import type { PinRateLimiter } from './pin-rate-limiter.js';

const logger = createChildLogger({ service: 'CallerAuthService' });

export class CallerAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly rateLimiter: PinRateLimiter,
  ) {}

  async checkCallerId(tenantId: string, fromNumber: string): Promise<CallerCheckResult> {
    // Twilio normally sends `From` as an E.164 string, but a malformed payload
    // (or a future caller passing a non-string) would crash on `.trim()` here.
    // Treat anything that isn't a non-empty string as "not configured" so the
    // route returns <Hangup/> instead of leaking a 500 to the caller.
    const trimmed =
      typeof fromNumber === 'string' && fromNumber.length > 0
        ? fromNumber.trim()
        : '';
    if (trimmed === '') return 'not_configured';

    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings) return 'not_configured';
    const hasAllowlist = settings.voiceCallerAllowlist.length > 0;
    const hasPin = !!settings.voicePinHash;
    if (!hasAllowlist && !hasPin) return 'not_configured';
    if (hasAllowlist && settings.voiceCallerAllowlist.includes(trimmed)) {
      return 'allowed';
    }
    if (hasPin) return 'needs_pin';
    return 'not_configured';
  }

  async verifyPin(tenantId: string, pin: string, fromNumber: string): Promise<boolean> {
    if (await this.rateLimiter.isBlocked(tenantId, fromNumber)) {
      logger.warn({ tenantId, fromNumber }, 'PIN attempt blocked by rate limiter');
      return false;
    }
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings?.voicePinHash) return false;
    let ok: boolean;
    try {
      ok = await argon2.verify(settings.voicePinHash, pin);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'argon2 verify threw');
      ok = false;
    }
    if (!ok) await this.rateLimiter.recordFailure(tenantId, fromNumber);
    return ok;
  }
}
