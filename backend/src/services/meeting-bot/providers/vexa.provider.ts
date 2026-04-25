/**
 * VexaProvider — bundled local meeting bot via Vexa Compose stack.
 *
 * Talks to vexa-api over the internal Docker network (default
 * http://vexa-api:18056). When the meeting-bot Compose profile is off,
 * isAvailable() returns false and the router falls through.
 *
 * @module services/meeting-bot/providers/vexa
 */

import { createChildLogger } from '../../../lib/logger.js';
import type {
  MeetingBotProvider,
  MeetingTranscript,
  ProviderId,
  ScheduleBotInput,
  ScheduleBotResult,
  TranscriptSegment,
} from '../meeting-bot-provider.types.js';

const logger = createChildLogger({ service: 'VexaProvider' });

export interface VexaProviderConfig {
  baseUrl: string;
}

interface VexaBotStatusBody {
  status: 'queued' | 'joining' | 'in_progress' | 'completed' | 'failed';
  duration?: number;
  language?: string;
  participants?: string[];
  segments?: Array<{ speaker: string; text: string; start: number; end: number }>;
}

export class VexaProvider implements MeetingBotProvider {
  readonly id: ProviderId = 'vexa';
  readonly displayName = 'Vexa (bundled)';

  constructor(private readonly config: VexaProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'Vexa health check failed');
      return false;
    }
  }

  async scheduleBot(input: ScheduleBotInput): Promise<ScheduleBotResult> {
    const res = await fetch(`${this.config.baseUrl}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_url: input.meetingUrl,
        bot_name: input.botName ?? 'Workforce0 Bot',
        metadata: { tenantId: input.tenantId, meetingId: input.meetingId },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Vexa scheduleBot failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { id: string; status?: string };
    return { botId: data.id, status: (data.status as ScheduleBotResult['status']) ?? 'scheduled' };
  }

  async cancelBot(botId: string): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/bots/${botId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Vexa cancelBot failed: ${res.status}`);
    }
  }

  async getTranscript(botId: string): Promise<MeetingTranscript | null> {
    const res = await fetch(`${this.config.baseUrl}/bots/${botId}/transcript`);
    if (!res.ok) {
      throw new Error(`Vexa getTranscript failed: ${res.status}`);
    }
    const data = (await res.json()) as VexaBotStatusBody;
    if (data.status !== 'completed' || !data.segments || data.segments.length === 0) return null;

    const segments: TranscriptSegment[] = data.segments.map((s) => ({
      speaker: s.speaker,
      text: s.text,
      startSec: s.start,
      endSec: s.end,
    }));
    return {
      segments,
      durationSec: data.duration ?? 0,
      participants: data.participants ?? [...new Set(segments.map((s) => s.speaker))],
      language: data.language ?? 'en',
    };
  }
}
