import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HonchoMemoryProvider } from '../honcho-memory-provider.js';

const originalFetch = globalThis.fetch;

function mockFetch(fn: (url: string, init: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(fn) as unknown as typeof fetch;
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

describe('HonchoMemoryProvider', () => {
  let provider: HonchoMemoryProvider;

  beforeEach(() => {
    provider = new HonchoMemoryProvider({
      apiKey: 'secret_key',
      baseUrl: 'https://honcho.test/',
      appId: 'app_abc',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('isAvailable returns false without apiKey + appId', () => {
    const empty = new HonchoMemoryProvider({ apiKey: '', appId: '' });
    expect(empty.isAvailable()).toBe(false);
    expect(provider.isAvailable()).toBe(true);
  });

  it('has the right name + isBuiltin flag', () => {
    expect(provider.name).toBe('honcho');
    expect(provider.isBuiltin).toBe(false);
  });

  it('exposes a dialectic_ask tool schema', () => {
    const [tool] = provider.getToolSchemas();
    expect(tool!.name).toBe('dialectic_ask');
  });

  it('prefetch() POSTs to the dialectic endpoint with the query', async () => {
    const fetchMock = mockFetch(async (url, init) => {
      expect(url).toBe(
        'https://honcho.test/apps/app_abc/users/user-1/sessions/sess-1/dialectic',
      );
      expect(init.method).toBe('POST');
      expect((init.headers as any).Authorization).toBe('Bearer secret_key');
      const body = JSON.parse(init.body as string);
      expect(body.queries).toEqual(['what does priya prefer?']);
      return new Response(JSON.stringify({ content: 'Priya prefers <300-word briefs.' }), {
        status: 200,
      });
    });
    await provider.initialize({ tenantId: 't1', userId: 'user-1', sessionId: 'sess-1' });
    const result = await provider.prefetch('what does priya prefer?', 'sess-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBe('Priya prefers <300-word briefs.');
  });

  it('prefetch() returns empty string when user context missing', async () => {
    const fetchMock = mockFetch(async () => new Response('{}'));
    // No initialize() call → no userId
    const result = await provider.prefetch('anything', 'sess-1');
    expect(result).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefetch() swallows 5xx and returns empty string', async () => {
    mockFetch(async () => new Response('server ded', { status: 500 }));
    await provider.initialize({ tenantId: 't1', userId: 'user-1', sessionId: 'sess-1' });
    expect(await provider.prefetch('q', 'sess-1')).toBe('');
  });

  it('syncTurn() POSTs user + assistant pair to messages endpoint', async () => {
    const fetchMock = mockFetch(async (url, init) => {
      expect(url).toBe(
        'https://honcho.test/apps/app_abc/users/user-1/sessions/sess-1/messages',
      );
      const body = JSON.parse(init.body as string);
      expect(body).toEqual([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]);
      return new Response('{}');
    });
    await provider.initialize({ tenantId: 't1', userId: 'user-1', sessionId: 'sess-1' });
    await provider.syncTurn('hi', 'hello', 'sess-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('syncTurn() is a no-op without user context', async () => {
    const fetchMock = mockFetch(async () => new Response('{}'));
    await provider.syncTurn('hi', 'hello', 'sess-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handleToolCall routes dialectic_ask through prefetch', async () => {
    mockFetch(async () => new Response(JSON.stringify({ content: 'likes espresso' })));
    await provider.initialize({ tenantId: 't1', userId: 'user-1', sessionId: 'sess-1' });
    const out = await provider.handleToolCall('dialectic_ask', { question: 'what does the user like?' });
    expect(out).toContain('likes espresso');
  });

  it('rejects unknown tools', async () => {
    const out = await provider.handleToolCall('made_up', {});
    expect(out).toContain('Unknown tool');
  });
});
