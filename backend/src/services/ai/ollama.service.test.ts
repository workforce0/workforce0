import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaService } from './ollama.service.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;
beforeEach(() => mockFetch.mockReset());

describe('OllamaService', () => {
  const baseUrl = 'http://ollama:11434';

  it('isEnabled returns false when baseUrl is undefined', () => {
    const s = new OllamaService({ baseUrl: undefined });
    expect(s.isEnabled()).toBe(false);
  });

  it('isEnabled returns true when baseUrl is set', () => {
    const s = new OllamaService({ baseUrl });
    expect(s.isEnabled()).toBe(true);
  });

  it('isAvailable returns true when /api/tags responds 200', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'qwen3.5:8b' }] }), { status: 200 }));
    const s = new OllamaService({ baseUrl });
    await expect(s.isAvailable()).resolves.toBe(true);
  });

  it('isAvailable returns false when /api/tags fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused'));
    const s = new OllamaService({ baseUrl });
    await expect(s.isAvailable()).resolves.toBe(false);
  });

  it('generate calls /v1/chat/completions OpenAI-compatible endpoint', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200 }));
    const s = new OllamaService({ baseUrl });
    const out = await s.generate({ model: 'qwen3.5:8b', prompt: 'hi', temperature: 0.7 });
    expect(out.text).toBe('hello');
    expect(out.usage.totalTokens).toBe(15);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/v1/chat/completions`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('generate throws on 5xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const s = new OllamaService({ baseUrl });
    await expect(s.generate({ model: 'qwen3.5:8b', prompt: 'x' })).rejects.toThrow(/Ollama generate failed: 500/);
  });

  it('warmModel issues a no-op generation request', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 } }), { status: 200 }));
    const s = new OllamaService({ baseUrl });
    await s.warmModel('qwen3.5:8b');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
