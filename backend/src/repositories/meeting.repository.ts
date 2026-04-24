/**
 * =============================================================================
 * MEETING REPOSITORY
 * =============================================================================
 *
 * Data access layer for Meeting entities.
 *
 * Responsibilities:
 * -----------------
 * - CRUD operations for meetings
 * - Managing meeting-transcript relationships
 * - Querying meetings by status, tenant, date range
 * - Updating meeting status lifecycle
 *
 * Meeting Status Lifecycle:
 * -------------------------
 * ```
 * scheduled -> joining -> in_progress -> transcribing -> completed
 *                    \              \             \
 *                     failed <-----------------------'
 * ```
 *
 * @module repositories/meeting
 */

import { PrismaClient, Meeting, Transcript } from '../../prisma/generated/client/index.js';
import { BaseRepository } from './base.repository.js';
import { MeetingStatus } from '../types/index.js';

/**
 * Meeting with optional transcript relation.
 */
export interface MeetingWithTranscript extends Meeting {
  transcript: Transcript | null;
}

/**
 * Options for querying meetings.
 */
export interface FindMeetingsOptions {
  /** Filter by tenant */
  tenantId: string;
  /** Filter by project (P1 scoping) — null/undefined means all projects */
  projectId?: string | null;
  /** Filter by status */
  status?: MeetingStatus | MeetingStatus[];
  /** Filter by date range - start */
  startAfter?: Date;
  /** Filter by date range - end */
  startBefore?: Date;
  /** Include transcript relation */
  includeTranscript?: boolean;
  /** Pagination - page size */
  take?: number;
  /** Pagination - offset */
  skip?: number;
  /** Sort order */
  orderBy?: 'startTime' | 'createdAt';
  /** Sort direction */
  orderDirection?: 'asc' | 'desc';
}

/**
 * Repository for Meeting entities.
 *
 * @example
 * ```typescript
 * const meetingRepo = new MeetingRepository(prisma);
 *
 * // Create a meeting
 * const meeting = await meetingRepo.create({
 *   tenantId: 'tenant_123',
 *   title: 'Sprint Planning',
 *   meetingUrl: 'https://meet.google.com/abc',
 *   startTime: new Date(),
 * });
 *
 * // Find meetings by tenant and status
 * const activeMeetings = await meetingRepo.findByTenant('tenant_123', {
 *   status: ['in_progress', 'transcribing'],
 *   includeTranscript: true,
 * });
 *
 * // Update status
 * await meetingRepo.updateStatus(meeting.id, 'in_progress');
 * ```
 */
