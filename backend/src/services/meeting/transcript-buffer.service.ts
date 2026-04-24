/**
 * =============================================================================
 * TRANSCRIPT BUFFER SERVICE
 * =============================================================================
 *
 * Batches real-time transcript chunks to avoid per-word database writes.
 *
 * Problem: Real-time transcription sends events word-by-word during meetings.
 * Writing to DB for every word would cause:
 * - 20,000+ DB operations for a 1-hour meeting
 * - High latency blocking real-time processing
 * - Database performance issues
 *
 * Solution: Buffer chunks in memory, flush periodically.
 *
 * @module services/meeting/transcript-buffer
 */

import { EventEmitter } from 'events';
import { createChildLogger } from '../../lib/logger.js';
import { MeetingRepository } from '../../repositories/meeting.repository.js';

const logger = createChildLogger({ module: 'TranscriptBuffer' });

/**
 * A single transcript chunk.
 */
export interface TranscriptChunk {
  speaker?: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
  receivedAt: string;
}

/**
 * Buffer for a single meeting's transcript chunks.
 */
interface MeetingBuffer {
  chunks: TranscriptChunk[];
  lastFlush: number;
  flushTimer: NodeJS.Timeout | null;
  flushing: boolean;
}

/**
 * Configuration for the buffer service.
 */
export interface TranscriptBufferConfig {
  /** Maximum chunks before forcing a flush (default: 50) */
  maxChunks?: number;
  /** Maximum time between flushes in ms (default: 5000) */
  flushIntervalMs?: number;
  /** Maximum chunks to keep in DB metadata (default: 100) */
  maxStoredChunks?: number;
}

const DEFAULT_CONFIG: Required<TranscriptBufferConfig> = {
  maxChunks: 50,
  flushIntervalMs: 5000,
  maxStoredChunks: 100,
};

/**
 * Buffers transcript chunks and flushes to database periodically.
 *
 * @example
 * ```typescript
 * const buffer = new TranscriptBufferService(meetingRepository);
 *
 * // Add chunks as they arrive (no DB write per chunk!)
 * buffer.addChunk(meetingId, { speaker: 'John', text: 'Hello', ... });
 *
 * // When meeting ends, flush remaining chunks
 * await buffer.flushMeeting(meetingId);
 * ```
 */
export class TranscriptBufferService extends EventEmitter {
  private readonly meetingRepository: MeetingRepository;
  private readonly config: Required<TranscriptBufferConfig>;
  private readonly buffers: Map<string, MeetingBuffer> = new Map();

  constructor(
    meetingRepository: MeetingRepository,
    config: TranscriptBufferConfig = {}
  ) {
    super();
    this.meetingRepository = meetingRepository;
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('TranscriptBufferService initialized', {
      maxChunks: this.config.maxChunks,
      flushIntervalMs: this.config.flushIntervalMs,
    });
  }

  /**
   * Add a transcript chunk to the buffer.
   * Chunks are batched and flushed periodically, not on every call.
   */
  addChunk(meetingId: string, chunk: Omit<TranscriptChunk, 'receivedAt'>): void {
    let buffer = this.buffers.get(meetingId);

    if (!buffer) {
      buffer = {
        chunks: [],
        lastFlush: Date.now(),
        flushTimer: null,
        flushing: false,
      };
      this.buffers.set(meetingId, buffer);
    }

    // Add chunk with timestamp
    buffer.chunks.push({
      ...chunk,
      receivedAt: new Date().toISOString(),
    });

    // Start flush timer if not running
    if (!buffer.flushTimer) {
      buffer.flushTimer = setTimeout(() => {
        this.flushMeeting(meetingId).catch((err) => {
          logger.error('Auto-flush failed', { meetingId, error: err.message });
        });
      }, this.config.flushIntervalMs);
    }

    // Force flush if buffer is full
    if (buffer.chunks.length >= this.config.maxChunks) {
      logger.debug('Buffer full, forcing flush', {
        meetingId,
        chunks: buffer.chunks.length,
      });
      this.flushMeeting(meetingId).catch((err) => {
        logger.error('Forced flush failed', { meetingId, error: err.message });
      });
    }
  }

