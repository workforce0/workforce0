/**
 * =============================================================================
 * TRANSCRIPTION SERVICE
 * =============================================================================
 *
 * Integration with OpenAI Whisper API for audio transcription.
 *
 * What is Whisper?
 * ----------------
 * OpenAI's Whisper is an automatic speech recognition (ASR) model that can
 * transcribe audio in multiple languages with word-level timestamps.
 *
 * API Overview:
 * -------------
 * POST /v1/audio/transcriptions  -> Transcribe audio file
 *   - Accepts files up to 25MB
 *   - Supports mp3, mp4, mpeg, mpga, m4a, wav, webm
 *   - Returns segments with timestamps when using verbose_json
 *
 * Chunking Strategy:
 * ------------------
 * For files larger than 24MB, we split into ~24MB chunks and transcribe
 * each independently, then merge segments with overlap deduplication.
 * A 30-second overlap window is used to avoid losing words at chunk
 * boundaries.
 *
 * @module services/transcription
 */

import { createChildLogger } from '../../lib/logger.js';
import type { STTProviderRouter } from '../stt/stt-router.service.js';

const logger = createChildLogger({ service: 'TranscriptionService' });

/**
 * Maximum file size for a single Whisper API request (24MB).
 * Whisper supports up to 25MB, but we use 24MB to leave headroom.
 */
const WHISPER_CHUNK_SIZE = 24 * 1024 * 1024; // 24MB

/**
 * Overlap window in seconds for deduplicating segments across chunks.
 */
const OVERLAP_SECONDS = 30;

/**
 * Whisper API endpoint.
 */
const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * A single transcription segment with start/end timestamps.
 */
export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Result of a full transcription pipeline.
 */
export interface TranscriptionResult {
  segments: WhisperSegment[];
  fullText: string;
  duration: number;
  wordCount: number;
  language: string;
}

/**
 * Byte range for a chunk of an audio file.
 */
export interface ChunkRange {
  start: number;
  end: number;
}

/**
 * Raw response from Whisper API with verbose_json format.
 */
interface WhisperApiResponse {
  text: string;
  language: string;
  duration: number;
  segments: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * TranscriptionService for OpenAI Whisper API integration.
 *
 * Handles audio transcription including chunking for large files,
 * API communication, and segment merging with overlap deduplication.
 *
 * @example
 * ```typescript
 * const service = new TranscriptionService(openaiApiKey);
 *
 * if (service.isEnabled()) {
 *   const result = await service.transcribe(audioBuffer, 'meeting.mp3');
 *   console.log(result.fullText);
 *   console.log(`Duration: ${result.duration}s, Words: ${result.wordCount}`);
 * }
 * ```
 */
export class TranscriptionService {
  private readonly apiKey: string;
  private readonly sttRouter?: STTProviderRouter;

  /**
   * @param openaiApiKey - OpenAI API key for the legacy direct path. Pass an
   *   empty string when delegating to an `sttRouter` that already wraps the
   *   provider chain.
   * @param sttRouter - Optional router that delegates to the configured STT
   *   chain (local Whisper → OpenAI). When present, the per-chunk single-shot
   *   call goes through the router instead of calling OpenAI directly. The
   *   chunking loop (for files >24 MB) is retained either way to keep the
   *   OpenAI 25 MB upload limit from breaking large meetings.
   */
  constructor(openaiApiKey: string, sttRouter?: STTProviderRouter) {
    this.apiKey = openaiApiKey;
    this.sttRouter = sttRouter;

    if (this.sttRouter) {
      logger.info('TranscriptionService initialized (STTProviderRouter delegation)');
    } else if (this.apiKey) {
      logger.info('TranscriptionService initialized (legacy OpenAI direct path)');
    } else {
      logger.warn('TranscriptionService disabled: no OpenAI API key and no STTProviderRouter');
    }
  }

  /**
   * Check if the service is enabled.
   *
   * Enabled when either an STTProviderRouter is wired (it owns provider
   * availability) or a legacy OpenAI API key is set.
   *
   * @returns true if the service can transcribe
   */
  isEnabled(): boolean {
    return !!this.sttRouter || !!this.apiKey;
  }

  /**
   * Calculate byte-range chunks for an audio file.
   *
   * Files under WHISPER_CHUNK_SIZE (24MB) get a single chunk.
   * Larger files are split into approximately 24MB chunks.
   *
   * @param fileSizeBytes - Total size of the audio file in bytes
   * @returns Array of chunk byte ranges
   */
  calculateChunks(fileSizeBytes: number): ChunkRange[] {
    if (fileSizeBytes <= 0) {
      return [];
    }

    if (fileSizeBytes <= WHISPER_CHUNK_SIZE) {
      return [{ start: 0, end: fileSizeBytes }];
    }

    const chunks: ChunkRange[] = [];
    let offset = 0;

    while (offset < fileSizeBytes) {
      const end = Math.min(offset + WHISPER_CHUNK_SIZE, fileSizeBytes);
      chunks.push({ start: offset, end });
      offset = end;
    }

    return chunks;
  }

