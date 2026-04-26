/**
 * Lazy, reloadable wrapper around TwilioVoiceService.
 *
 * Why this exists
 * ───────────────
 * TwilioVoiceService used to be instantiated once at boot from `process.env`.
 * That made the wizard a lie: a non-dev consumer could paste Twilio creds
 * into the integrations page, but the service was already built (or
 * permanently disabled) and never re-read the new values. See issue #44.
 *
 * The provider:
 *   - Reads creds from `IntegrationConnection` (DB) for the configured tenant
 *   - Falls back to env vars if the DB has no entry (preserves existing
 *     self-hosters who set their creds in `.env` at install time)
 *   - Rebuilds the underlying service only when creds actually change, so
 *     in-flight call tracking (activeCalls, callsByMeeting maps inside
 *     TwilioVoiceService) survives unrelated settings saves
 *   - Returns null when no creds are available — callers must handle this
 *     and 503 the request rather than crash
 *
 * Settings UI flow
 * ────────────────
 * After IntegrationConnectionService.connect('twilio', {...}) returns, the
 * settings route should call provider.reload() so subsequent /voice-join
 * and /webhooks/twilio/* calls see the new creds without a restart.
 */

import { createChildLogger } from '../../lib/logger.js';
import type { Redis } from 'ioredis';
import {
  TwilioVoiceService,
  type TwilioVoiceConfig,
} from './twilio-voice.service.js';

const logger = createChildLogger({ service: 'TwilioVoiceProvider' });

/**
 * Subset of IntegrationConnectionService that the provider needs.
 * Defined as an interface so tests can pass a fake without dragging in
 * the encryption helper or a real Prisma client.
 */
export interface IntegrationConnectionLookup {
  getDecryptedCredentials(
    tenantId: string,
    name: 'twilio',
  ): Promise<Record<string, unknown> | null>;
}

/**
 * Env-style fallback creds. Optional fields so tests can construct a
 * provider with zero env wiring; fields use the Workforce0 env-var names
 * (TWILIO_ACCOUNT_SID etc.) but are stripped of the prefix for clarity.
 */
export interface TwilioEnvFallback {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  WEBHOOK_BASE_URL?: string;
}

export interface TwilioVoiceProviderOptions {
  /**
   * The tenant whose Twilio creds this provider serves. Single-tenant
   * self-hosted installs use 'default'. Per-tenant SaaS deployments would
   * instantiate one provider per tenant — out of scope for the current
   * single-org product.
   */
  tenantId: string;
  integrationConnectionService: IntegrationConnectionLookup;
  envCreds: TwilioEnvFallback;
  /**
   * Optional Redis used by TwilioVoiceService for crash-recovery state.
   * Forwarded into each rebuilt instance.
   */
  redis?: Redis | null;
}

/**
 * Compact identifier the provider uses to detect cred drift between
 * reload() calls. Build it from the four config-affecting fields.
 *
 * We deliberately don't hash — storing the auth token in a hash would just
 * obscure a log line. The provider instance is process-local; if you can
 * read its memory you can already read process.env.
 */
function fingerprint(c: TwilioVoiceConfig | null): string {
  if (!c) return '';
  return [c.accountSid, c.authToken, c.phoneNumber, c.webhookBaseUrl].join('|');
}

function pickFromDb(creds: Record<string, unknown> | null): TwilioVoiceConfig | null {
  if (!creds) return null;
  // Field names match what IntegrationConnectionService stores when the
  // settings UI saves Twilio creds (see settings.routes.ts twilio test
  // handler — uses twilioAccountSid / twilioAuthToken). webhookBaseUrl is
  // tenant-scoped here because each tenant might run behind a different
  // public hostname (e.g. their own Cloudflare tunnel).
  //
  // Reject empty strings the same way pickFromEnv does — the integrations
  // UI may persist a partially-filled form, and a service built from
  // empty creds will 401 on every Twilio API call instead of failing
  // closed at boot.
  const accountSid = creds.twilioAccountSid;
  const authToken = creds.twilioAuthToken;
  const phoneNumber = creds.twilioPhoneNumber;
  const webhookBaseUrl = creds.webhookBaseUrl;
  const allFilled =
    typeof accountSid === 'string' && accountSid.length > 0 &&
    typeof authToken === 'string' && authToken.length > 0 &&
    typeof phoneNumber === 'string' && phoneNumber.length > 0 &&
    typeof webhookBaseUrl === 'string' && webhookBaseUrl.length > 0;
  if (!allFilled) return null;
  return {
    accountSid: accountSid as string,
    authToken: authToken as string,
    phoneNumber: phoneNumber as string,
    webhookBaseUrl: webhookBaseUrl as string,
  };
}

