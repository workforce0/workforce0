/**
 * Tests for OpenAIRealtimeProvider — wrapper around the existing voice/openai-realtime service.
 *
 * @module services/voice-provider/providers/openai-realtime.provider.test
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { OpenAIRealtimeProvider } from './openai-realtime.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

class FakeOpenAISession extends EventEmitter {
  start = vi.fn();
  stop = vi.fn().mockImplementation(() => Promise.resolve());
}

const buildSession = () => new FakeOpenAISession();

describe('OpenAIRealtimeProvider', () => {
  it('isAvailable returns false when no API key (provider gated off)', async () => {
    const p = new OpenAIRealtimeProvider({ apiKey: undefined, sessionFactory: buildSession });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('isAvailable returns false even when API key is set (transcript wiring not ready)', async () => {
    // Defense-in-depth gate: until the session adapter emits `'end'`, this
    // provider stays off so a stray `tenant.voiceProviderId === 'openai'`
    // doesn't route to a session that hangs on hangup. See the class doc on
    // OpenAIRealtimeProvider for the re-enable path.
    const p = new OpenAIRealtimeProvider({ apiKey: 'k', sessionFactory: buildSession });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('startSession returns a handle that calls underlying stop()', async () => {
    const session = buildSession();
    const p = new OpenAIRealtimeProvider({ apiKey: 'k', sessionFactory: () => session });
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
    const p = new OpenAIRealtimeProvider({ apiKey: 'k', sessionFactory: () => session });
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
