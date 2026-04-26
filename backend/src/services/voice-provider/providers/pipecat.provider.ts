/**
 * PipecatProvider — bridges Twilio Media Stream WS to the Pipecat sidecar.
 * Mints a short-lived JWT, opens a WebSocket to pipecat-bridge, decodes
 * Twilio μ-law media frames into raw bytes for the bridge, parses control +
 * transcript JSON out, and re-encodes synthesized audio back to Twilio.
 *
 * Twilio Media Stream protocol (text JSON frames over WS):
 *   {"event":"start", "start":{"streamSid":"MZxx", "callSid":"CAxx", ...}}
 *   {"event":"media", "streamSid":"MZxx", "media":{"payload":"<base64 mu-law>"}}
 *   {"event":"stop",  "streamSid":"MZxx"}
 *
 * Bridge protocol (see infra/pipecat-bridge/server.py + pipeline.py):
 *   incoming binary frames = raw mu-law audio chunks (forwarded to STT)
 *   incoming text frames   = control: {"type":"init", systemPrompt, callerNumber}
 *                                     {"type":"stop"}
 *   outgoing binary frames = TTS audio (mu-law) → must wrap into Twilio media
 *   outgoing text frames   = {"type":"turn",                ... }
 *                            {"type":"transcript_complete", text, turns,
 *                                                            durationSec, language}
 *                            {"type":"error", error}
 *
 * @module services/voice-provider/providers/pipecat
 */

import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { WebSocket as WsClient } from 'ws';
import { createChildLogger } from '../../../lib/logger.js';
import type {
  VoiceProvider,
  VoiceProviderId,
  VoiceSessionHandle,
  VoiceSessionInput,
  TranscriptDoc,
} from '../voice-provider.types.js';

const logger = createChildLogger({ service: 'PipecatProvider' });
const JWT_TTL_SEC = 3600;
const STOP_FINALIZE_TIMEOUT_MS = 5_000;

export interface PipecatProviderConfig {
  /** e.g. http://pipecat-bridge:8400 */
  bridgeBaseUrl: string;
  jwtSecret: string;
  wsFactory: (url: string) => WsClient;
}

/**
 * Twilio Media Stream JSON envelope. We only care about a few of the fields;
 * the rest are documented at https://www.twilio.com/docs/voice/media-streams/
 */
interface TwilioMediaFrame {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  streamSid?: string;
  start?: {
    streamSid?: string;
    callSid?: string;
    customParameters?: Record<string, string>;
  };
  media?: {
    payload?: string;
  };
}

export class PipecatProvider implements VoiceProvider {
  readonly id: VoiceProviderId = 'pipecat';

