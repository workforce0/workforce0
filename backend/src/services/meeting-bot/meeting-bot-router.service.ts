/**
 * MeetingBotRouter — picks a MeetingBotProvider for a given tenant.
 *
 * Resolution order:
 *   1. Tenant's preferred provider (if registered AND available)
 *   2. Default fallback order: vexa → recall → manual
 *   3. Manual (always available, terminal fallback)
 *
 * @module services/meeting-bot/meeting-bot-router.service
 */

import { createChildLogger } from '../../lib/logger.js';
import type { MeetingBotProvider, ProviderId } from './meeting-bot-provider.types.js';

const logger = createChildLogger({ service: 'MeetingBotRouter' });

interface TenantSettingsLike {
  get(tenantId: string): Promise<{ meetingBotProviderId: ProviderId | null }>;
}

const DEFAULT_ORDER: ProviderId[] = ['vexa', 'recall', 'manual'];

export class MeetingBotRouter {
  private readonly providers: Map<ProviderId, MeetingBotProvider>;

  constructor(
    providers: MeetingBotProvider[],
    private readonly tenantSettings: TenantSettingsLike,
  ) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
    if (!this.providers.has('manual')) {
      throw new Error('MeetingBotRouter requires a ManualProvider as terminal fallback');
    }
  }

  async resolveProvider(tenantId: string): Promise<MeetingBotProvider> {
    const settings = await this.tenantSettings.get(tenantId);
    const preferred = settings.meetingBotProviderId;

    const order: ProviderId[] = preferred
      ? [preferred, ...DEFAULT_ORDER.filter((x) => x !== preferred)]
      : [...DEFAULT_ORDER];

    for (const id of order) {
      const provider = this.providers.get(id);
      if (!provider) continue;
      try {
        if (await provider.isAvailable()) {
          logger.debug({ tenantId, picked: id, preferred }, 'Provider resolved');
          return provider;
        }
      } catch (err) {
        logger.warn({ tenantId, providerId: id, err: (err as Error).message }, 'Provider availability check threw; skipping');
      }
    }

    return this.providers.get('manual')!;
  }
}
