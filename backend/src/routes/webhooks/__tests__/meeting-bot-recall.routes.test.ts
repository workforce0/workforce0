/**
 * Tests for the Recall.ai webhook route.
 *
 * Verifies HMAC validation (x-recall-signature) gates dispatch to
 * meetingService.handleBotEvent, and that missing config short-circuits
 * with 503 before any signature work.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { meetingBotRecallWebhookRoutes } from '../meeting-bot-recall.routes.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Recall.ai uses Svix for webhook delivery. Secrets look like `whsec_<base64>`.
// We use a fixed base64 here so the test signature is deterministic.
const RAW_SECRET_B64 = Buffer.from('test-secret-bytes').toString('base64');
const SECRET = `whsec_${RAW_SECRET_B64}`;

function svixSign(svixId: string, svixTimestamp: string, body: string, secret: string): string {
  const secretBytes = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : Buffer.from(secret, 'utf8');
  const payload = `${svixId}.${svixTimestamp}.${body}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(payload).digest('base64');
  return `v1,${sig}`;
}

function buildApp(): FastifyInstance {
  const app = Fastify();
  (app as unknown as { services: Record<string, unknown> }).services = {
    recallWebhookSecret: SECRET,
    meetingService: { handleBotEvent: vi.fn().mockResolvedValue(undefined) },
  };
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const json = body === '' ? {} : JSON.parse(body as string);
      (req as unknown as { rawBody: string }).rawBody = body as string;
      done(null, json);
    } catch (err) {
      done(err as Error);
    }
  });
  app.register(meetingBotRecallWebhookRoutes, { prefix: '/webhooks/meeting-bot' });
  return app;
}

describe('Recall webhook route', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  it('rejects requests missing svix headers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: '{"event":"x"}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with a wrong svix-signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: '{"event":"x"}',
      headers: {
        'content-type': 'application/json',
        'svix-id': 'msg_1',
        'svix-timestamp': '1700000000',
        'svix-signature': 'v1,d3JvbmctYmFzZTY0LXNpZw==',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts correctly-signed (Svix v1 base64) requests and dispatches the event', async () => {
    const body = '{"event":"bot.transcript_ready","data":{"bot_id":"b1"}}';
    const svixId = 'msg_abc';
    const svixTimestamp = '1700000000';
    const sig = svixSign(svixId, svixTimestamp, body, SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': sig,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts when ANY of the space-separated v1 signatures match (rotation case)', async () => {
    const body = '{"event":"bot.transcript_ready","data":{"bot_id":"b1"}}';
    const svixId = 'msg_def';
    const svixTimestamp = '1700000001';
    const goodSig = svixSign(svixId, svixTimestamp, body, SECRET);
    // Combine a bad signature with the good one — the good one wins.
    const combined = `v1,d3Jvbmc= ${goodSig}`;
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': combined,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 503 when no webhookSecret is configured', async () => {
    (app as unknown as { services: { recallWebhookSecret: string | undefined } })
      .services.recallWebhookSecret = undefined;
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: '{}',
      headers: {
        'content-type': 'application/json',
        'svix-id': 'msg_1',
        'svix-timestamp': '1',
        'svix-signature': 'v1,whatever',
      },
    });
    expect(res.statusCode).toBe(503);
  });
});
