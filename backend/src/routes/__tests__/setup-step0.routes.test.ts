/**
 * Unit tests for setup-step0.routes.
 *
 * Coverage:
 * - GET /api/setup/hardware returns the profile from HardwareDetectService.
 * - GET /api/setup/state defaults step0Migrated/step0Dismissed to false.
 * - POST /api/setup/save-step0 sets step0Migrated=true and returns envHints + profiles.
 * - POST /api/setup/dismiss-step0 sets step0Dismissed=true.
 *
 * The route reads tenantId off the request, so we install a tiny preHandler
 * that injects it (the production route hook lives in routes/index.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { setupStep0Routes } from '../setup-step0.routes.js';

interface MockSettings {
  step0Migrated: boolean;
  step0Dismissed: boolean;
  meetingBotProviderId: string | null;
}

function buildApp(opts?: {
  initialRow?: MockSettings | null;
  detectedProfile?: unknown;
}): {
  app: FastifyInstance;
  store: Map<string, MockSettings>;
  detect: ReturnType<typeof vi.fn>;
} {
  const app = Fastify();
  const store = new Map<string, MockSettings>();
  if (opts?.initialRow) store.set('tenant-1', opts.initialRow);

  const detect = vi.fn().mockResolvedValue(
    opts?.detectedProfile ?? {
      totalRamGB: 32,
      cpuCores: 8,
      availableForLLM_GB: 25,
      recommendedTier: 'default',
    },
  );

  (app as unknown as { services: unknown }).services = {
    prisma: {
      tenantSettings: {
        findUnique: vi.fn(async ({ where }: { where: { tenantId: string } }) => {
          return store.get(where.tenantId) ?? null;
        }),
        upsert: vi.fn(
          async ({
            where,
            update,
            create,
          }: {
            where: { tenantId: string };
            update: Record<string, unknown>;
            create: Record<string, unknown>;
          }) => {
            const existing = store.get(where.tenantId);
            if (existing) {
              store.set(where.tenantId, { ...existing, ...update } as MockSettings);
            } else {
              store.set(where.tenantId, {
                step0Migrated: false,
                step0Dismissed: false,
                meetingBotProviderId: null,
                ...create,
              } as MockSettings);
            }
            return store.get(where.tenantId)!;
          },
        ),
      },
    },
    hardwareDetectService: { detect },
  };

  // Inject tenantId into every request (production hook lives in index.ts).
  app.addHook('preHandler', async (req) => {
    (req as unknown as { tenantId: string }).tenantId = 'tenant-1';
  });
  app.register(setupStep0Routes, { prefix: '/api/setup' });
  return { app, store, detect };
}

describe('setup-step0 routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET /hardware returns the detected profile', async () => {
    const { app, detect } = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/setup/hardware' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.recommendedTier).toBe('default');
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('GET /state defaults to false/false on a tenant with no row', async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/setup/state' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.step0Migrated).toBe(false);
    expect(body.data.step0Dismissed).toBe(false);
    expect(body.data.meetingBotProviderId).toBeNull();
  });

  it('GET /state reflects existing flag values', async () => {
    const { app } = buildApp({
      initialRow: {
        step0Migrated: true,
        step0Dismissed: false,
        meetingBotProviderId: 'vexa',
      },
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/setup/state' });
    const body = JSON.parse(res.body);
    expect(body.data.step0Migrated).toBe(true);
    expect(body.data.meetingBotProviderId).toBe('vexa');
  });

  it('POST /save-step0 sets step0Migrated=true and returns envHints + profiles', async () => {
    const { app, store } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup/save-step0',
      payload: {
        meetingBotProvider: 'vexa',
        vexaApiUrl: 'http://vexa.example.com:18056',
        localTier: 'default',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    // Vexa is BYO — no bundled compose profile, just an env hint pointing
    // at the user's existing instance.
    expect(body.data.profiles).toEqual(
      expect.arrayContaining(['local-llm', 'local-stt']),
    );
    expect(body.data.profiles).not.toContain('meeting-bot');
    expect(body.data.envHints.VEXA_API_URL).toBe('http://vexa.example.com:18056');
    expect(body.data.envHints.OLLAMA_BASE_URL).toBe('http://ollama:11434');
    expect(body.data.envHints.OLLAMA_DEFAULT_MODEL).toBe('mistral-small-3:24b');
    expect(body.data.envHints.WHISPER_BASE_URL).toBe('http://whisper:8000');
    expect(body.data.envHints.COMPOSE_PROFILES).toBe('local-llm,local-stt');

    const row = store.get('tenant-1');
    expect(row?.step0Migrated).toBe(true);
    expect(row?.meetingBotProviderId).toBe('vexa');
  });

  it('POST /save-step0 with skip and tier=none returns no env hints', async () => {
    const { app, store } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup/save-step0',
      payload: { meetingBotProvider: 'skip', localTier: 'none' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.profiles).toEqual([]);
    expect(body.data.envHints.COMPOSE_PROFILES).toBeUndefined();

    const row = store.get('tenant-1');
    expect(row?.meetingBotProviderId).toBeNull();
    expect(row?.step0Migrated).toBe(true);
  });

  it('POST /save-step0 rejects invalid body', async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup/save-step0',
      payload: { meetingBotProvider: 'nonsense' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_BODY');
  });

  it('POST /dismiss-step0 sets step0Dismissed=true', async () => {
    const { app, store } = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/setup/dismiss-step0' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(store.get('tenant-1')?.step0Dismissed).toBe(true);
  });
});
