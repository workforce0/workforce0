/**
 * LocalWhisperProvider — talks to faster-whisper-server's OpenAI-compatible
 * /v1/audio/transcriptions endpoint over the internal Docker network.
 *
 * @module services/stt/providers/local-whisper
 */

import { createChildLogger } from '../../../lib/logger.js';
import type { STTProvider, STTProviderId, TranscribeInput, TranscribeResult } from '../stt-provider.types.js';

const logger = createChildLogger({ service: 'LocalWhisperProvider' });

export interface LocalWhisperProviderConfig {
  baseUrl: string | undefined;
  /** Multiplier on estimated audio duration for the request timeout. */
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

    // We don't know the audio duration in advance; use a generous fixed timeout.
    // 5 minutes covers most meeting recordings on CPU; GPU is much faster.
    const timeoutMs = 5 * 60 * 1000;

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
