/**
 * VoiceProviderRouter — picks a VoiceProvider for a tenant, falls through on
 * !isAvailable. Never falls through mid-session (callers handle session-level errors).
 *
 * @module services/voice-provider/voice-provider-router.service
 */

import { createChildLogger } from '../../lib/logger.js';
import type { VoiceProvider, VoiceProviderId } from './voice-provider.types.js';

const logger = createChildLogger({ service: 'VoiceProviderRouter' });
// NOTE: gemini/openai realtime providers were temporarily removed from the
// default rotation. Their wrapped session adapters do not yet emit the `'end'`
// event the providers wait for, so they would hang on transcript completion
// rather than fall through. Until that wiring is finished, the router only
// considers `pipecat` (local STT/LLM/TTS) by default. A tenant can still
// explicitly select `gemini` or `openai` via `voiceProviderId` settings —
// the router will try the preferred provider first, then fall through to the
// default chain (pipecat only) if it is unavailable.
const DEFAULT_ORDER: VoiceProviderId[] = ['pipecat'];

interface TenantSettingsLike {
  get(tenantId: string): Promise<{ voiceProviderId: VoiceProviderId | null }>;
}

export class VoiceProviderRouter {
  private readonly providers: Map<VoiceProviderId, VoiceProvider>;

  constructor(
    providers: VoiceProvider[],
    private readonly tenantSettings: TenantSettingsLike,
  ) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }

  async resolveProvider(tenantId: string): Promise<VoiceProvider | null> {
    const settings = await this.tenantSettings.get(tenantId);
    const preferred = settings.voiceProviderId;
    const order: VoiceProviderId[] = preferred
      ? [preferred, ...DEFAULT_ORDER.filter((x) => x !== preferred)]
      : [...DEFAULT_ORDER];
    for (const id of order) {
      const provider = this.providers.get(id);
      if (!provider) continue;
      try {
        if (await provider.isAvailable()) {
          logger.debug({ tenantId, picked: id, preferred }, 'Voice provider resolved');
          return provider;
        }
      } catch (err) {
        // `err` may be a non-Error throw (string, number, plain object). Normalize.
        const message =
          err instanceof Error ? err.message : String(err);
        logger.warn(
          { tenantId, providerId: id, err: message },
          'isAvailable threw; skipping',
        );
      }
    }
    logger.error({ tenantId }, 'No voice provider available');
    return null;
  }
}
