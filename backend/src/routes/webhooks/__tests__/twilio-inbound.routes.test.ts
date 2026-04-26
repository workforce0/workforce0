/**
 * Tests for Twilio inbound + PIN webhooks (voice intake).
 *
 * @module routes/webhooks/__tests__/twilio-inbound.routes.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import { twilioInboundRoutes } from '../twilio-inbound.routes.js';
import { config } from '../../../config/index.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const buildApp = async (overrides?: {
  check?: 'allowed' | 'needs_pin' | 'not_configured';
  verify?: boolean;
  tenantId?: string;
}): Promise<FastifyInstance> => {
  const app = Fastify();
  await app.register(formbody);
  (app as unknown as { services: any }).services = {
    callerAuthService: {
      checkCallerId: vi.fn().mockResolvedValue(overrides?.check ?? 'allowed'),
      verifyPin: vi.fn().mockResolvedValue(overrides?.verify ?? true),
    },
    tenantResolver: {
      resolveTenantByDID: vi.fn().mockResolvedValue(overrides?.tenantId ?? 't1'),
    },
  };
  await app.register(twilioInboundRoutes, { prefix: '/webhooks/twilio/voice' });
  await app.ready();
  return app;
};

describe('POST /webhooks/twilio/voice/inbound', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  it('returns <Connect><Stream> when caller is allowed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.body).toContain('<Connect>');
    expect(res.body).toContain('<Stream');
  });

  it('returns <Gather> when caller needs PIN', async () => {
    const app2 = await buildApp({ check: 'needs_pin' });
    const res = await app2.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15559999999&To=%2B18005551111&CallSid=CA2',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toContain('<Gather');
    expect(res.body).toContain('action="/webhooks/twilio/voice/pin"');
  });

  it('returns <Hangup/> when not configured', async () => {
    const app2 = await buildApp({ check: 'not_configured' });
    const res = await app2.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA3',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toContain('<Hangup');
    expect(res.body).toContain('not configured');
  });
});

describe('POST /webhooks/twilio/voice/pin', () => {
  it('returns <Connect><Stream> on valid PIN', async () => {
    const app = await buildApp({ verify: true });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/pin',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA4&Digits=1234',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toContain('<Connect>');
  });

  it('returns <Hangup/> on invalid PIN', async () => {
    const app = await buildApp({ verify: false });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/pin',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA4&Digits=9999',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toContain('Access denied');
    expect(res.body).toContain('<Hangup');
  });

  it('returns <Hangup/> when no Digits sent (gather timeout)', async () => {
    const app = await buildApp({ verify: true });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/pin',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA5',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toContain('Access denied');
    expect(res.body).toContain('<Hangup');
  });
});

describe('Twilio signature verification gating', () => {
  // The pre-handler reads `config.NODE_ENV` and `config.TWILIO_AUTH_TOKEN`
  // at request time, so we mutate the cached config object to flip modes.
  // (config is loaded once at import; these tests restore on teardown.)
  const originalNodeEnv = config.NODE_ENV;
  const originalToken = config.TWILIO_AUTH_TOKEN;

  afterEach(() => {
    (config as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
    (config as { TWILIO_AUTH_TOKEN: string | undefined }).TWILIO_AUTH_TOKEN = originalToken;
  });

  it('rejects with 503 in production when TWILIO_AUTH_TOKEN is unset', async () => {
    (config as { NODE_ENV: string }).NODE_ENV = 'production';
    (config as { TWILIO_AUTH_TOKEN: string | undefined }).TWILIO_AUTH_TOKEN = undefined;

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA10',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'voice intake not configured' });
  });

  it('allows through in development when TWILIO_AUTH_TOKEN is unset', async () => {
    (config as { NODE_ENV: string }).NODE_ENV = 'development';
    (config as { TWILIO_AUTH_TOKEN: string | undefined }).TWILIO_AUTH_TOKEN = undefined;

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA11',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<Connect>');
  });
});
