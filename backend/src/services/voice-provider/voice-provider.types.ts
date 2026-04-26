/**
 * VoiceProvider — abstracts the LLM-backed voice agent across Gemini Live,
 * OpenAI Realtime, and the Pipecat sidecar (local STT+LLM+TTS).
 *
 * @module services/voice-provider/voice-provider.types
 */

import type { WebSocket } from 'ws';

export type VoiceProviderId = 'gemini' | 'openai' | 'pipecat';

export interface TranscriptDoc {
  /** Full transcript text, speaker-tagged turns joined with newlines. */
  text: string;
  /** Per-turn structured form for the BA Agent. */
  turns: Array<{ speaker: 'agent' | 'caller'; text: string; startMs: number; endMs: number }>;
  durationSec: number;
  language: string;
}

export interface VoiceSessionInput {
  /** Twilio CallSid. */
  callId: string;
  tenantId: string;
  /** E.164 caller number. */
  callerNumber: string;
  /** Open WebSocket to Twilio for media streaming. */
  audioInWs: WebSocket;
  /** System prompt for the LLM (intake mode). */
  systemPrompt: string;
}

export interface VoiceSessionHandle {
  sessionId: string;
  /** Caller hung up or system requested end. Closes pipeline cleanly. */
  stop(): Promise<void>;
  /** Fires once when the session ends with a non-empty transcript. */
  onTranscriptComplete(cb: (transcript: TranscriptDoc) => void): void;
  /** Fires on unrecoverable errors. */
  onError(cb: (err: Error) => void): void;
}

export interface VoiceProvider {
  readonly id: VoiceProviderId;
  /** False when the provider's prerequisites (key, container, etc.) aren't met. */
  isAvailable(): Promise<boolean>;
  startSession(input: VoiceSessionInput): Promise<VoiceSessionHandle>;
}

/** Returned by CallerAuthService.checkCallerId. */
export type CallerCheckResult = 'allowed' | 'needs_pin' | 'not_configured';
