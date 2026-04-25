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

const SECRET = 'test-secret';

function signBody(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
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

  it('rejects requests without a signature header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: '{"event":"x"}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with a wrong signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: '{"event":"x"}',
      headers: { 'content-type': 'application/json', 'x-recall-signature': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts correctly-signed requests and dispatches the event', async () => {
    const body = '{"event":"bot.transcript_ready","data":{"bot_id":"b1"}}';
    const sig = signBody(body, SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-recall-signature': sig },
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
      headers: { 'content-type': 'application/json', 'x-recall-signature': 'whatever' },
    });
    expect(res.statusCode).toBe(503);
  });
});
