/**
 * PipecatProvider — bridges Twilio Media Stream WS to the Pipecat sidecar.
 * Mints a short-lived JWT, opens a WebSocket to pipecat-bridge, forwards
 * binary audio frames in, parses control + transcript JSON out.
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

export interface PipecatProviderConfig {
  /** e.g. http://pipecat-bridge:8400 */
  bridgeBaseUrl: string;
  jwtSecret: string;
  wsFactory: (url: string) => WsClient;
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
      logger.debug({ err: (err as Error).message }, 'pipecat-bridge health check failed');
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
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      try {
        const msg = JSON.parse(text) as {
          type?: string;
          transcript?: TranscriptDoc;
          error?: string;
        };
        if (msg.type === 'transcript_complete' && msg.transcript) {
          for (const cb of transcriptCbs) cb(msg.transcript);
        } else if (msg.type === 'error' && msg.error) {
          for (const cb of errorCbs) cb(new Error(msg.error));
        }
        // synthesized audio frames come back as binary; we forward those to twilio in the route handler.
      } catch {
        // binary audio — forwarded in the media-stream route, not here.
      }
    });

    bridgeWs.on('error', (err: Error) => {
      for (const cb of errorCbs) cb(err);
    });

    // Forward Twilio audio frames into the bridge.
    input.audioInWs.on('message', (frame: Buffer) => {
      if (bridgeWs.readyState === 1 /* OPEN */) bridgeWs.send(frame);
    });

    logger.info({ sessionId, callId: input.callId }, 'Pipecat session opened');

    return {
      sessionId,
      stop: async () => {
        bridgeWs.close();
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