  /**
   * Full transcription pipeline for an audio buffer.
   *
   * 1. Calculates chunks based on buffer size
   * 2. Sends each chunk to Whisper API
   * 3. Merges segments across chunks with overlap deduplication
   * 4. Returns unified transcription result
   *
   * @param audioBuffer - The audio file as a Buffer
   * @param filename - Original filename (used for MIME type detection)
   * @param mimeType - Optional MIME type override
   * @returns Transcription result with segments, text, and metadata
   */
  /**
   * PG.7: Optional domain-aware prompt passed through to Whisper's
   * `prompt` parameter. The string is treated as a hint for the
   * decoder — when you pass your product's jargon here ("BAAgent",
   * "chief_of_staff", "N6 cutover"), Whisper is more likely to
   * spell those terms correctly instead of phonetic approximations.
   * Inspired by https://github.com/safishamsi/graphify — their
   * corpus-derived Whisper prompt trick is the reason this exists.
   *
   * Kept to 224 tokens (Whisper's hard cap on the prompt field —
   * longer strings are silently truncated by OpenAI).
   */
  async transcribe(
    audioBuffer: Buffer,
    filename: string,
    mimeType?: string,
    opts?: { domainPrompt?: string },
  ): Promise<TranscriptionResult> {
    if (!this.isEnabled()) {
      throw new Error('TranscriptionService is not enabled: missing API key');
    }

    logger.info('Starting transcription', {
      filename,
      sizeBytes: audioBuffer.length,
      mimeType,
      delegate: this.sttRouter ? 'router' : 'openai-direct',
    });

    const chunks = this.calculateChunks(audioBuffer.length);

    logger.info('Calculated chunks', {
      totalChunks: chunks.length,
      fileSizeBytes: audioBuffer.length,
    });

    const resolvedMimeType = mimeType || this.inferMimeType(filename);
    const allSegments: WhisperSegment[] = [];
    let language = '';
    let totalDuration = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkBuffer = audioBuffer.subarray(chunk.start, chunk.end);

      logger.info('Transcribing chunk', {
        chunkIndex: i,
        chunkSize: chunkBuffer.length,
        start: chunk.start,
        end: chunk.end,
      });

      const response = await this.transcribeChunkSingleShot(
        chunkBuffer,
        filename,
        resolvedMimeType,
        opts?.domainPrompt,
      );

      // Use language from first chunk response
      if (i === 0 && response.language) {
        language = response.language;
      }

      // Track max duration across chunks
      if (response.duration > totalDuration) {
        totalDuration = response.duration;
      }

      // For multi-chunk files, offset segment timestamps by estimated chunk start time
      // This is approximate since byte offset doesn't map linearly to time,
      // but provides a reasonable ordering for segment merging
      const timeOffset = i > 0 ? this.estimateTimeOffset(i, chunks.length, totalDuration) : 0;

      for (const segment of response.segments) {
        allSegments.push({
          start: segment.start + timeOffset,
          end: segment.end + timeOffset,
          text: segment.text.trim(),
        });
      }
    }

    // Merge segments with overlap deduplication
    const mergedSegments = this.mergeSegments(allSegments);

    const fullText = mergedSegments.map((s) => s.text).join(' ');
    const wordCount = fullText.split(/\s+/).filter((w) => w.length > 0).length;
    const duration =
      mergedSegments.length > 0
        ? mergedSegments[mergedSegments.length - 1].end
        : 0;

    const result: TranscriptionResult = {
      segments: mergedSegments,
      fullText,
      duration,
      wordCount,
      language,
    };

    logger.info('Transcription complete', {
      filename,
      segments: mergedSegments.length,
      wordCount: result.wordCount,
      duration: result.duration,
      language: result.language,
    });

    return result;
  }

  /**
   * Transcribe a single audio chunk via the configured path.
   *
   * When an `STTProviderRouter` is wired the router owns the provider
   * fallback chain (local Whisper → OpenAI → …). Otherwise we fall back
   * to the legacy direct OpenAI Whisper call so existing installs that
   * never set up the router keep working.
   *
   * The `domainPrompt` is forwarded through both paths — the router's
   * `TranscribeInput` accepts it, and individual providers append it
   * to the multipart form as Whisper's `prompt` parameter.
   */
  private async transcribeChunkSingleShot(
    chunkBuffer: Buffer,
    filename: string,
    mimeType: string,
    domainPrompt?: string,
  ): Promise<WhisperApiResponse> {
    if (this.sttRouter) {
      const result = await this.sttRouter.transcribe({
        audio: new Uint8Array(chunkBuffer),
        filename,
        domainPrompt: domainPrompt && domainPrompt.trim()
          ? domainPrompt.slice(0, 1000)
          : undefined,
      });
      return {
        text: result.text,
        language: result.language,
        duration: result.durationSec,
        segments: result.segments.map((s, idx) => ({
          id: idx,
          start: s.start,
          end: s.end,
          text: s.text,
        })),
      };
    }
    return this.callWhisperApi(chunkBuffer, filename, mimeType, domainPrompt);
  }

