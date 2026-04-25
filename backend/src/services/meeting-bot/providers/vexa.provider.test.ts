import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VexaProvider } from './vexa.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;
beforeEach(() => mockFetch.mockReset());

describe('VexaProvider', () => {
  const baseUrl = 'http://vexa-api:18056';

  it('isAvailable returns false when /health is not 200', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 503 }));
    const p = new VexaProvider({ baseUrl });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('isAvailable returns true when /health returns 200', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const p = new VexaProvider({ baseUrl });
    await expect(p.isAvailable()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/health`, expect.any(Object));
  });

  it('scheduleBot POSTs to /bots and returns botId', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'vbot-1', status: 'scheduled' }), { status: 201 }));
    const p = new VexaProvider({ baseUrl });
    const r = await p.scheduleBot({ meetingUrl: 'https://meet.google.com/x', meetingId: 'm', tenantId: 't' });
    expect(r.botId).toBe('vbot-1');
    expect(r.status).toBe('scheduled');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/bots`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('scheduleBot falls back to "scheduled" when Vexa returns an unknown status', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'vbot-2', status: 'queued' }), { status: 201 }),
    );
    const p = new VexaProvider({ baseUrl });
    const r = await p.scheduleBot({ meetingUrl: 'https://meet.google.com/x', meetingId: 'm', tenantId: 't' });
    // 'queued' is a valid Vexa status but NOT part of ScheduleBotResult's union
    // ('scheduled' | 'joining' | 'failed'), so it must coerce to 'scheduled'.
    expect(r.status).toBe('scheduled');
    expect(r.botId).toBe('vbot-2');
  });

  it('cancelBot DELETEs the bot', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const p = new VexaProvider({ baseUrl });
    await p.cancelBot('vbot-1');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/bots/vbot-1`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('getTranscript returns null when bot has no transcript', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'in_progress', segments: [] }), { status: 200 }),
    );
    const p = new VexaProvider({ baseUrl });
    await expect(p.getTranscript('vbot-1')).resolves.toBeNull();
  });

  it('getTranscript throws when bot status is "failed" (terminal)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'failed' }), { status: 200 }),
    );
    const p = new VexaProvider({ baseUrl });
    await expect(p.getTranscript('vbot-1')).rejects.toThrow(/failed to capture/i);
  });

  it('getTranscript maps segments when ready', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: 'completed',
        duration: 600,
        language: 'en',
        participants: ['Alice', 'Bob'],
        segments: [
          { speaker: 'Alice', text: 'hi', start: 0, end: 1.2 },
          { speaker: 'Bob', text: 'hello', start: 1.5, end: 2.7 },
        ],
      }), { status: 200 }),
    );
    const p = new VexaProvider({ baseUrl });
    const t = await p.getTranscript('vbot-1');
    expect(t).not.toBeNull();
    expect(t!.segments).toHaveLength(2);
    expect(t!.participants).toEqual(['Alice', 'Bob']);
    expect(t!.durationSec).toBe(600);
    expect(t!.language).toBe('en');
  });
});