  /**
   * Flush all buffered chunks for a meeting to the database.
   * Call this when meeting ends to ensure all chunks are saved.
   */
  async flushMeeting(meetingId: string): Promise<void> {
    const buffer = this.buffers.get(meetingId);

    if (!buffer || buffer.chunks.length === 0 || buffer.flushing) {
      return;
    }

    // Clear timer
    if (buffer.flushTimer) {
      clearTimeout(buffer.flushTimer);
      buffer.flushTimer = null;
    }

    // Lock to prevent concurrent flushes
    buffer.flushing = true;

    // Get chunks to flush and clear buffer
    const chunksToFlush = [...buffer.chunks];
    buffer.chunks = [];
    buffer.lastFlush = Date.now();

    logger.debug('Flushing transcript buffer', {
      meetingId,
      chunks: chunksToFlush.length,
    });

    try {
      const meeting = await this.meetingRepository.findById(meetingId);
      if (!meeting) {
        logger.warn('Meeting not found for flush', { meetingId });
        return;
      }

      // Merge with existing chunks in metadata
      const metadata = (meeting.metadata as Record<string, unknown>) || {};
      const existingChunks = (metadata.transcriptChunks as TranscriptChunk[]) || [];

      // Keep last N chunks total
      const allChunks = [...existingChunks, ...chunksToFlush];
      const trimmedChunks = allChunks.slice(-this.config.maxStoredChunks);

      // Single DB write for all chunks
      await this.meetingRepository.update(meetingId, {
        metadata: JSON.parse(JSON.stringify({
          ...metadata,
          transcriptChunks: trimmedChunks,
          lastChunkAt: new Date().toISOString(),
          chunkCount: trimmedChunks.length,
        })),
      });

      logger.debug('Transcript buffer flushed', {
        meetingId,
        flushed: chunksToFlush.length,
        total: trimmedChunks.length,
      });

      this.emit('flushed', meetingId, chunksToFlush.length);

    } catch (error) {
      logger.error('Failed to flush transcript buffer', {
        meetingId,
        error: (error as Error).message,
      });
      // Re-add chunks to buffer to retry later
      buffer.chunks = [...chunksToFlush, ...buffer.chunks];
      throw error;
    } finally {
      buffer.flushing = false;
    }
  }

  /**
   * Flush and remove meeting from buffer.
   * Call this when meeting is completely done.
   */
  async endMeeting(meetingId: string): Promise<void> {
    await this.flushMeeting(meetingId);

    const buffer = this.buffers.get(meetingId);
    if (buffer?.flushTimer) {
      clearTimeout(buffer.flushTimer);
    }
    this.buffers.delete(meetingId);

    logger.info('Meeting transcript buffer ended', { meetingId });
  }

  /**
   * Get buffer stats for monitoring.
   */
  getStats(): {
    activeMeetings: number;
    totalBufferedChunks: number;
    meetings: Array<{ meetingId: string; chunks: number }>;
  } {
    const meetings: Array<{ meetingId: string; chunks: number }> = [];
    let totalBufferedChunks = 0;

    for (const [meetingId, buffer] of this.buffers) {
      meetings.push({ meetingId, chunks: buffer.chunks.length });
      totalBufferedChunks += buffer.chunks.length;
    }

    return {
      activeMeetings: this.buffers.size,
      totalBufferedChunks,
      meetings,
    };
  }

  /**
   * Flush all meetings and shutdown.
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down transcript buffer', {
      activeMeetings: this.buffers.size,
    });

    const flushPromises: Promise<void>[] = [];
    for (const meetingId of this.buffers.keys()) {
      flushPromises.push(this.endMeeting(meetingId));
    }

    await Promise.allSettled(flushPromises);
    logger.info('Transcript buffer shutdown complete');
  }
}
