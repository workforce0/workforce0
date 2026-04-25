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

  /**
   * `isAvailable()` is called from the meeting-bot router on every resolve to
   * decide whether to fall back to another provider. Without caching that
   * means we burn a Recall API quota hit per scheduling request, which both
   * costs money and tanks p99 latency. Cache the result for a short TTL.
   */
  private cachedAvailability: { result: boolean; expiresAt: number } | null = null;
  private readonly availabilityCacheMs = 30_000;

  constructor(private readonly config: RecallProviderConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_RECALL_API_BASE;
  }

  /** Test seam — lets unit tests force a fresh availability probe. */
  clearAvailabilityCache(): void {
    this.cachedAvailability = null;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    const now = Date.now();
    if (this.cachedAvailability && this.cachedAvailability.expiresAt > now) {
      return this.cachedAvailability.result;
    }
    let result = false;
    try {
      const res = await fetch(`${this.baseUrl}/bot/?limit=1`, {
        headers: { Authorization: `Token ${this.config.apiKey}` },
        signal: AbortSignal.timeout(2_000),
      });
      result = res.ok;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Recall availability check failed');
      result = false;
    }
    this.cachedAvailability = { result, expiresAt: now + this.availabilityCacheMs };
    return result;
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
        ...(input.startTime ? { join_at: input.startTime } : {}),
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

  /**
   * Fetch the bot's recording metadata and (when ready) the transcript.
   *
   * Recall.ai's `GET /api/v1/bot/{id}/` returns:
   *   - `status_changes`: array of { code, ... } — terminal state when the
   *     latest entry has `code === 'done'`.
   *   - `recordings[].media_shortcuts.transcript.data.download_url`: a
   *     pre-signed URL to a JSON document with the actual transcript
   *     content (Whisper-style segments).
   *
   * Earlier code in this file assumed a flat `data.transcript: [{ speaker,
   * words: [...] }]` shape that doesn't match the documented Recall response
   * (https://docs.recall.ai/reference/bot_retrieve). Rather than guess the
   * download_url payload shape without a live account to verify against, we
   * keep this method honest: return null while pending, throw a clear error
   * once the bot reports `done` so we know exactly when to revisit. The
   * production transcript pipeline (`MeetingService.captureFromBot`) treats
   * a null return as "still recording" and re-polls.
   *
   * TODO(recall-transcript): wire up the download_url fetch + segment parse
   * once we have a Recall sandbox to validate the JSON shape against.
   */
  async getTranscript(botId: string): Promise<MeetingTranscript | null> {
    const res = await fetch(`${this.baseUrl}/bot/${botId}/`, {
      headers: { Authorization: `Token ${this.requireKey()}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw new Error(`Recall getTranscript failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      id?: string;
      status_changes?: Array<{ code?: string }>;
      recordings?: Array<{
        media_shortcuts?: {
          transcript?: {
            data?: { download_url?: string | null } | null;
          } | null;
        } | null;
      }>;
    };

    const latestStatus =
      data.status_changes && data.status_changes.length > 0
        ? data.status_changes[data.status_changes.length - 1]?.code
        : undefined;
    const downloadUrl =
      data.recordings?.[0]?.media_shortcuts?.transcript?.data?.download_url ?? null;

    // Bot still recording / processing: caller should re-poll.
    if (latestStatus !== 'done' || !downloadUrl) {
      logger.debug(
        { botId, status: latestStatus, hasDownloadUrl: Boolean(downloadUrl) },
        'Recall transcript not ready yet',
      );
      return null;
    }

    // Bot is done and a transcript URL is available — but the download_url
    // payload shape isn't fully nailed down in our integration tests yet.
    // Fail loudly so we don't silently parse the wrong format in prod.
    throw new Error(
      `Recall getTranscript: bot ${botId} is done but transcript download is not yet implemented. ` +
        'Verify the download_url payload shape against https://docs.recall.ai/reference/bot_retrieve ' +
        'and finish wiring the parser. download_url available, segments parser is a TODO.',
    );
  }

  private requireKey(): string {
    if (!this.config.apiKey) throw new Error('RecallProvider: RECALL_API_KEY not set');
    return this.config.apiKey;
  }
}
