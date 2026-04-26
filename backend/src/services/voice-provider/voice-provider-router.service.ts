/**
 * VoiceProviderRouter — picks a VoiceProvider for a tenant, falls through on
 * !isAvailable. Never falls through mid-session (callers handle session-level errors).
 *
 * @module services/voice-provider/voice-provider-router.service
 */

import { createChildLogger } from '../../lib/logger.js';
import type { VoiceProvider, VoiceProviderId } from './voice-provider.types.js';

const logger = createChildLogger({ service: 'VoiceProviderRouter' });
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
        logger.warn(
          { tenantId, providerId: id, err: (err as Error).message },
          'isAvailable threw; skipping',
        );
      }
    }
    logger.error({ tenantId }, 'No voice provider available');
    return null;
  }
}
