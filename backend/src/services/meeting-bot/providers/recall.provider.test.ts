import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecallProvider } from './recall.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => mockFetch.mockReset());

describe('RecallProvider', () => {
  it('isAvailable returns false when no API key', async () => {
    const p = new RecallProvider({ apiKey: undefined, webhookSecret: undefined });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('isAvailable returns true when API key is set and /v1/bot returns 200', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const p = new RecallProvider({ apiKey: 'test-key', webhookSecret: 'sec' });
    await expect(p.isAvailable()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://us-west-2.recall.ai/api/v1/bot/?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Token test-key' }),
      }),
    );
  });

  it('scheduleBot calls Recall API with auth header', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'bot-abc', status_changes: [] }), { status: 201 }),
    );
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    const result = await p.scheduleBot({
      meetingUrl: 'https://meet.google.com/x',
      meetingId: 'm1',
      tenantId: 't1',
      botName: 'Workforce0',
    });
    expect(result.botId).toBe('bot-abc');
    expect(result.status).toBe('scheduled');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://us-west-2.recall.ai/api/v1/bot/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Token k' }),
      }),
    );
  });

  it('scheduleBot throws when API returns 4xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"bad"}', { status: 400 }));
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    await expect(
      p.scheduleBot({ meetingUrl: 'x', meetingId: 'm', tenantId: 't' }),
    ).rejects.toThrow(/Recall scheduleBot failed: 400/);
  });

  it('cancelBot calls leave_call', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    await p.cancelBot('bot-xyz');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://us-west-2.recall.ai/api/v1/bot/bot-xyz/leave_call/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getTranscript returns null when bot is still recording', async () => {
    // status_changes shows "recording" — not yet done. We expect the
    // provider to return null so the caller polls again later.
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'bot-abc',
          status_changes: [{ code: 'joining_call' }, { code: 'recording' }],
          recordings: [],
        }),
        { status: 200 },
      ),
    );
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    await expect(p.getTranscript('bot-abc')).resolves.toBeNull();
  });

  it('getTranscript returns null when done but no recordings yet', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'bot-abc',
          status_changes: [{ code: 'done' }],
          recordings: [],
        }),
        { status: 200 },
      ),
    );
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    await expect(p.getTranscript('bot-abc')).resolves.toBeNull();
  });

  it('getTranscript throws (not implemented) when transcript download_url is available', async () => {
    // Recall's documented shape:
    //   recordings[0].media_shortcuts.transcript.data.download_url
    // We deliberately don't pretend to parse the download_url payload until
    // we can verify its shape against a live Recall account — throw loudly.
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'bot-abc',
          status_changes: [{ code: 'done' }],
          recordings: [
            {
              media_shortcuts: {
                transcript: {
                  data: { download_url: 'https://recall.example/transcript.json' },
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    await expect(p.getTranscript('bot-abc')).rejects.toThrow(/not yet implemented/);
  });

  it('isAvailable caches positive result for repeated calls', async () => {
    mockFetch.mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    await expect(p.isAvailable()).resolves.toBe(true);
    await expect(p.isAvailable()).resolves.toBe(true);
    await expect(p.isAvailable()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('isAvailable cache can be cleared via clearAvailabilityCache (test seam)', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    await expect(p.isAvailable()).resolves.toBe(true);
    p.clearAvailabilityCache();
    await expect(p.isAvailable()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('honors a custom baseUrl override (regional endpoints)', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const p = new RecallProvider({
      apiKey: 'test-key',
      webhookSecret: 'sec',
      baseUrl: 'https://eu-central-1.recall.ai/api/v1',
    });
    await expect(p.isAvailable()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://eu-central-1.recall.ai/api/v1/bot/?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Token test-key' }),
      }),
    );
  });
});
