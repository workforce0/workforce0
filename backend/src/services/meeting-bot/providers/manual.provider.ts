/**
 * ManualProvider — always-available terminal fallback.
 *
 * Returned by the router when no other provider can schedule a bot.
 * scheduleBot deliberately throws so callers can branch into the
 * "ask the user to upload after the meeting" path.
 *
 * @module services/meeting-bot/providers/manual
 */

import {
  type MeetingBotProvider,
  type MeetingTranscript,
  type ProviderId,
  type ScheduleBotInput,
  type ScheduleBotResult,
  ProviderNotSchedulableError,
} from '../meeting-bot-provider.types.js';

export class ManualProvider implements MeetingBotProvider {
  readonly id: ProviderId = 'manual';
  readonly displayName = 'Manual upload';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async scheduleBot(_input: ScheduleBotInput): Promise<ScheduleBotResult> {
    throw new ProviderNotSchedulableError(this.id);
  }

  async cancelBot(_botId: string): Promise<void> {
    // No-op — there's nothing to cancel.
  }

  async getTranscript(_botId: string): Promise<MeetingTranscript | null> {
    return null;
  }
}
