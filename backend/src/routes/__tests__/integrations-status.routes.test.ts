import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { integrationsStatusRoutes } from '../integrations-status.routes.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;
beforeEach(() => mockFetch.mockReset());

function buildApp(config: Record<string, string | undefined>): FastifyInstance {
  const app = Fastify();
  (app as unknown as { services: Record<string, unknown> }).services = { config };
  app.register(integrationsStatusRoutes, { prefix: '/api' });
  return app;
}

describe('GET /api/integrations/status', () => {
  it('returns disabled for all services when no URLs configured', async () => {
    const app = buildApp({});
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/integrations/status' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.every((r: { status: string }) => r.status === 'disabled')).toBe(true);
  });

  it('reports up when fetch succeeds', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const app = buildApp({ OLLAMA_BASE_URL: 'http://o', WHISPER_BASE_URL: 'http://w', VEXA_API_URL: 'http://v' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/integrations/status' });
    const body = JSON.parse(res.body);
    expect(body.data.every((r: { status: string }) => r.status === 'up')).toBe(true);
    expect(body.data.every((r: { latencyMs: number }) => typeof r.latencyMs === 'number')).toBe(true);
  });

  it('reports down with error when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused'));
    const app = buildApp({ OLLAMA_BASE_URL: 'http://o' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/integrations/status' });
    const body = JSON.parse(res.body);
    const ollama = body.data.find((r: { service: string }) => r.service === 'ollama');
    expect(ollama.status).toBe('down');
    expect(ollama.lastError).toMatch(/connection refused/);
  });

  it('reports down with HTTP code on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 503 }));
    const app = buildApp({ OLLAMA_BASE_URL: 'http://o' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/integrations/status' });
    const body = JSON.parse(res.body);
    const ollama = body.data.find((r: { service: string }) => r.service === 'ollama');
    expect(ollama.status).toBe('down');
    expect(ollama.lastError).toMatch(/HTTP 503/);
  });
});
