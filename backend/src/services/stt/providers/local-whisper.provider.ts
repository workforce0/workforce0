/**
 * LocalWhisperProvider — talks to faster-whisper-server's OpenAI-compatible
 * /v1/audio/transcriptions endpoint over the internal Docker network.
 *
 * @module services/stt/providers/local-whisper
 */

import { createChildLogger } from '../../../lib/logger.js';
import type { STTProvider, STTProviderId, TranscribeInput, TranscribeResult } from '../stt-provider.types.js';

const logger = createChildLogger({ service: 'LocalWhisperProvider' });

/** Base transcription timeout — 5 minutes is enough for most meeting
 * recordings on CPU; GPU is far faster. The actual timeout is
 * `LOCAL_WHISPER_BASE_TIMEOUT_MS * timeoutMult`. */
const BASE_TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;

export interface LocalWhisperProviderConfig {
  baseUrl: string | undefined;
  /**
   * Multiplier applied to the base 5-minute transcription timeout.
   *
   * Defaults to 2.0 (= 10 minutes), which is what the env-var docs imply.
   * Bump it for slow CPUs or unusually long recordings; cut it back when
   * you're running on GPU and want to fail fast on stuck workers.
   *
   * Note: this is NOT a multiplier on audio duration — we don't know the
   * audio duration ahead of time (input is just bytes). If/when we estimate
   * duration from file size, revisit this contract.
   */
  timeoutMult?: number;
}

export class LocalWhisperProvider implements STTProvider {
  readonly id: STTProviderId = 'local';

  constructor(private readonly config: LocalWhisperProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    if (!this.config.baseUrl) return false;
    try {
      const res = await fetch(`${this.config.baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      return res.ok;
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'Local Whisper health check failed');
      return false;
    }
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (!this.config.baseUrl) throw new Error('LocalWhisperProvider not configured');

    const form = new FormData();
    form.append('file', new Blob([input.audio]), input.filename);
    form.append('model', 'whisper-1');                  // faster-whisper-server's default
    form.append('response_format', 'verbose_json');
    if (input.language) form.append('language', input.language);
    if (input.domainPrompt) form.append('prompt', input.domainPrompt);

    // Apply the configured multiplier on the base timeout. Default 2.0
    // gives operators a 10-minute ceiling, which clears most CPU-bound
    // transcriptions while still failing fast on stuck workers.
    const timeoutMs = Math.round(
      BASE_TRANSCRIBE_TIMEOUT_MS * (this.config.timeoutMult ?? 2.0),
    );

    const res = await fetch(`${this.config.baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Local Whisper failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      text: string;
      duration?: number;
      language?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    return {
      text: data.text,
      segments: data.segments ?? [],
      durationSec: data.duration ?? 0,
      language: data.language ?? 'en',
    };
  }
}