export class MeetingRepository extends BaseRepository<Meeting, 'Meeting'> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'Meeting');
  }

  /**
   * Find a meeting by ID with optional transcript.
   *
   * @param id - Meeting ID
   * @param includeTranscript - Whether to include transcript relation
   * @returns Meeting with optional transcript, or null if not found
   */
  async findByIdWithTranscript(
    id: string,
    includeTranscript = true
  ): Promise<MeetingWithTranscript | null> {
    this.logger.debug('Finding meeting with transcript', { id, includeTranscript });

    return this.prisma.meeting.findUnique({
      where: { id },
      include: { transcript: includeTranscript },
    });
  }

  /**
   * Find meetings by external ID (e.g., Twilio call SID).
   *
   * @param externalId - External service ID
   * @returns Meeting or null if not found
   */
  async findByExternalId(externalId: string): Promise<Meeting | null> {
    this.logger.debug('Finding meeting by external ID', { externalId });

    return this.prisma.meeting.findFirst({
      where: { externalId },
    });
  }

  /**
   * Find meetings for a tenant with various filters.
   *
   * This is the main query method for listing meetings with filtering,
   * pagination, and sorting support.
   *
   * @param options - Query options
   * @returns Array of meetings matching the criteria
   *
   * @example
   * ```typescript
   * // Find completed meetings from last week
   * const meetings = await meetingRepo.findByTenant({
   *   tenantId: 'tenant_123',
   *   status: 'completed',
   *   startAfter: oneWeekAgo,
   *   includeTranscript: true,
   *   take: 20,
   *   orderBy: 'startTime',
   *   orderDirection: 'desc',
   * });
   * ```
   */
  async findByTenant(options: FindMeetingsOptions): Promise<MeetingWithTranscript[]> {
    const {
      tenantId,
      projectId,
      status,
      startAfter,
      startBefore,
      includeTranscript = false,
      take = 50,
      skip = 0,
      orderBy = 'startTime',
      orderDirection = 'desc',
    } = options;

    this.logger.debug('Finding meetings by tenant', { tenantId, projectId, status, take, skip });

    // Build where clause dynamically
    const where: Record<string, unknown> = { tenantId };

    if (projectId) {
      where.projectId = projectId;
    }

    // Handle status filter (can be single value or array)
    if (status) {
      where.status = Array.isArray(status) ? { in: status } : status;
    }

    // Handle date range filters
    if (startAfter || startBefore) {
      where.startTime = {};
      if (startAfter) (where.startTime as Record<string, Date>).gte = startAfter;
      if (startBefore) (where.startTime as Record<string, Date>).lte = startBefore;
    }

    return this.prisma.meeting.findMany({
      where,
      include: { transcript: includeTranscript },
      take,
      skip,
      orderBy: { [orderBy]: orderDirection },
    });
  }

  /**
   * Update meeting status.
   *
   * This method handles the meeting lifecycle transitions and records
   * the transition timestamp.
   *
   * @param id - Meeting ID
   * @param status - New status
   * @param additionalData - Optional additional data to update
   * @returns Updated meeting
   *
   * @example
   * ```typescript
   * // Mark meeting as completed
   * await meetingRepo.updateStatus('meeting_123', 'completed', {
   *   endTime: new Date(),
   * });
   * ```
   */
  async updateStatus(
    id: string,
    status: MeetingStatus,
    additionalData?: Partial<Meeting>
  ): Promise<Meeting> {
    this.logger.info('Updating meeting status', { id, status });

    const data: Partial<Meeting> = {
      ...additionalData,
      status,
    };

    // Set endTime when completing
    if (status === 'completed' && !data.endTime) {
      data.endTime = new Date();
    }

    return this.prisma.meeting.update({
      where: { id },
      data: data as any,
    });
  }

  /**
   * Create a meeting with transcript in a single transaction.
   *
   * Use this when you have both meeting data and transcript data available
   * (e.g., when processing a completed meeting from an upload or Google Meet).
   *
   * @param meetingData - Meeting data
   * @param transcriptData - Transcript data
   * @returns Created meeting with transcript
   */
  async createWithTranscript(
    meetingData: Omit<Meeting, 'id' | 'createdAt' | 'updatedAt'>,
    transcriptData: {
      segments: unknown[];
      fullText: string;
      duration: number;
      wordCount: number;
    }
  ): Promise<MeetingWithTranscript> {
    this.logger.info('Creating meeting with transcript', {
      title: meetingData.title,
      duration: transcriptData.duration,
    });

    return this.prisma.meeting.create({
      data: {
        ...meetingData as any,
        transcript: {
          create: transcriptData as any,
        },
      },
      include: { transcript: true },
    }) as any;
  }

  /**
   * Get meetings that are stuck in a status (for retry/cleanup).
   *
   * This is useful for finding meetings that may have failed processing
   * and need to be retried or cleaned up.
   *
   * @param status - Status to check
   * @param olderThan - Find meetings stuck longer than this duration
   * @returns Array of stuck meetings
   */
  async findStuckMeetings(
    status: MeetingStatus,
    olderThan: Date
  ): Promise<Meeting[]> {
    this.logger.debug('Finding stuck meetings', { status, olderThan });

    return this.prisma.meeting.findMany({
      where: {
        status,
        updatedAt: { lt: olderThan },
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  /**
   * Get meeting statistics for a tenant.
   *
   * @param tenantId - Tenant ID
   * @param period - Time period for stats
   * @returns Meeting statistics
   */
  async getStats(
    tenantId: string,
    period: { start: Date; end: Date }
  ): Promise<{
    total: number;
    completed: number;
    failed: number;
    avgDuration: number;
  }> {
    this.logger.debug('Getting meeting stats', { tenantId, period });

    const [total, completed, failed, durationStats] = await Promise.all([
      this.prisma.meeting.count({
        where: {
          tenantId,
          startTime: { gte: period.start, lte: period.end },
        },
      }),
      this.prisma.meeting.count({
        where: {
          tenantId,
          status: 'completed',
          startTime: { gte: period.start, lte: period.end },
        },
      }),
      this.prisma.meeting.count({
        where: {
          tenantId,
          status: 'failed',
          startTime: { gte: period.start, lte: period.end },
        },
      }),
      this.prisma.transcript.aggregate({
        where: {
          meeting: {
            tenantId,
            startTime: { gte: period.start, lte: period.end },
          },
        },
        _avg: { duration: true },
      }),
    ]);

    return {
      total,
      completed,
      failed,
      avgDuration: durationStats._avg.duration || 0,
    };
  }
}
