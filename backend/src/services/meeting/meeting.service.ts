/**
 * =============================================================================
 * MEETING SERVICE
 * =============================================================================
 *
 * Business logic for meeting management.
 *
 * Responsibilities:
 * -----------------
 * - Handle meeting lifecycle events
 * - Coordinate transcript processing
 * - Trigger BA Agent for PRD generation
 *
 * Meeting Ingestion Paths:
 * ------------------------
 * 1. Google Meet native (Drive webhooks detect recordings automatically)
 * 2. Twilio voice dial-in (real-time transcription via Twilio Media Stream)
 * 3. Manual upload (user uploads audio file, transcribed via Whisper)
 *
 * @module services/meeting
 */

import { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';
import { AppError } from '../../lib/error-handler.js';
import { MeetingRepository } from '../../repositories/meeting.repository.js';
import { MeetingStatus } from '../../types/index.js';

const logger = createChildLogger({ service: 'MeetingService' });

/**
 * Input for transcription chunk (from webhook).
 */
export interface TranscriptionChunkInput {
  meetingId: string;
  speaker?: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

/**
 * Options for listing meetings.
 */
export interface ListMeetingsOptions {
  status?: MeetingStatus;
  projectId?: string | null;
  take?: number;
  skip?: number;
}

/**
 * Queue service interface for triggering BA Agent jobs.
 */
export interface QueueServiceInterface {
  addJob: <T = unknown>(
    jobType: T,
    data: unknown,
    options?: { priority?: number; delay?: number }
  ) => Promise<string>;
}

/**
 * Meeting Service - orchestrates meeting operations.
 *
 * @example
 * ```typescript
 * const meetingService = new MeetingService(meetingRepository, prisma, queueService);
 *
 * // Handle webhook events
 * await meetingService.handleStatusUpdate({ meetingId: '...', status: 'completed' });
 * ```
 */
export class MeetingService {
  constructor(
    private readonly meetingRepository: MeetingRepository,
    private readonly prisma?: PrismaClient,
    private readonly queueService?: QueueServiceInterface
  ) {
    logger.info('MeetingService initialized');
  }

  /**
   * Handle a transcription chunk from real-time webhook.
   *
   * Chunks are accumulated in meeting metadata during the meeting.
   */
  async handleTranscriptionChunk(input: TranscriptionChunkInput): Promise<void> {
    logger.debug('Received transcription chunk', {
      meetingId: input.meetingId,
      speaker: input.speaker,
      textLength: input.text.length,
    });

    try {
      const meeting = await this.meetingRepository.findById(input.meetingId);
      if (!meeting) {
        logger.warn('Meeting not found for transcription chunk', { meetingId: input.meetingId });
        return;
      }

      // Accumulate chunks in metadata (limited buffer for real-time display)
      const metadata = (meeting.metadata as Record<string, unknown>) || {};
      const chunks = (metadata.transcriptChunks as Array<unknown>) || [];

      // Keep last 100 chunks to prevent unbounded growth
      const updatedChunks = [...chunks, {
        speaker: input.speaker,
        text: input.text,
        startTime: input.startTime,
        endTime: input.endTime,
        confidence: input.confidence,
        receivedAt: new Date().toISOString(),
      }].slice(-100);

      await this.meetingRepository.update(meeting.id, {
        metadata: JSON.parse(JSON.stringify({
          ...metadata,
          transcriptChunks: updatedChunks,
          lastChunkAt: new Date().toISOString(),
        })),
      });
    } catch (error) {
      // Don't fail the webhook for chunk storage errors
      logger.error('Failed to store transcription chunk', {
        meetingId: input.meetingId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle status update from webhook.
   */
  async handleStatusUpdate(params: {
    meetingId: string;
    status: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    logger.info('Handling status update', {
      meetingId: params.meetingId,
      status: params.status,
    });

    await this.meetingRepository.updateStatus(
      params.meetingId,
      params.status as MeetingStatus,
      params.metadata
    );

    // Trigger completion handling when meeting ends
    if (params.status === 'completed') {
      await this.handleMeetingCompleted(params.meetingId, params.metadata || {});
    }
  }

  /**
   * Get a meeting by ID.
   *
   * @param meetingId - Meeting ID
   * @returns Meeting details or null
   */
  async getMeeting(meetingId: string) {
    return this.meetingRepository.findByIdWithTranscript(meetingId);
  }

  /**
   * List meetings for a tenant.
   *
   * @param tenantId - Tenant ID
   * @param options - Filter and pagination options
   * @returns Array of meetings
   */
  async getMeetingsForTenant(tenantId: string, options: ListMeetingsOptions = {}) {
    return this.meetingRepository.findByTenant({
      tenantId,
      projectId: options.projectId ?? null,
      status: options.status,
      take: options.take || 20,
      skip: options.skip || 0,
    });
  }

  /**
   * Create a placeholder meeting row for a scheduled bot. The
   * MeetingBotRouter dispatch path uses this so we have a stable
   * meetingId to pass to the provider before the bot has joined.
   *
   * Step 0 (meeting-bot abstraction).
   */
  async createScheduled(input: { tenantId: string; title: string; meetingUrl: string }) {
    if (!this.prisma) {
      throw new AppError(
        'MeetingService.createScheduled requires prisma client',
        500,
        'INTERNAL',
      );
    }
    return this.prisma.meeting.create({
      data: {
        tenantId: input.tenantId,
        title: input.title,
        meetingUrl: input.meetingUrl,
        startTime: new Date(),
        status: 'scheduled',
        source: 'recall',
      },
    });
  }

  /**
   * Mark a scheduled meeting as failed and record the human-readable
   * reason. Called when the bot dispatch round-trip throws.
   */
  async markFailed(meetingId: string, reason: string) {
    if (!this.prisma) {
      throw new AppError(
        'MeetingService.markFailed requires prisma client',
        500,
        'INTERNAL',
      );
    }
    return this.prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'failed', failureReason: reason },
    });
  }

  /**
   * Handle meeting completion - queue BA Agent for transcript processing.
   */
  private async handleMeetingCompleted(
    meetingId: string,
    _data: Record<string, unknown>
  ): Promise<void> {
    logger.info('Meeting completed, processing transcript', { meetingId });

    try {
      const meeting = await this.meetingRepository.findById(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      // Queue BA Agent processing if queue service available
      if (this.queueService) {
        const jobId = await this.queueService.addJob(
          'meeting_process', // JobType.MEETING_PROCESS
          {
            meetingId: meeting.id,
            tenantId: meeting.tenantId,
          }
        );

        logger.info('BA Agent processing queued', {
          meetingId,
          jobId,
        });
      }
    } catch (error) {
      logger.error('Failed to process meeting completion', {
        meetingId,
        error: (error as Error).message,
      });

      await this.meetingRepository.updateStatus(meetingId, 'failed', {
        error: (error as Error).message,
      } as Record<string, unknown>);
    }
  }
}
