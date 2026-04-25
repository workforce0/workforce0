/**
 * MeetingBotProvider — abstracts live-meeting capture across Vexa
 * (bundled), Recall.ai (BYOK), and Manual (always-available fallback).
 *
 * @module services/meeting-bot/meeting-bot-provider.types
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

export type ProviderId = 'vexa' | 'recall' | 'manual';

export interface ScheduleBotInput {
  /** The meeting URL (Google Meet / Zoom / Teams). */
  meetingUrl: string;
  /** Workforce0 meeting row ID (created upstream by route). */
  meetingId: string;
  /** Tenant scope. Required for routing + telemetry. */
  tenantId: string;
  /** Display name for the bot in the meeting (default: "Workforce0 Bot"). */
  botName?: string;
  /** ISO 8601 timestamp for when the bot should join. If absent, providers join now. */
  startTime?: string;
}

export interface ScheduleBotResult {
  /** Provider-side bot identifier; opaque to Workforce0. */
  botId: string;
  status: 'scheduled' | 'joining' | 'failed';
  /** ISO8601 estimated join time, if the provider knows. */
  estimatedJoinTime?: string;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
}

export interface MeetingTranscript {
  segments: TranscriptSegment[];
  durationSec: number;
  participants: string[];
  /** ISO 639-1 language code (e.g. "en", "es"). */
  language: string;
}

export class ProviderNotSchedulableError extends Error {
  constructor(providerId: ProviderId) {
    super(`Provider '${providerId}' does not support scheduleBot`);
    this.name = 'ProviderNotSchedulableError';
  }
}

export interface MeetingBotProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  /** Returns false if keys/services aren't configured. */
  isAvailable(): Promise<boolean>;

  /** Schedule a bot to join a live meeting. `manual` always throws ProviderNotSchedulableError. */
  scheduleBot(input: ScheduleBotInput): Promise<ScheduleBotResult>;

  /** Cancel a scheduled bot (best-effort; OK if already left). */
  cancelBot(botId: string): Promise<void>;

  /** Fetch the transcript when the bot reports done. Returns null if not ready. */
  getTranscript(botId: string): Promise<MeetingTranscript | null>;

  /** Optional: provider-specific webhook handler. Mounted at /webhooks/meeting-bot/<id>. */
  handleWebhook?(req: FastifyRequest, reply: FastifyReply): Promise<void>;
}
