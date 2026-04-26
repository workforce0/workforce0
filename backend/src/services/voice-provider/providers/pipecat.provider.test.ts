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

  it('startSession decodes Twilio media JSON frames into raw bytes for the bridge', async () => {
    const p = new PipecatProvider({
      bridgeBaseUrl: 'http://pipecat-bridge:8400',
      jwtSecret: 'secret',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wsFactory: () => bridgeWs as any,
    });
    await p.startSession({
      callId: 'CA1',
      tenantId: 't1',
      callerNumber: '+1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioInWs: twilioWs as any,
      systemPrompt: 'x',
    });

    // Simulate Twilio's start frame so streamSid is captured for the response path.
    twilioWs.emit(
      'message',
      JSON.stringify({
        event: 'start',
        streamSid: 'MZabc',
        start: { streamSid: 'MZabc', callSid: 'CA1' },
      }),
    );
    // A real Twilio media frame: base64-encoded mu-law payload.
    const audioBytes = Buffer.from('audio-frame');
    twilioWs.emit(
      'message',
      JSON.stringify({
        event: 'media',
        streamSid: 'MZabc',
        media: { payload: audioBytes.toString('base64') },
      }),
    );
    // The bridge should receive raw bytes — NOT the JSON envelope.
    expect(
      bridgeWs.sent.some(
        (m) => Buffer.isBuffer(m) && (m as Buffer).equals(audioBytes),
      ),
    ).toBe(true);
    // It must NOT have forwarded the JSON envelope verbatim.
    expect(
      bridgeWs.sent.some(
        (m) => typeof m === 'string' && (m as string).includes('"event":"media"'),
      ),
    ).toBe(false);
  });

  it('forwards bridge TTS audio back to Twilio as a base64 media frame', async () => {
    const p = new PipecatProvider({
      bridgeBaseUrl: 'http://pipecat-bridge:8400',
      jwtSecret: 'secret',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wsFactory: () => bridgeWs as any,
    });
    await p.startSession({
      callId: 'CA1',
      tenantId: 't1',
      callerNumber: '+1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioInWs: twilioWs as any,
      systemPrompt: 'x',
    });
    // Establish streamSid so the provider knows how to wrap the response.
    twilioWs.emit(
      'message',
      JSON.stringify({ event: 'start', start: { streamSid: 'MZxyz' } }),
    );
    const tts = Buffer.from('hello-tts');
    bridgeWs.emit('message', tts);
    // Twilio should receive a JSON envelope with the right shape.
    const sentToTwilio = twilioWs.sent.find(
      (m): m is string => typeof m === 'string' && m.includes('"event":"media"'),
    );
    expect(sentToTwilio).toBeDefined();
    const parsed = JSON.parse(sentToTwilio as string) as {
      event: string;
      streamSid: string;
      media: { payload: string };
    };
    expect(parsed.event).toBe('media');
    expect(parsed.streamSid).toBe('MZxyz');
    expect(Buffer.from(parsed.media.payload, 'base64').toString()).toBe('hello-tts');
  });

  it('emits transcript on bridge transcript_complete (top-level fields)', async () => {
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
    // Bridge sends transcript fields at the top level (see pipeline.py).
    bridgeWs.emit(
      'message',
      JSON.stringify({
        type: 'transcript_complete',
        text: 'hi',
        turns: [{ speaker: 'caller', text: 'hi', startMs: 0, endMs: 100 }],
        durationSec: 1,
        language: 'en',
      }),
    );
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hi', durationSec: 1, language: 'en' }),
    );
  });

  it('stop() sends a stop control then closes after transcript_complete', async () => {
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
    // stop() should send {"type":"stop"} and wait for transcript_complete.
    const stopPromise = handle.stop();
    // Verify the stop control was sent BEFORE close.
    expect(
      bridgeWs.sent.some(
        (m) => typeof m === 'string' && (m as string).includes('"type":"stop"'),
      ),
    ).toBe(true);
    // Now drive transcript_complete to release the wait.
    bridgeWs.emit(
      'message',
      JSON.stringify({
        type: 'transcript_complete',
        text: '',
        turns: [],
        durationSec: 0,
        language: 'en',
      }),
    );
    await stopPromise;
    expect(bridgeWs.close).toHaveBeenCalled();
  });
});