  constructor(private readonly config: PipecatProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.bridgeBaseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.debug({ err: message }, 'pipecat-bridge health check failed');
      return false;
    }
  }

  async startSession(input: VoiceSessionInput): Promise<VoiceSessionHandle> {
    const sessionId = randomUUID();
    const token = jwt.sign(
      { callId: input.callId, tenantId: input.tenantId, sessionId },
      this.config.jwtSecret,
      { expiresIn: JWT_TTL_SEC },
    );

    const wsUrl = `${this.config.bridgeBaseUrl.replace(/^http/, 'ws')}/sessions/${input.callId}?token=${encodeURIComponent(token)}`;
    const bridgeWs = this.config.wsFactory(wsUrl);

    const transcriptCbs: Array<(t: TranscriptDoc) => void> = [];
    const errorCbs: Array<(e: Error) => void> = [];

    // Twilio assigns a streamSid in the `start` event; we need it to wrap TTS
    // audio frames going back to Twilio in the correct envelope.
    let streamSid: string | undefined;
    // Latches: only the first transcript_complete fires the callbacks.
    let transcriptFired = false;
    // Resolves the next transcript_complete (used by `stop()` to wait for
    // finalization before closing the bridge socket).
    let resolveTranscriptOnce: ((t: TranscriptDoc) => void) | null = null;

    const fireTranscript = (transcript: TranscriptDoc): void => {
      if (transcriptFired) return;
      transcriptFired = true;
      for (const cb of transcriptCbs) cb(transcript);
      if (resolveTranscriptOnce) {
        resolveTranscriptOnce(transcript);
        resolveTranscriptOnce = null;
      }
    };

    // Send initial config (system prompt) once bridge accepts the connection.
    bridgeWs.on('open', () => {
      bridgeWs.send(
        JSON.stringify({
          type: 'init',
          systemPrompt: input.systemPrompt,
          callerNumber: input.callerNumber,
        }),
      );
    });

    bridgeWs.on('message', (raw: Buffer | string) => {
      // The bridge sends binary frames for synthesized TTS audio and text
      // frames for control + transcript messages. Distinguish by raw type:
      // ws emits a Buffer for binary opcode (0x2) and a string only when the
      // server sent a text opcode (0x1). We treat anything that looks like
      // valid JSON as a control message; everything else is audio bytes.
      if (Buffer.isBuffer(raw)) {
        // TTS audio: wrap into Twilio media frame and send back. Twilio
        // requires base64-encoded mu-law; the bridge already produces mu-law
        // bytes (see TTSAdapter), so we just base64-encode here.
        if (!streamSid || input.audioInWs.readyState !== 1 /* OPEN */) return;
        const payload = raw.toString('base64');
        const frame = JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload },
        });
        try {
          input.audioInWs.send(frame);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn({ err: message }, 'failed forwarding TTS audio to Twilio');
        }
        return;
      }

      const text = typeof raw === 'string' ? raw : String(raw);
      let msg: {
        type?: string;
        // The bridge emits transcript fields at the top level (text, turns,
        // durationSec, language) — NOT nested under a `transcript` key.
        text?: string;
        turns?: TranscriptDoc['turns'];
        durationSec?: number;
        language?: string;
        error?: string;
      };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === 'transcript_complete') {
        const transcript: TranscriptDoc = {
          text: msg.text ?? '',
          turns: msg.turns ?? [],
          durationSec: msg.durationSec ?? 0,
          language: msg.language ?? 'en',
        };
        fireTranscript(transcript);
      } else if (msg.type === 'error' && msg.error) {
        for (const cb of errorCbs) cb(new Error(msg.error));
      }
      // 'turn' messages are ignored here — they are progressive updates and
      // the BA Agent only consumes the final transcript_complete payload.
    });

    bridgeWs.on('error', (err: Error) => {
      for (const cb of errorCbs) cb(err);
    });

    // Forward Twilio JSON media frames into the bridge as raw mu-law bytes.
    // The Twilio Media Stream WS sends JSON envelopes, NOT raw audio — the
    // payload is `media.payload`, base64-encoded mu-law. Forwarding the raw
    // JSON to the bridge would cause STT to receive garbage.
    input.audioInWs.on('message', (frame: Buffer | string) => {
      const text = typeof frame === 'string' ? frame : frame.toString('utf8');
      let parsed: TwilioMediaFrame;
      try {
        parsed = JSON.parse(text) as TwilioMediaFrame;
      } catch {
        // Non-JSON or already-binary frame — forward as-is.
        if (bridgeWs.readyState === 1 /* OPEN */ && Buffer.isBuffer(frame)) {
          bridgeWs.send(frame);
        }
        return;
      }

      if (parsed.event === 'start') {
        streamSid = parsed.start?.streamSid ?? parsed.streamSid;
        logger.debug(
          { sessionId, callId: input.callId, streamSid },
          'Twilio stream started',
        );
        return;
      }
      if (parsed.event === 'media' && parsed.media?.payload) {
        if (bridgeWs.readyState !== 1 /* OPEN */) return;
        // Base64 → Buffer of mu-law bytes. The bridge's STT adapter consumes
        // raw mu-law (or PCM after Pipecat's resampler), not JSON envelopes.
        const audioBytes = Buffer.from(parsed.media.payload, 'base64');
        bridgeWs.send(audioBytes);
        return;
      }
      if (parsed.event === 'stop') {
        // Twilio is hanging up — request finalization from the bridge so it
        // emits a `transcript_complete` before we tear the socket down. We
        // don't await here (this handler is sync); `stop()` does the wait.
        if (bridgeWs.readyState === 1 /* OPEN */) {
          try {
            bridgeWs.send(JSON.stringify({ type: 'stop' }));
          } catch {
            // Ignore — `stop()` will close the socket regardless.
          }
        }
      }
      // 'connected' and 'mark' events are ignored — Twilio sends them as
      // protocol bookkeeping; the bridge doesn't need them.
    });

    logger.info({ sessionId, callId: input.callId }, 'Pipecat session opened');

    return {
      sessionId,
      stop: async () => {
        // Tell the bridge we're done so it emits transcript_complete during
        // shutdown. Closing the socket immediately races the finalize() call
        // on the bridge side and the transcript would be silently dropped.
        if (bridgeWs.readyState === 1 /* OPEN */) {
          try {
            bridgeWs.send(JSON.stringify({ type: 'stop' }));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn({ err: message }, 'failed sending stop control to bridge');
          }
        }
        // Wait for the next transcript_complete OR a 5s timeout, then close.
        if (!transcriptFired) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              resolveTranscriptOnce = null;
              resolve();
            }, STOP_FINALIZE_TIMEOUT_MS);
            resolveTranscriptOnce = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
        try {
          bridgeWs.close();
        } catch {
          // Already closed — no-op.
        }
      },
      onTranscriptComplete: (cb) => {
        transcriptCbs.push(cb);
      },
      onError: (cb) => {
        errorCbs.push(cb);
      },
    };
  }
}
