/**
 * STTProvider — abstracts speech-to-text across local Whisper, OpenAI
 * Whisper API, and Deepgram (future).
 *
 * @module services/stt/stt-provider.types
 */

export type STTProviderId = 'local' | 'openai' | 'deepgram';

export interface TranscribeInput {
  /** Audio file as Buffer/Uint8Array. */
  audio: Uint8Array;
  /** Original file name (used for content-type sniffing). */
  filename: string;
  /** ISO 639-1 language hint (omit for autodetect). */
  language?: string;
}

export interface TranscribeResult {
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  durationSec: number;
  language: string;
}

export interface STTProvider {
  readonly id: STTProviderId;
  isAvailable(): Promise<boolean>;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}
