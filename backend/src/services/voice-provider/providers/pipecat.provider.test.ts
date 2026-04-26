/**
 * Tests for PipecatProvider — bridges Twilio Media Stream WS to pipecat-bridge sidecar.
 *
 * @module services/voice-provider/providers/pipecat.provider.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PipecatProvider } from './pipecat.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

class FakeWs extends EventEmitter {
  sent: unknown[] = [];
  send(data: unknown) {
    this.sent.push(data);
  }
  close = vi.fn();
  readyState = 1;
}

describe('PipecatProvider', () => {
  let bridgeWs: FakeWs;
  let twilioWs: FakeWs;

  beforeEach(() => {
    bridgeWs = new FakeWs();
    twilioWs = new FakeWs();
  });

  it('isAvailable hits bridge /health', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const p = new PipecatProvider({
      bridgeBaseUrl: 'http://pipecat-bridge:8400',
      jwtSecret: 'secret',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wsFactory: () => bridgeWs as any,
    });
    await expect(p.isAvailable()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://pipecat-bridge:8400/health',
      expect.any(Object),
    );
  });

  it('isAvailable returns false on bridge non-2xx', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 503 })) as unknown as typeof fetch;
    const p = new PipecatProvider({
      bridgeBaseUrl: 'http://pipecat-bridge:8400',
      jwtSecret: 'secret',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wsFactory: () => bridgeWs as any,
    });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('startSession opens bridge WS and forwards twilio frames', async () => {
    const p = new PipecatProvider({
      bridgeBaseUrl: 'http://pipecat-bridge:8400',
      jwtSecret: 'secret',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wsFactory: () => bridgeWs as any,
    });
    const handle = await p.startSession({
      callId: 'CA1',
      tenantId: 't1',
      callerNumber: '+1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioInWs: twilioWs as any,
      systemPrompt: 'x',
    });
    twilioWs.emit('message', Buffer.from('audio-frame'));
    expect(
      bridgeWs.sent.some((m) => m instanceof Buffer && m.toString().includes('audio-frame')),
    ).toBe(true);
    await handle.stop();
    expect(bridgeWs.close).toHaveBeenCalled();
  });

  it('emits transcript on bridge end-of-session message', async () => {
    const p = new PipecatProvider({
      bridgeBaseUrl: 'http://pipecat-bridge:8400',
      jwtSecret: 'secret',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wsFactory: () => bridgeWs as any,
    });
    const handle = await p.startSession({
      callId: 'CA1',
      tenantId: 't1',
      callerNumber: '+1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioInWs: twilioWs as any,
      systemPrompt: 'x',
    });
    const cb = vi.fn();
    handle.onTranscriptComplete(cb);
    bridgeWs.emit(
      'message',
      JSON.stringify({
        type: 'transcript_complete',
        transcript: { text: 'hi', turns: [], durationSec: 1, language: 'en' },
      }),
    );
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ text: 'hi' }));
  });
});
