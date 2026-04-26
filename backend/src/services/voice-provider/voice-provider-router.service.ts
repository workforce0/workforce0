/**
 * VoiceProviderRouter — picks a VoiceProvider for a tenant, falls through on
 * !isAvailable. Never falls through mid-session (callers handle session-level errors).
 *
 * @module services/voice-provider/voice-provider-router.service
 */

import { createChildLogger } from '../../lib/logger.js';
import type { VoiceProvider, VoiceProviderId } from './voice-provider.types.js';

const logger = createChildLogger({ service: 'VoiceProviderRouter' });
// DEFAULT_ORDER is the conceptual priority of voice providers when a tenant has
// not pinned one in `voiceProviderId` settings. It deliberately lists all three
// providers — pipecat (local STT/LLM/TTS) is the cheapest/fastest, with gemini
// and openai realtime as cloud fallbacks.
//
// Availability is gated TWICE:
//   1. `di-container.ts` only *registers* providers whose transcript wiring is
//      verified end-to-end. Currently that means gemini/openai are NOT
//      registered (their wrapped session adapters don't emit `'end'` for
//      transcript completion yet — re-enable when that wiring lands). So the
//      router practically only sees `pipecat`.
//   2. Per-call `provider.isAvailable()` checks (e.g. API key present) gate
//      individual providers at resolve time.
//
// The loop below `provider = this.providers.get(id); if (!provider) continue;`
// silently skips unregistered IDs, so leaving them in DEFAULT_ORDER is
// harmless — it documents intent without forcing registration.
const DEFAULT_ORDER: VoiceProviderId[] = ['pipecat', 'gemini', 'openai'];

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
