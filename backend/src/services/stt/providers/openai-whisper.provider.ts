/**
 * OpenAIWhisperProvider — BYOK provider for OpenAI's Whisper API.
 *
 * For files <24 MB, single-shot upload. Larger files should be chunked
 * by the caller (TranscriptionService) before reaching this provider —
 * we keep the chunking logic out of the provider for now to preserve
 * the existing TranscriptionService behavior.
 *
 * @module services/stt/providers/openai-whisper
 */

import { createChildLogger } from '../../../lib/logger.js';
import type { STTProvider, STTProviderId, TranscribeInput, TranscribeResult } from '../stt-provider.types.js';

const logger = createChildLogger({ service: 'OpenAIWhisperProvider' });
const OPENAI_WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

export interface OpenAIWhisperProviderConfig {
  apiKey: string | undefined;
}

export class OpenAIWhisperProvider implements STTProvider {
  readonly id: STTProviderId = 'openai';

  constructor(private readonly config: OpenAIWhisperProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    return typeof this.config.apiKey === 'string' && this.config.apiKey.length > 0;
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (!this.config.apiKey) throw new Error('OpenAIWhisperProvider: OPENAI_API_KEY not set');

    const form = new FormData();
    form.append('file', new Blob([input.audio]), input.filename);
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    if (input.language) form.append('language', input.language);
    if (input.domainPrompt) form.append('prompt', input.domainPrompt);

    const res = await fetch(OPENAI_WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI Whisper failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      text: string;
      duration?: number;
      language?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    logger.debug({ chars: data.text?.length ?? 0, segments: data.segments?.length ?? 0 }, 'OpenAI Whisper transcribe complete');

    return {
      text: data.text,
      segments: data.segments ?? [],
      durationSec: data.duration ?? 0,
      language: data.language ?? 'en',
    };
  }
}
