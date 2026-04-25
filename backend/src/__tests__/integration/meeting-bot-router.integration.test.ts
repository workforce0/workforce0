/**
 * Integration test: POST /api/meetings (schedule) goes through the router
 * and dispatches to the right provider, with deterministic fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MeetingBotRouter } from '../../services/meeting-bot/meeting-bot-router.service.js';
import { ManualProvider } from '../../services/meeting-bot/providers/manual.provider.js';
import type { MeetingBotProvider, ProviderId } from '../../services/meeting-bot/meeting-bot-provider.types.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

function fakeProvider(id: ProviderId, available: boolean, scheduleResult?: { botId: string; status: 'scheduled' }): MeetingBotProvider {
  return {
    id, displayName: id,
    isAvailable: vi.fn().mockResolvedValue(available),
    scheduleBot: vi.fn().mockResolvedValue(scheduleResult ?? { botId: `${id}-bot-1`, status: 'scheduled' }),
    cancelBot: vi.fn(),
    getTranscript: vi.fn(),
  };
}

type CreateScheduledFn = (input: { tenantId: string; title: string; meetingUrl: string }) => Promise<{ id: string }>;
type MarkFailedFn = (meetingId: string, reason: string) => Promise<void>;
type MeetingServiceMock = {
  createScheduled: ReturnType<typeof vi.fn<CreateScheduledFn>>;
  markFailed: ReturnType<typeof vi.fn<MarkFailedFn>>;
};

function buildApp(router: MeetingBotRouter, meetingService: MeetingServiceMock): FastifyInstance {
  const app = Fastify();
  (app as unknown as { services: Record<string, unknown> }).services = { meetingBotRouter: router, meetingService };
  app.addHook('preHandler', (req, _reply, done) => {
    (req as unknown as { tenantId: string }).tenantId = 't1';
    done();
  });
  app.post('/api/meetings', async (request, reply) => {
    const tenantId = (request as unknown as { tenantId: string }).tenantId;
    const body = request.body as { meetingUrl: string; title?: string };
    const provider = await router.resolveProvider(tenantId);
    if (provider.id === 'manual') {
      return reply.status(503).send({ success: false, error: { code: 'NO_BOT_PROVIDER' } });
    }
    const meeting = await meetingService.createScheduled({ tenantId, title: body.title ?? 'X', meetingUrl: body.meetingUrl });
    try {
      const r = await provider.scheduleBot({ meetingUrl: body.meetingUrl, meetingId: meeting.id, tenantId });
      return reply.status(201).send({ success: true, data: { meetingId: meeting.id, botId: r.botId, status: r.status, provider: provider.id } });
    } catch (err) {
      await meetingService.markFailed(meeting.id, (err as Error).message).catch(() => {});
      return reply.status(502).send({ success: false, error: { code: 'BOT_SCHEDULE_FAILED', message: (err as Error).message } });
    }
  });
  return app;
}

describe('integration: POST /api/meetings via MeetingBotRouter', () => {
  let meetingService: MeetingServiceMock;
  beforeEach(() => {
    meetingService = {
      createScheduled: vi.fn<CreateScheduledFn>().mockResolvedValue({ id: 'm-1' }),
      markFailed: vi.fn<MarkFailedFn>().mockResolvedValue(undefined),
    };
  });

  it('schedules via vexa when vexa is available', async () => {
    const router = new MeetingBotRouter(
      [fakeProvider('vexa', true), new ManualProvider()],
      { get: async () => ({ meetingBotProviderId: null }) },
    );
    const app = buildApp(router, meetingService);
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { meetingUrl: 'https://meet.google.com/x' } });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.provider).toBe('vexa');
  });

  it('falls through to manual (NO_BOT_PROVIDER) when vexa is unavailable', async () => {
    const router = new MeetingBotRouter(
      [fakeProvider('vexa', false), new ManualProvider()],
      { get: async () => ({ meetingBotProviderId: null }) },
    );
    const app = buildApp(router, meetingService);
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { meetingUrl: 'https://meet.google.com/x' } });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error.code).toBe('NO_BOT_PROVIDER');
    expect(meetingService.createScheduled).not.toHaveBeenCalled();
  });

  it('returns 503 with NO_BOT_PROVIDER when only manual is available', async () => {
    const router = new MeetingBotRouter(
      [fakeProvider('vexa', false), new ManualProvider()],
      { get: async () => ({ meetingBotProviderId: null }) },
    );
    const app = buildApp(router, meetingService);
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { meetingUrl: 'https://meet.google.com/x' } });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error.code).toBe('NO_BOT_PROVIDER');
    expect(meetingService.createScheduled).not.toHaveBeenCalled();
  });

  it('marks meeting failed when scheduleBot throws', async () => {
    const failingVexa = fakeProvider('vexa', true);
    (failingVexa.scheduleBot as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Vexa exploded'));
    const router = new MeetingBotRouter(
      [failingVexa, new ManualProvider()],
      { get: async () => ({ meetingBotProviderId: null }) },
    );
    const app = buildApp(router, meetingService);
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { meetingUrl: 'https://meet.google.com/x' } });
    expect(res.statusCode).toBe(502);
    expect(meetingService.markFailed).toHaveBeenCalledWith('m-1', 'Vexa exploded');
  });

  it('respects tenant preference (vexa) over default order', async () => {
    const router = new MeetingBotRouter(
      [fakeProvider('vexa', true), new ManualProvider()],
      { get: async () => ({ meetingBotProviderId: 'vexa' }) },
    );
    const app = buildApp(router, meetingService);
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { meetingUrl: 'https://meet.google.com/x' } });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.provider).toBe('vexa');
  });
});
