/**
 * =============================================================================
 * PRD REPOSITORY
 * =============================================================================
 *
 * Data access layer for PRD (Product Requirements Document) entities.
 *
 * A PRD is the primary output of the BA Agent. It contains structured
 * requirements extracted from meeting transcripts.
 *
 * PRD Lifecycle:
 * --------------
 * ```
 * draft -> review -> approved (or rejected)
 *           |
 *    [creates Jira tickets]
 * ```
 *
 * Key Relationships:
 * ------------------
 * - PRD belongs to a Meeting (source of requirements)
 * - PRD belongs to a Task (the BA Agent task that created it)
 * - PRD has many JiraTickets (created from requirements)
 *
 * @module repositories/prd
 */

import { PrismaClient, PRD, JiraTicket } from '../../prisma/generated/client/index.js';
import { BaseRepository } from './base.repository.js';
import { Requirement, Risk } from '../types/index.js';

/**
 * PRD with Jira tickets relation.
 */
export interface PRDWithTickets extends PRD {
  tickets: JiraTicket[];
}

/**
 * Input for creating a new PRD.
 */
export interface CreatePRDInput {
  taskId: string;
  meetingId: string;
  tenantId: string;
  title: string;
  summary: string;
  objectives: string[];
  requirements: Requirement[];
  acceptanceCriteria: string[];
  outOfScope: string[];
  assumptions: string[];
  risks: Risk[];
  timeline?: string;
  confidence: number;
}

/**
 * Repository for PRD entities.
 *
 * @example
 * ```typescript
 * const prdRepo = new PRDRepository(prisma);
 *
 * // Create a new PRD
 * const prd = await prdRepo.createPRD({
 *   taskId: 'task_123',
 *   meetingId: 'meeting_456',
 *   tenantId: 'tenant_789',
 *   title: 'User Authentication Feature',
 *   summary: 'Implement OAuth login...',
 *   objectives: ['Secure login', 'SSO support'],
 *   requirements: [...],
 *   acceptanceCriteria: [...],
 *   confidence: 0.92,
 * });
 *
 * // Create Jira tickets from PRD
 * await prdRepo.createTickets(prd.id, tickets);
 * ```
 */
