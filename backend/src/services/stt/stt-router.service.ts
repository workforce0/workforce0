/**
 * STTProviderRouter — picks an STT provider from a chain, falls through
 * on availability or transcribe failure.
 *
 * @module services/stt/stt-router.service
 */

import { createChildLogger } from '../../lib/logger.js';
import type { STTProvider, STTProviderId, TranscribeInput, TranscribeResult } from './stt-provider.types.js';

const logger = createChildLogger({ service: 'STTProviderRouter' });

export class STTProviderRouter {
  private readonly providers: Map<STTProviderId, STTProvider>;

  constructor(providers: STTProvider[], private readonly chain: STTProviderId[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    let lastErr: Error | null = null;
    for (const id of this.chain) {
      const provider = this.providers.get(id);
      if (!provider) continue;
      let available = false;
      try {
        available = await provider.isAvailable();
      } catch (err) {
        logger.warn({ id, err: (err as Error).message }, 'isAvailable threw');
      }
      if (!available) continue;
      try {
        return await provider.transcribe(input);
      } catch (err) {
        lastErr = err as Error;
        logger.warn({ providerId: id, err: lastErr.message }, 'STT provider threw; falling through');
      }
    }
    throw new Error(`All STT providers exhausted: ${lastErr?.message ?? 'no providers available'}`);
  }
}