function pickFromEnv(env: TwilioEnvFallback): TwilioVoiceConfig | null {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, WEBHOOK_BASE_URL } = env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !WEBHOOK_BASE_URL) {
    return null;
  }
  return {
    accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN,
    phoneNumber: TWILIO_PHONE_NUMBER,
    webhookBaseUrl: WEBHOOK_BASE_URL,
  };
}

export class TwilioVoiceProvider {
  private readonly opts: TwilioVoiceProviderOptions;
  private current: TwilioVoiceService | null = null;
  private currentFingerprint = '';

  constructor(opts: TwilioVoiceProviderOptions) {
    this.opts = opts;
  }

  /**
   * Re-read creds from the integration connection (or env fallback) and
   * rebuild the underlying service if they've changed. Safe to call from
   * boot, settings save handlers, or background reconcile jobs.
   *
   * Resolves a boolean indicating whether the underlying service changed
   * identity (useful for log "Twilio reloaded" markers).
   */
  async reload(): Promise<boolean> {
    const fromDb = await this.opts.integrationConnectionService
      .getDecryptedCredentials(this.opts.tenantId, 'twilio')
      .catch((err) => {
        logger.error(
          { err: (err as Error).message, tenantId: this.opts.tenantId },
          'Failed to read Twilio creds from IntegrationConnection — falling back to env',
        );
        return null;
      });

    // Resolve in two steps so the log can report which branch actually
    // produced the config — DB record may exist but be partially filled,
    // in which case we silently fall through to env. Reporting "source:
    // integration_connection" in that case would be a lie (and confused
    // a Cubic review on PR #45).
    const fromDbConfig = pickFromDb(fromDb);
    const next = fromDbConfig ?? pickFromEnv(this.opts.envCreds);
    const source: 'integration_connection' | 'env_fallback' | 'none' =
      fromDbConfig ? 'integration_connection' : next ? 'env_fallback' : 'none';
    const nextFp = fingerprint(next);

    if (nextFp === this.currentFingerprint) {
      return false; // no change — keep existing instance + its activeCalls
    }

    this.current = next
      ? new TwilioVoiceService({ ...next, redis: this.opts.redis ?? undefined })
      : null;
    this.currentFingerprint = nextFp;
    logger.info(
      {
        tenantId: this.opts.tenantId,
        configured: this.current !== null,
        source,
      },
      'Twilio voice service reloaded',
    );
    return true;
  }

  /**
   * Returns the current service or null if unconfigured. Synchronous —
   * callers should have called reload() at boot or after a settings change.
   * The cost of the async path was deliberately pushed into reload() so
   * route handlers don't pay it on every Twilio webhook hit.
   */
  getCurrent(): TwilioVoiceService | null {
    return this.current;
  }

  /**
   * Auth token for inbound webhook signature verification.
   *
   * The inbound voice-intake route (`/webhooks/twilio/voice/inbound`) calls
   * `twilio.validateRequest(authToken, signature, url, params)` per request.
   * That used to read `process.env.TWILIO_AUTH_TOKEN` directly, which made
   * the wizard's "rotate Twilio creds" flow a lie until the next restart.
   *
   * Falls back to env when the provider has no instance — for self-hosters
   * who set creds in `.env` and never bothered with the integrations UI.
   */
  getAuthToken(): string | null {
    return this.current?.getAuthToken() ?? this.opts.envCreds.TWILIO_AUTH_TOKEN ?? null;
  }
}