export class PRDRepository extends BaseRepository<PRD, 'PRD'> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'PRD');
  }

  /**
   * Create a new PRD.
   *
   * @param input - PRD data
   * @returns Created PRD
   */
  async createPRD(input: CreatePRDInput): Promise<PRD> {
    this.logger.info('Creating PRD', {
      taskId: input.taskId,
      title: input.title,
      confidence: input.confidence,
    });

    return this.prisma.pRD.create({
      data: {
        taskId: input.taskId,
        meetingId: input.meetingId,
        tenantId: input.tenantId,
        title: input.title,
        summary: input.summary,
        objectives: input.objectives,
        requirements: input.requirements as any,
        acceptanceCriteria: input.acceptanceCriteria,
        outOfScope: input.outOfScope,
        assumptions: input.assumptions,
        risks: input.risks as any,
        timeline: input.timeline,
        confidence: input.confidence,
        status: 'draft',
        version: 1,
      },
    });
  }

  /**
   * Find PRD by ID.
   *
   * @param id - PRD ID
   * @returns PRD or null
   */
  async findById(id: string): Promise<PRD | null> {
    this.logger.debug('Finding PRD by ID', { id });
    return this.prisma.pRD.findUnique({ where: { id } });
  }

  /**
   * Find PRD by ID with Jira tickets.
   *
   * @param id - PRD ID
   * @returns PRD with tickets or null
   */
  async findByIdWithTickets(id: string): Promise<PRDWithTickets | null> {
    this.logger.debug('Finding PRD with tickets', { id });

    return this.prisma.pRD.findUnique({
      where: { id },
      include: { tickets: true },
    });
  }

  /**
   * Find PRDs by meeting ID.
   *
   * A meeting can have multiple PRD versions (revisions).
   *
   * @param meetingId - Meeting ID
   * @returns Array of PRDs for the meeting
   */
  async findByMeetingId(meetingId: string): Promise<PRD[]> {
    this.logger.debug('Finding PRDs by meeting', { meetingId });

    return this.prisma.pRD.findMany({
      where: { meetingId },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Find the latest PRD for a meeting.
   *
   * @param meetingId - Meeting ID
   * @returns Latest PRD version or null
   */
  async findLatestByMeetingId(meetingId: string): Promise<PRDWithTickets | null> {
    this.logger.debug('Finding latest PRD', { meetingId });

    return this.prisma.pRD.findFirst({
      where: { meetingId },
      orderBy: { version: 'desc' },
      include: { tickets: true },
    });
  }

  /**
   * Find PRDs by tenant with optional status filter.
   *
   * @param tenantId - Tenant ID
   * @param status - Optional status filter
   * @param options - Pagination options
   * @returns Array of PRDs
   */
  async findByTenant(
    tenantId: string,
    status?: string,
    options: { take?: number; skip?: number } = {}
  ): Promise<PRD[]> {
    const { take = 50, skip = 0 } = options;

    this.logger.debug('Finding PRDs by tenant', { tenantId, status });

    const where: Record<string, unknown> = { tenantId };
    if (status) where.status = status;

    return this.prisma.pRD.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update PRD status.
   *
   * @param id - PRD ID
   * @param status - New status ('draft' | 'review' | 'approved' | 'rejected')
   * @returns Updated PRD
   */
  async updateStatus(id: string, status: string): Promise<PRD> {
    this.logger.info('Updating PRD status', { id, status });

    return this.prisma.pRD.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Create a new version of a PRD.
   *
   * When a PRD is revised, we create a new version rather than updating
   * the existing one. This preserves history.
   *
   * @param originalId - Original PRD ID
   * @param updates - Updated fields
   * @returns New PRD version
   */
  async createVersion(
    originalId: string,
    updates: Partial<CreatePRDInput>
  ): Promise<PRD> {
    this.logger.info('Creating PRD version', { originalId });

    // Get the original PRD
    const original = await this.prisma.pRD.findUnique({
      where: { id: originalId },
    });

    if (!original) {
      throw new Error(`PRD ${originalId} not found`);
    }

    // Create new version
    return this.prisma.pRD.create({
      data: {
        taskId: original.taskId,
        meetingId: original.meetingId,
        tenantId: original.tenantId,
        title: updates.title ?? original.title,
        summary: updates.summary ?? original.summary,
        objectives: updates.objectives ?? (original.objectives as string[]),
        requirements: (updates.requirements ?? original.requirements) as any,
        acceptanceCriteria: updates.acceptanceCriteria ?? (original.acceptanceCriteria as string[]),
        outOfScope: updates.outOfScope ?? (original.outOfScope as string[]),
        assumptions: updates.assumptions ?? (original.assumptions as string[]),
        risks: (updates.risks ?? original.risks) as any,
        timeline: updates.timeline ?? original.timeline,
        confidence: updates.confidence ?? original.confidence,
        status: 'draft',
        version: original.version + 1,
      },
    });
  }

  /**
   * Create Jira tickets from PRD requirements.
   *
   * This creates ticket records in our database. The actual Jira API call
   * is handled by the JiraService.
   *
   * @param prdId - PRD ID
   * @param tickets - Ticket data
   * @returns Created tickets
   */
  async createTickets(
    prdId: string,
    tickets: Array<{
      projectKey: string;
      issueType: string;
      summary: string;
      description: string;
      priority: string;
      labels: string[];
      acceptanceCriteria?: string;
      storyPoints?: number;
    }>
  ): Promise<JiraTicket[]> {
    this.logger.info('Creating Jira tickets for PRD', { prdId, count: tickets.length });

    const createdTickets = await this.prisma.$transaction(
      tickets.map((ticket) =>
        this.prisma.jiraTicket.create({
          data: {
            prdId,
            ...ticket,
            status: 'created',
          },
        })
      )
    );

    return createdTickets;
  }

  /**
   * Update a Jira ticket with external key after syncing to Jira.
   *
   * @param ticketId - Internal ticket ID
   * @param externalKey - Jira ticket key (e.g., 'PROJ-123')
   * @returns Updated ticket
   */
  async updateTicketExternalKey(
    ticketId: string,
    externalKey: string
  ): Promise<JiraTicket> {
    this.logger.info('Updating ticket external key', { ticketId, externalKey });

    return this.prisma.jiraTicket.update({
      where: { id: ticketId },
      data: {
        externalKey,
        status: 'synced',
        syncedAt: new Date(),
      },
    });
  }

  /**
   * Update a Jira ticket status by its external key (e.g., 'PROJ-123').
   *
   * Called by the Jira webhook handler when issue status changes.
   *
   * @param externalKey - Jira ticket key (e.g., 'PROJ-123')
   * @param status - New status from Jira
   */
  async updateTicketStatusByExternalKey(externalKey: string, status: string): Promise<void> {
    this.logger.info('Updating ticket status by external key', { externalKey, status });

    const ticket = await this.prisma.jiraTicket.findFirst({
      where: { externalKey },
    });

    if (!ticket) {
      this.logger.warn('No local ticket found for Jira key', { externalKey });
      return;
    }

    await this.prisma.jiraTicket.update({
      where: { id: ticket.id },
      data: { status },
    });
  }

  /**
   * Find tickets that haven't been synced to Jira yet.
   *
   * @param prdId - Optional PRD ID filter
   * @returns Unsynced tickets
   */
  async findUnsyncedTickets(prdId?: string): Promise<JiraTicket[]> {
    this.logger.debug('Finding unsynced tickets', { prdId });

    const where: Record<string, unknown> = {
      externalKey: null,
      status: 'created',
    };

    if (prdId) where.prdId = prdId;

    return this.prisma.jiraTicket.findMany({ where });
  }

  /**
   * Get PRD statistics for a tenant.
   *
   * @param tenantId - Tenant ID
   * @returns Statistics object
   */
  async getStats(tenantId: string): Promise<{
    total: number;
    byStatus: Record<string, number>;
    avgConfidence: number;
    totalTickets: number;
  }> {
    this.logger.debug('Getting PRD stats', { tenantId });

    const [total, statusGroups, confidence, tickets] = await Promise.all([
      this.prisma.pRD.count({ where: { tenantId } }),
      this.prisma.pRD.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { id: true },
      }),
      this.prisma.pRD.aggregate({
        where: { tenantId },
        _avg: { confidence: true },
      }),
      this.prisma.jiraTicket.count({
        where: { prd: { tenantId } },
      }),
    ]);

    const byStatus = statusGroups.reduce(
      (acc, group) => {
        acc[group.status] = group._count.id;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      total,
      byStatus,
      avgConfidence: confidence._avg.confidence || 0,
      totalTickets: tickets,
    };
  }
}
