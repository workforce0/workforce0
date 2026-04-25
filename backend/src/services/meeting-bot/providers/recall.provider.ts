/**
 * RecallProvider — BYOK integration with Recall.ai.
 *
 * Requires RECALL_API_KEY in env. RECALL_WEBHOOK_SECRET is used by the
 * route handler in routes/webhooks/meeting-bot-recall.routes.ts to
 * verify HMAC signatures on incoming events.
 *
 * @module services/meeting-bot/providers/recall
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

const logger = createChildLogger({ service: 'RecallProvider' });

/**
 * Default Recall.ai endpoint. Recall.ai is regionalized — see
 * https://docs.recall.ai/docs/regions for the full list (us-west-2,
 * us-east-1, eu-central-1, etc.). Operators on a non-default region
 * should set `RECALL_API_BASE_URL` to override.
 */
const DEFAULT_RECALL_API_BASE = 'https://us-west-2.recall.ai/api/v1';

export interface RecallProviderConfig {
  apiKey: string | undefined;
  webhookSecret: string | undefined;
  /** Override the default region endpoint. Defaults to us-west-2. */
  baseUrl?: string;
}

export class RecallProvider implements MeetingBotProvider {
  readonly id: ProviderId = 'recall';
  readonly displayName = 'Recall.ai';

  private readonly baseUrl: string;

  constructor(private readonly config: RecallProviderConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_RECALL_API_BASE;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      const res = await fetch(`${this.baseUrl}/bot/?limit=1`, {
        headers: { Authorization: `Token ${this.config.apiKey}` },
      });
      return res.ok;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Recall availability check failed');
      return false;
    }
  }

  async scheduleBot(input: ScheduleBotInput): Promise<ScheduleBotResult> {
    const res = await fetch(`${this.baseUrl}/bot/`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.requireKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        meeting_url: input.meetingUrl,
        bot_name: input.botName ?? 'Workforce0 Bot',
        metadata: { tenantId: input.tenantId, meetingId: input.meetingId },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Recall scheduleBot failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { id: string };
    return { botId: data.id, status: 'scheduled' };
  }

  async cancelBot(botId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/bot/${botId}/leave_call/`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.requireKey()}` },
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(`Recall cancelBot failed: ${res.status} ${body}`);
    }
  }

  async getTranscript(botId: string): Promise<MeetingTranscript | null> {
    const res = await fetch(`${this.baseUrl}/bot/${botId}/`, {
      headers: { Authorization: `Token ${this.requireKey()}` },
    });
    if (!res.ok) {
      throw new Error(`Recall getTranscript failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      transcript?: Array<{ speaker: string; words: Array<{ text: string; start_timestamp: { relative: number }; end_timestamp: { relative: number } }> }>;
    };
    if (!data.transcript || data.transcript.length === 0) return null;

    const segments: TranscriptSegment[] = data.transcript.flatMap((entry) =>
      entry.words.map((w) => ({
        speaker: entry.speaker,
        text: w.text,
        startSec: w.start_timestamp.relative,
        endSec: w.end_timestamp.relative,
      })),
    );

    const lastSeg = segments[segments.length - 1];
    return {
      segments,
      durationSec: lastSeg ? lastSeg.endSec : 0,
      participants: [...new Set(data.transcript.map((e) => e.speaker))],
      language: 'en',
    };
  }

  private requireKey(): string {
    if (!this.config.apiKey) throw new Error('RecallProvider: RECALL_API_KEY not set');
    return this.config.apiKey;
  }
}
