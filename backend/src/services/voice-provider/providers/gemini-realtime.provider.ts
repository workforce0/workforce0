/**
 * GeminiRealtimeProvider — wraps the existing voice/gemini-live.ts service.
 *
 * The existing service is left untouched. This provider expects an injected
 * sessionFactory that returns an EventEmitter-shaped object exposing
 * start(input) and stop(). Production wiring (DI in Task 11) adapts the
 * existing GeminiLiveSession into that shape.
 *
 * @module services/voice-provider/providers/gemini-realtime
 */

import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { createChildLogger } from '../../../lib/logger.js';
import type {
  VoiceProvider,
  VoiceProviderId,
  VoiceSessionHandle,
  VoiceSessionInput,
  TranscriptDoc,
} from '../voice-provider.types.js';

const logger = createChildLogger({ service: 'GeminiRealtimeProvider' });

interface GeminiSessionLike extends EventEmitter {
  start(input: VoiceSessionInput): void;
  stop(): Promise<void>;
}

export interface GeminiRealtimeProviderConfig {
  apiKey: string | undefined;
  /** Injected for testing — production wires this to the existing GeminiLiveSession constructor. */
  sessionFactory: () => GeminiSessionLike;
}

export class GeminiRealtimeProvider implements VoiceProvider {
  readonly id: VoiceProviderId = 'gemini';

  constructor(private readonly config: GeminiRealtimeProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    return typeof this.config.apiKey === 'string' && this.config.apiKey.length > 0;
  }

  async startSession(input: VoiceSessionInput): Promise<VoiceSessionHandle> {
    if (!this.config.apiKey) {
      throw new Error('GeminiRealtimeProvider: GEMINI_API_KEY not set');
    }

    const session = this.config.sessionFactory();
    const sessionId = randomUUID();
    const transcriptCbs: Array<(t: TranscriptDoc) => void> = [];
    const errorCbs: Array<(e: Error) => void> = [];

    session.on('end', (transcript: TranscriptDoc) => {
      for (const cb of transcriptCbs) cb(transcript);
    });
    session.on('error', (err: Error) => {
      for (const cb of errorCbs) cb(err);
    });

    session.start(input);
    logger.info({ sessionId, callId: input.callId }, 'Gemini voice session started');

    return {
      sessionId,
      stop: () => session.stop(),
      onTranscriptComplete: (cb) => {
        transcriptCbs.push(cb);
      },
      onError: (cb) => {
        errorCbs.push(cb);
      },
    };
  }
}
