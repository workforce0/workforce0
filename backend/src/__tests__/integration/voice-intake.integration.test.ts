/**
 * Integration: inbound voice flow exercises the webhook + caller-auth +
 * tenant-resolver pipeline in a single Fastify instance. Provider-side
 * (media-stream + Pipecat) is out of scope here — the unit tests cover that.
 *
 * Two test cases:
 *   1. Allowed caller → POST /inbound returns <Connect><Stream> TwiML.
 *   2. PIN flow → POST /inbound (needs_pin) returns <Gather>, then
 *      POST /pin with a wrong PIN returns <Hangup/>.
 *
 * @module __tests__/integration/voice-intake.integration.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import { twilioInboundRoutes } from '../../routes/webhooks/twilio-inbound.routes.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

interface TestServices {
  callerAuthService: {
    checkCallerId: ReturnType<typeof vi.fn>;
    verifyPin: ReturnType<typeof vi.fn>;
  };
  tenantResolver: {
    resolveTenantByDID: ReturnType<typeof vi.fn>;
  };
}

const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify();
  await app.register(formbody);
  const services: TestServices = {
    callerAuthService: {
      checkCallerId: vi.fn().mockResolvedValue('allowed'),
      verifyPin: vi.fn().mockResolvedValue(true),
    },
    tenantResolver: {
      resolveTenantByDID: vi.fn().mockResolvedValue('t1'),
    },
  };
  (app as unknown as { services: TestServices }).services = services;
  await app.register(twilioInboundRoutes, { prefix: '/webhooks/twilio/voice' });
  await app.ready();
  return app;
};

describe('integration: inbound voice TwiML routing', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  it('allowed caller → <Connect><Stream>', async () => {
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
    expect(res.body).toContain('CA1');

    const services = (app as unknown as { services: TestServices }).services;
    expect(services.tenantResolver.resolveTenantByDID).toHaveBeenCalledWith(
      '+18005551111',
    );
    expect(services.callerAuthService.checkCallerId).toHaveBeenCalledWith(
      't1',
      '+15551234567',
    );
  });

  it('PIN flow: needs_pin → <Gather>, invalid PIN → <Hangup/>', async () => {
    const services = (app as unknown as { services: TestServices }).services;
    services.callerAuthService.checkCallerId.mockResolvedValueOnce('needs_pin');
    services.callerAuthService.verifyPin.mockResolvedValueOnce(false);

    const r1 = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15559999999&To=%2B18005551111&CallSid=CA2',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.body).toContain('<Gather');
    expect(r1.body).toContain('action="/webhooks/twilio/voice/pin"');

    const r2 = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/pin',
      payload:
        'From=%2B15559999999&To=%2B18005551111&CallSid=CA2&Digits=9999',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.body).toContain('<Hangup');
    expect(r2.body).toContain('Access denied');
    expect(services.callerAuthService.verifyPin).toHaveBeenCalledWith(
      't1',
      '9999',
      '+15559999999',
    );
  });
});