  /**
   * Call the Whisper API for a single audio chunk.
   *
   * @param chunkBuffer - Audio data for this chunk
   * @param filename - Original filename
   * @param mimeType - MIME type for the audio
   * @returns Raw Whisper API response
   */
  private async callWhisperApi(
    chunkBuffer: Buffer,
    filename: string,
    mimeType: string,
    domainPrompt?: string,
  ): Promise<WhisperApiResponse> {
    const formData = new FormData();

    // @types/node 25 narrowed Buffer's ArrayBufferLike to ArrayBuffer;
    // the native Blob BlobPart rejects the wider type. `.slice()` on a
    // Uint8Array view returns a fresh Uint8Array<ArrayBuffer>.
    const blob = new Blob([new Uint8Array(chunkBuffer).slice()], { type: mimeType });
    formData.append('file', blob, filename);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
    // PG.7: pass a short domain-specific prompt to bias the decoder
    // toward product / codebase jargon. Whisper silently truncates
    // at ~224 tokens; we cap to ~1000 chars as a safe byte budget.
    if (domainPrompt && domainPrompt.trim()) {
      formData.append('prompt', domainPrompt.slice(0, 1000));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min timeout

    try {
      const response = await fetch(WHISPER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('Whisper API error', {
          status: response.status,
          body: errorBody,
        });

        let message = 'Whisper API error';
        try {
          const parsed = JSON.parse(errorBody);
          message = parsed.error?.message || parsed.error || message;
        } catch {
          message = errorBody || message;
        }

        throw new Error(`Whisper API error (${response.status}): ${message}`);
      }

      return (await response.json()) as WhisperApiResponse;
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new Error('Whisper API request timed out after 120 seconds', { cause: error });
      }

      throw error;
    }
  }

  /**
   * Merge segments from multiple chunks, deduplicating overlapping segments.
   *
   * When chunks are transcribed independently, the boundaries can produce
   * duplicate or overlapping segments. This method removes segments that
   * overlap within a 30-second window, keeping the earlier occurrence.
   *
   * @param segments - All segments from all chunks
   * @returns Deduplicated and sorted segments
   */
  private mergeSegments(segments: WhisperSegment[]): WhisperSegment[] {
    if (segments.length <= 1) {
      return segments;
    }

    // Sort by start time
    const sorted = [...segments].sort((a, b) => a.start - b.start);

    const merged: WhisperSegment[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];

      // Check for overlap: if current segment starts within OVERLAP_SECONDS
      // of the previous segment's end, and the text is similar, skip it
      if (
        current.start < last.end + OVERLAP_SECONDS &&
        this.textSimilarity(current.text, last.text) > 0.7
      ) {
        // Skip duplicate segment, but extend the end time if needed
        if (current.end > last.end) {
          last.end = current.end;
        }
        continue;
      }

      merged.push(current);
    }

    return merged;
  }

  /**
   * Calculate text similarity using a simple word overlap ratio.
   *
   * @param a - First text
   * @param b - Second text
   * @returns Similarity score between 0 and 1
   */
  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let overlap = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) overlap++;
    }

    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  /**
   * Estimate time offset for a chunk based on its position.
   *
   * Since byte offset doesn't linearly map to audio time (due to
   * variable bitrate encoding), this uses a proportional estimate.
   *
   * @param chunkIndex - Index of the current chunk
   * @param totalChunks - Total number of chunks
   * @param estimatedDuration - Duration estimate from first chunk
   * @returns Estimated time offset in seconds
   */
  private estimateTimeOffset(
    chunkIndex: number,
    totalChunks: number,
    estimatedDuration: number
  ): number {
    // Proportional estimate: each chunk covers roughly equal time
    return (chunkIndex / totalChunks) * estimatedDuration * totalChunks;
  }

  /**
   * Infer MIME type from filename extension.
   *
   * @param filename - The filename to check
   * @returns Appropriate MIME type string
   */
  private inferMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();

    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      mp4: 'audio/mp4',
      mpeg: 'audio/mpeg',
      mpga: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      webm: 'audio/webm',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
    };

    return mimeTypes[ext || ''] || 'audio/mpeg';
  }
}
