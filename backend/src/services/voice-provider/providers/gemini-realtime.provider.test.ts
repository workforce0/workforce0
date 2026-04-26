/**
 * Tests for GeminiRealtimeProvider — wrapper around the existing voice/gemini-live service.
 *
 * @module services/voice-provider/providers/gemini-realtime.provider.test
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { GeminiRealtimeProvider } from './gemini-realtime.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

class FakeGeminiSession extends EventEmitter {
  start = vi.fn();
  stop = vi.fn().mockImplementation(() => Promise.resolve());
}

const buildSession = () => new FakeGeminiSession();

describe('GeminiRealtimeProvider', () => {
  it('isAvailable returns false when no API key', async () => {
    const p = new GeminiRealtimeProvider({ apiKey: undefined, sessionFactory: buildSession });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('isAvailable returns true when API key set', async () => {
    const p = new GeminiRealtimeProvider({ apiKey: 'k', sessionFactory: buildSession });
    await expect(p.isAvailable()).resolves.toBe(true);
  });

  it('startSession returns a handle that calls underlying stop()', async () => {
    const session = buildSession();
    const p = new GeminiRealtimeProvider({ apiKey: 'k', sessionFactory: () => session });
    const handle = await p.startSession({
      callId: 'CA1',
      tenantId: 't1',
      callerNumber: '+1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioInWs: {} as any,
      systemPrompt: 'x',
    });
    expect(handle.sessionId).toBeTruthy();
    await handle.stop();
    expect(session.stop).toHaveBeenCalled();
  });

  it('emits transcript on session-end with transcript', async () => {
    const session = buildSession();
    const p = new GeminiRealtimeProvider({ apiKey: 'k', sessionFactory: () => session });
    const handle = await p.startSession({
      callId: 'CA1',
      tenantId: 't1',
      callerNumber: '+1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioInWs: {} as any,
      systemPrompt: 'x',
    });
    const cb = vi.fn();
    handle.onTranscriptComplete(cb);
    session.emit('end', { text: 'hello', turns: [], durationSec: 5, language: 'en' });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }));
  });
});
