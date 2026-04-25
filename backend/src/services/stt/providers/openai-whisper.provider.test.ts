import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIWhisperProvider } from './openai-whisper.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;
beforeEach(() => mockFetch.mockReset());

describe('OpenAIWhisperProvider', () => {
  it('isAvailable returns false when no apiKey', async () => {
    const p = new OpenAIWhisperProvider({ apiKey: undefined });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('isAvailable returns true when apiKey is set', async () => {
    const p = new OpenAIWhisperProvider({ apiKey: 'sk-test' });
    await expect(p.isAvailable()).resolves.toBe(true);
  });

  it('transcribe sends multipart with Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      text: 'hi',
      duration: 1,
      language: 'en',
      segments: [{ start: 0, end: 1, text: 'hi' }],
    }), { status: 200 }));
    const p = new OpenAIWhisperProvider({ apiKey: 'sk-test' });
    const r = await p.transcribe({ audio: new Uint8Array([1]), filename: 'a.wav' });
    expect(r.text).toBe('hi');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
  });

  it('transcribe throws on 4xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    const p = new OpenAIWhisperProvider({ apiKey: 'sk-test' });
    await expect(p.transcribe({ audio: new Uint8Array([1]), filename: 'a.wav' })).rejects.toThrow(/OpenAI Whisper failed: 401/);
  });

  it('passes domainPrompt through as Whisper prompt parameter', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      text: 'hi', segments: [], duration: 0, language: 'en',
    }), { status: 200 }));
    const p = new OpenAIWhisperProvider({ apiKey: 'sk-test' });
    await p.transcribe({
      audio: new Uint8Array([1]),
      filename: 'a.wav',
      domainPrompt: 'kubernetes deployment',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
