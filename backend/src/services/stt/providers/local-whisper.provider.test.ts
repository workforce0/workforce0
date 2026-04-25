import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalWhisperProvider } from './local-whisper.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;
beforeEach(() => mockFetch.mockReset());

describe('LocalWhisperProvider', () => {
  const baseUrl = 'http://whisper:8000';

  it('isAvailable returns false when baseUrl is undefined', async () => {
    const p = new LocalWhisperProvider({ baseUrl: undefined });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('isAvailable returns true when /health responds 200', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const p = new LocalWhisperProvider({ baseUrl });
    await expect(p.isAvailable()).resolves.toBe(true);
  });

  it('isAvailable returns false when /health responds 503', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const p = new LocalWhisperProvider({ baseUrl });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('transcribe POSTs multipart to /v1/audio/transcriptions and parses verbose_json', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      text: 'hello world',
      duration: 2.5,
      language: 'en',
      segments: [
        { start: 0, end: 1.2, text: 'hello' },
        { start: 1.3, end: 2.5, text: 'world' },
      ],
    }), { status: 200 }));
    const p = new LocalWhisperProvider({ baseUrl });
    const r = await p.transcribe({ audio: new Uint8Array([1,2,3]), filename: 'a.wav' });
    expect(r.text).toBe('hello world');
    expect(r.segments).toHaveLength(2);
    expect(r.durationSec).toBe(2.5);
    expect(r.language).toBe('en');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/v1/audio/transcriptions`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('transcribe throws on 5xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const p = new LocalWhisperProvider({ baseUrl });
    await expect(p.transcribe({ audio: new Uint8Array([1]), filename: 'a.wav' })).rejects.toThrow(/Local Whisper failed: 500/);
  });
});
