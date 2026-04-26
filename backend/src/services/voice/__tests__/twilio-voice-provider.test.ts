/**
 * Tests for TwilioVoiceProvider — the lazy, reloadable wrapper around
 * TwilioVoiceService that reads creds from IntegrationConnection (DB) instead
 * of process.env at boot.
 *
 * The contract this pins:
 *   - getCurrent() returns null when no creds anywhere (env or DB)
 *   - getCurrent() returns a working service when DB has creds
 *   - getCurrent() falls back to env when DB has nothing (backwards compat)
 *   - reload() rebuilds the service when creds change in DB
 *   - reload() preserves the existing service when creds are unchanged
 *     (so in-flight call-tracking state isn't lost on irrelevant settings saves)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TwilioVoiceProvider } from '../twilio-voice-provider.js';
import { TwilioVoiceService } from '../twilio-voice.service.js';

// Mock the twilio SDK so we don't hit network
vi.mock('twilio', () => {
  const mockClient = { calls: { create: vi.fn() }, calls_get: vi.fn() };
  const Twilio = vi.fn(() => mockClient);
  return { default: Twilio, Twilio };
});

interface FakeIntegrationConnectionService {
  getDecryptedCredentials: ReturnType<typeof vi.fn>;
}

function makeFakeIcs(initialCreds: Record<string, unknown> | null = null): FakeIntegrationConnectionService {
  return {
    getDecryptedCredentials: vi.fn().mockResolvedValue(initialCreds),
  };
}

const ENV_DEFAULTS = {
  TWILIO_ACCOUNT_SID: 'AC_env_sid',
  TWILIO_AUTH_TOKEN: 'env_token',
  TWILIO_PHONE_NUMBER: '+15551111111',
  WEBHOOK_BASE_URL: 'https://env-host.example.com',
};

const DB_CREDS = {
  twilioAccountSid: 'AC_db_sid',
  twilioAuthToken: 'db_token',
  twilioPhoneNumber: '+15552222222',
  webhookBaseUrl: 'https://db-host.example.com',
};

describe('TwilioVoiceProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when neither DB nor env has creds', async () => {
    const ics = makeFakeIcs(null);
    const provider = new TwilioVoiceProvider({
      tenantId: 'default',
      integrationConnectionService: ics as never,
      envCreds: {},
    });
    await provider.reload();
    expect(provider.getCurrent()).toBeNull();
  });

  it('builds from env when DB has no creds (backwards compat for self-hosters)', async () => {
    const ics = makeFakeIcs(null);
    const provider = new TwilioVoiceProvider({
      tenantId: 'default',
      integrationConnectionService: ics as never,
      envCreds: ENV_DEFAULTS,
    });
    await provider.reload();
    const svc = provider.getCurrent();
    expect(svc).toBeInstanceOf(TwilioVoiceService);
    expect(svc?.isAvailable()).toBe(true);
  });

  it('prefers DB creds over env when both are present', async () => {
    const ics = makeFakeIcs(DB_CREDS);
    const provider = new TwilioVoiceProvider({
      tenantId: 'default',
      integrationConnectionService: ics as never,
      envCreds: ENV_DEFAULTS,
    });
    await provider.reload();
    const svc = provider.getCurrent();
    expect(svc).toBeInstanceOf(TwilioVoiceService);
    // Phone number should come from DB, not env. Check via the public getter
    // we'll add as part of this slice.
    expect(svc?.getPhoneNumber()).toBe('+15552222222');
  });

  it('rebuilds the service when DB creds change between reload() calls', async () => {
    const ics = makeFakeIcs(DB_CREDS);
    const provider = new TwilioVoiceProvider({
      tenantId: 'default',
      integrationConnectionService: ics as never,
      envCreds: {},
    });
    await provider.reload();
    const first = provider.getCurrent();
    expect(first?.getPhoneNumber()).toBe('+15552222222');

    // Simulate operator updating creds in the integrations UI
    ics.getDecryptedCredentials.mockResolvedValueOnce({
      ...DB_CREDS,
      twilioPhoneNumber: '+15553333333',
    });
    await provider.reload();
    const second = provider.getCurrent();
    expect(second?.getPhoneNumber()).toBe('+15553333333');
    expect(second).not.toBe(first); // new instance built
  });

  it('preserves the existing instance when creds are unchanged on reload', async () => {
    const ics = makeFakeIcs(DB_CREDS);
    const provider = new TwilioVoiceProvider({
      tenantId: 'default',
      integrationConnectionService: ics as never,
      envCreds: {},
    });
    await provider.reload();
    const first = provider.getCurrent();
    await provider.reload(); // no change to creds
    const second = provider.getCurrent();
    expect(second).toBe(first); // same instance — in-flight calls survive
  });

  it('exposes the auth token for inbound signature verification', async () => {
    const ics = makeFakeIcs(DB_CREDS);
    const provider = new TwilioVoiceProvider({
      tenantId: 'default',
      integrationConnectionService: ics as never,
      envCreds: ENV_DEFAULTS,
    });
    await provider.reload();
    // DB creds win — that's the expected ordering.
    expect(provider.getAuthToken()).toBe('db_token');
  });

  it('falls back to env auth token when DB has no creds', async () => {
    const ics = makeFakeIcs(null);
    const provider = new TwilioVoiceProvider({
      tenantId: 'default',
      integrationConnectionService: ics as never,
      envCreds: ENV_DEFAULTS,
    });
    await provider.reload();
    expect(provider.getAuthToken()).toBe('env_token');
  });

  it('returns null auth token when neither DB nor env has creds', async () => {
    const ics = makeFakeIcs(null);
    const provider = new TwilioVoiceProvider({
      tenantId: 'default',
      integrationConnectionService: ics as never,
      envCreds: {},
    });
    await provider.reload();
    expect(provider.getAuthToken()).toBeNull();
  });

  it('clears the service when DB creds are removed (operator disconnected Twilio)', async () => {
    const ics = makeFakeIcs(DB_CREDS);
    const provider = new TwilioVoiceProvider({
      tenantId: 'default',
      integrationConnectionService: ics as never,
      envCreds: {},
    });
    await provider.reload();
    expect(provider.getCurrent()).not.toBeNull();

    ics.getDecryptedCredentials.mockResolvedValueOnce(null);
    await provider.reload();
    expect(provider.getCurrent()).toBeNull();
  });
});
