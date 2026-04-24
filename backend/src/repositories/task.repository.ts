/**
 * =============================================================================
 * TASK REPOSITORY
 * =============================================================================
 *
 * Data access layer for AgentTask entities.
 *
 * AgentTask represents a unit of work assigned to an AI agent. Each task goes
 * through a lifecycle from creation to completion, with possible intermediate
 * states for clarification and approval.
 *
 * Task Status Lifecycle:
 * ----------------------
 * ```
 *                                    +--- awaiting_clarification ---+
 *                                    |                              |
 * pending -> processing -------------+--- awaiting_approval --------+--> completed
 *                                    |                              |
 *                                    +--- failed <------------------+
 * ```
 *
 * Task Types by Agent:
 * --------------------
 * - ba_agent: Meeting -> PRD generation
 * - dev_agent: PRD -> Code implementation (Phase 2)
 * - sales_agent: Meeting -> CRM updates (Phase 2)
 * - marketing_agent: Content generation (Phase 2)
 *
 * @module repositories/task
 */

import { PrismaClient, AgentTask, ClarificationRequest } from '../../prisma/generated/client/index.js';
import { BaseRepository } from './base.repository.js';
import { TaskStatus, AgentType } from '../types/index.js';

/**
 * N6: map AgentTask lifecycle values onto TicketStatus values. These do not
 * overlap 1:1 (AgentTask has more granular approval states) so we collapse
 * awaiting_clarification/awaiting_approval to 'waiting' and approved/rejected
 * to done/failed respectively. Kept out-of-class so unit tests can import it.
 */
export function mapTaskStatusToTicketStatus(taskStatus: string): string {
  switch (taskStatus) {
    case 'pending':
      return 'ready';
    case 'processing':
      return 'claimed';
    case 'awaiting_clarification':
    case 'awaiting_approval':
      return 'waiting';
    case 'completed':
    case 'approved':
      return 'done';
    case 'failed':
    case 'rejected':
      return 'failed';
    default:
      return 'ready';
  }
}

/**
 * N6: build a human-readable title for a mirror ticket from its agent type
 * plus optional meeting id. Used only when the ticket row is created for
 * the first time — subsequent mirror updates leave the title alone.
 */
export function buildTicketTitle(agentType: string, meetingId: string | null): string {
  return meetingId
    ? `${agentType} — meeting ${meetingId.slice(0, 8)}`
    : `${agentType} — standalone`;
}

/**
 * Task with optional relations.
 */
export interface TaskWithRelations extends AgentTask {
  clarifications?: ClarificationRequest[];
}

/**
 * Options for creating a new task.
 */
export interface CreateTaskOptions {
  tenantId: string;
  agentType: AgentType;
  meetingId?: string;
  input: {
    type: string;
    [key: string]: unknown;
  };
}

/**
 * Options for querying tasks.
 */
export interface FindTasksOptions {
  tenantId: string;
  agentType?: AgentType;
  status?: TaskStatus | TaskStatus[];
  meetingId?: string;
  requiresApproval?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
  take?: number;
  skip?: number;
}

/**
 * Repository for AgentTask entities.
 *
 * @example
 * ```typescript
 * const taskRepo = new TaskRepository(prisma);
 *
 * // Create a new task for BA Agent
 * const task = await taskRepo.createTask({
 *   tenantId: 'tenant_123',
 *   agentType: 'ba_agent',
 *   meetingId: 'meeting_456',
 *   input: {
 *     type: 'meeting_transcript',
 *     transcript: '...',
 *   },
 * });
 *
 * // Update task status
 * await taskRepo.updateStatus(task.id, 'processing');
 *
 * // Complete task with output
 * await taskRepo.completeTask(task.id, {
 *   type: 'prd',
 *   prd: { ... },
 * }, 0.95);
 * ```
 */
export class TaskRepository extends BaseRepository<AgentTask, 'AgentTask'> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'AgentTask');
  }

  /**
   * N6: mirror an AgentTask row into the Ticket table so downstream readers
   * (dashboard, email digest, /api/agents/tasks) see a single source of
   * truth. Keyed by `tix_legacy_<taskId>` so every task has a 1:1 Ticket.
   * Idempotent — calling it repeatedly converges the Ticket to match the
   * current AgentTask state.
   *
   * Called after every AgentTask mutation. Failures are logged but not
   * thrown — we never want a mirror hiccup to break the primary flow.
   */
  private async mirrorToTicket(taskId: string): Promise<void> {
    try {
      const task = await this.prisma.agentTask.findUnique({
        where: { id: taskId },
      });
      if (!task) return;

      const ticketId = `tix_legacy_${task.id}`;
      const ticketStatus = mapTaskStatusToTicketStatus(task.status);

      await (this.prisma as any).ticket.upsert({
        where: { id: ticketId },
        create: {
          id: ticketId,
          tenantId: task.tenantId,
          projectId: task.projectId ?? null,
          meetingId: task.meetingId ?? null,
          goalId: task.goalId ?? null,
          roleSlug: task.agentType,
          title: buildTicketTitle(task.agentType, task.meetingId),
          description: 'Mirrored from AgentTask (legacy pipeline).',
          status: ticketStatus,
          payload: (task.input ?? {}) as any,
          result: task.output as any,
          error: task.error,
          confidence: task.confidence ?? 0,
          requiresApproval: task.requiresApproval ?? false,
          approvedBy: task.approvedBy,
          approvedAt: task.approvedAt,
          completedAt: task.completedAt,
        },
        update: {
          // tenantId / projectId / meetingId never change after creation, so
          // skip them. Status + result + approval fields are what move.
          status: ticketStatus,
          payload: (task.input ?? {}) as any,
          result: task.output as any,
          error: task.error,
          confidence: task.confidence ?? 0,
          requiresApproval: task.requiresApproval ?? false,
          approvedBy: task.approvedBy,
          approvedAt: task.approvedAt,
          completedAt: task.completedAt,
          goalId: task.goalId ?? null,
          projectId: task.projectId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn('Ticket mirror failed (non-fatal)', {
        taskId,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Create a new agent task.
   *
   * @deprecated Since N6 (2026-04-20). AgentTask is the legacy write
   * path; new callers should go through TicketService.create() so
   * Ticket is the primary row. This method still works — it writes
   * the AgentTask and mirrors a Ticket — but every call is a signal
   * that another code path needs rewriting.
   *
   * See docs/DEFERRED.md §"N6 follow-ups — full AgentTask retirement"
   * for the sequence to kill this entirely.
   *
   * @param options - Task creation options
   * @returns Created task
   */
  async createTask(options: CreateTaskOptions): Promise<AgentTask> {
    const { tenantId, agentType, meetingId, input } = options;

    this.logger.warn('createTask(): AgentTask is deprecated since N6 — writes still work via mirror, but new callers should use TicketService.create()', {
      tenantId,
      agentType,
      meetingId,
      deprecation: 'n6',
    });

    const task = await this.prisma.agentTask.create({
      data: {
        tenantId,
        agentType,
        meetingId,
        input: input as any,
        status: 'pending',
        confidence: 0,
        requiresApproval: false,
        retryCount: 0,
      },
    });
    await this.mirrorToTicket(task.id);
    return task;
  }

  /**
   * Find a task by ID with clarification requests.
   *
   * @param id - Task ID
   * @returns Task with clarifications or null
   */
  async findByIdWithClarifications(id: string): Promise<TaskWithRelations | null> {
    this.logger.debug('Finding task with clarifications', { id });

    return this.prisma.agentTask.findUnique({
      where: { id },
      include: {
        clarifications: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  /**
   * Find tasks matching the given criteria.
   *
   * @param options - Query options
   * @returns Array of matching tasks
   */
  async findTasks(options: FindTasksOptions): Promise<AgentTask[]> {
    const {
      tenantId,
      agentType,
      status,
      meetingId,
      requiresApproval,
      createdAfter,
      createdBefore,
      take = 50,
      skip = 0,
    } = options;

    this.logger.debug('Finding tasks', { tenantId, agentType, status });

    const where: Record<string, unknown> = { tenantId };

    if (agentType) where.agentType = agentType;
    if (meetingId) where.meetingId = meetingId;
    if (requiresApproval !== undefined) where.requiresApproval = requiresApproval;

    if (status) {
      where.status = Array.isArray(status) ? { in: status } : status;
    }

    if (createdAfter || createdBefore) {
      where.createdAt = {};
      if (createdAfter) (where.createdAt as Record<string, Date>).gte = createdAfter;
      if (createdBefore) (where.createdAt as Record<string, Date>).lte = createdBefore;
    }

    return this.prisma.agentTask.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update task status.
   *
   * This is the primary method for moving a task through its lifecycle.
   *
   * @param id - Task ID
   * @param status - New status
   * @returns Updated task
   */
  async updateStatus(id: string, status: TaskStatus): Promise<AgentTask> {
    this.logger.info('Updating task status', { id, status });

    const data: Partial<AgentTask> = { status };

    // Set completedAt when task reaches terminal state
    if (['completed', 'failed'].includes(status)) {
      data.completedAt = new Date();
    }

    const task = await this.prisma.agentTask.update({
      where: { id },
      data: data as any,
    });
    await this.mirrorToTicket(id);
    return task;
  }

  /**
   * Mark task as processing and increment retry count.
   *
   * Use this when starting to process a task (including retries).
   *
   * @param id - Task ID
   * @returns Updated task
   */
  async startProcessing(id: string): Promise<AgentTask> {
    this.logger.info('Starting task processing', { id });

    const task = await this.prisma.agentTask.update({
      where: { id },
      data: {
        status: 'processing',
        retryCount: { increment: 1 },
      },
    });
    await this.mirrorToTicket(id);
    return task;
  }

  /**
   * Complete a task with output and confidence score.
   *
   * @param id - Task ID
   * @param output - Task output data
   * @param confidence - Confidence score (0-1)
   * @param requiresApproval - Whether human approval is needed
   * @returns Updated task
   */
  async completeTask(
    id: string,
    output: Record<string, unknown>,
    confidence: number,
    requiresApproval = false
  ): Promise<AgentTask> {
    this.logger.info('Completing task', { id, confidence, requiresApproval });

    const status: TaskStatus = requiresApproval ? 'awaiting_approval' : 'completed';

    const task = await this.prisma.agentTask.update({
      where: { id },
      data: {
        status,
        output: output as any,
        confidence,
        requiresApproval,
        completedAt: requiresApproval ? null : new Date(),
      },
    });
    await this.mirrorToTicket(id);
    return task;
  }

  /**
   * Mark task as failed with error message.
   *
   * @param id - Task ID
   * @param error - Error message
   * @returns Updated task
   */
  async failTask(id: string, error: string): Promise<AgentTask> {
    this.logger.error('Task failed', { id, error });

    const task = await this.prisma.agentTask.update({
      where: { id },
      data: {
        status: 'failed',
        error,
        completedAt: new Date(),
      },
    });
    await this.mirrorToTicket(id);
    return task;
  }

  /**
   * Approve a task that was awaiting approval.
   *
   * @param id - Task ID
   * @param approvedBy - ID of the user who approved
   * @returns Updated task
   */
  async approveTask(id: string, approvedBy: string): Promise<AgentTask> {
    this.logger.info('Approving task', { id, approvedBy });

    const task = await this.prisma.agentTask.update({
      where: { id },
      data: {
        status: 'approved',
        approvedBy,
        approvedAt: new Date(),
      },
    });
    await this.mirrorToTicket(id);
    return task;
  }

  /**
   * Reject a task that was awaiting approval.
   *
   * @param id - Task ID
   * @param rejectedBy - ID of the user who rejected
   * @param reason - Rejection reason
   * @returns Updated task
   */
  async rejectTask(id: string, rejectedBy: string, reason: string): Promise<AgentTask> {
    this.logger.info('Rejecting task', { id, rejectedBy, reason });

    const task = await this.prisma.agentTask.update({
      where: { id },
      data: {
        status: 'rejected',
        approvedBy: rejectedBy,
        approvedAt: new Date(),
        error: `Rejected: ${reason}`,
      },
    });
    await this.mirrorToTicket(id);
    return task;
  }

  /**
   * Create a clarification request for a task.
   *
   * When an agent needs human input to proceed, it creates a clarification
   * request and the task moves to 'awaiting_clarification' status.
   *
   * @param taskId - Task ID
   * @param request - Clarification request details
   * @returns Created clarification request
   */
  async createClarificationRequest(
    taskId: string,
    request: {
      question: string;
      context: string;
      options?: unknown[];
      routeTo: string;
      urgency: string;
      expiresAt: Date;
    }
  ): Promise<ClarificationRequest> {
    this.logger.info('Creating clarification request', { taskId, routeTo: request.routeTo });

    // N6b: every ClarificationRequest now also carries a ticketId
    // pointing at the mirror ticket for this task. That way new readers
    // (chief_of_staff / comms handlers) can join through Ticket; legacy
    // readers (BA agent clarification loop) keep using taskId.
    const ticketId = `tix_legacy_${taskId}`;

    // Update task status and create clarification in transaction.
    const [_, clarification] = await this.prisma.$transaction([
      this.prisma.agentTask.update({
        where: { id: taskId },
        data: { status: 'awaiting_clarification' },
      }),
      this.prisma.clarificationRequest.create({
        data: {
          taskId,
          ticketId,
          ...request,
        } as any,
      }),
    ]);

    await this.mirrorToTicket(taskId);
    return clarification;
  }

  /**
   * Answer a clarification request.
   *
   * @param clarificationId - Clarification request ID
   * @param response - The answer
   * @param respondedBy - ID of the user who responded
   * @returns Updated clarification request
   */
  async answerClarification(
    clarificationId: string,
    response: string,
    respondedBy: string
  ): Promise<ClarificationRequest> {
    this.logger.info('Answering clarification', { clarificationId, respondedBy });

    // Update clarification and set task back to pending
    const clarification = await this.prisma.clarificationRequest.update({
      where: { id: clarificationId },
      data: {
        status: 'answered',
        response,
        respondedBy,
        respondedAt: new Date(),
      },
      include: { task: true },
    });

    // Resume the task. N6b made taskId nullable — a clarification that
    // only has ticketId (future chief_of_staff flow) skips the legacy
    // AgentTask update. A clarification with neither is malformed; log
    // and bail rather than throw so the channel reply still succeeds.
    if (clarification.taskId) {
      await this.prisma.agentTask.update({
        where: { id: clarification.taskId },
        data: { status: 'pending' },
      });
      await this.mirrorToTicket(clarification.taskId);
    } else {
      this.logger.warn('answerClarification: no taskId on clarification — skipping legacy task resume', {
        clarificationId,
      });
    }

    return clarification;
  }

  /**
   * Find tasks that need retry (failed but under retry limit).
   *
   * @param maxRetries - Maximum retry attempts
   * @returns Tasks eligible for retry
   */
  async findRetryableTasks(maxRetries = 3): Promise<AgentTask[]> {
    this.logger.debug('Finding retryable tasks', { maxRetries });

    return this.prisma.agentTask.findMany({
      where: {
        status: 'failed',
        retryCount: { lt: maxRetries },
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  /**
   * Find pending clarification requests that have expired.
   *
   * @returns Expired clarification requests
   */
  async findExpiredClarifications(): Promise<ClarificationRequest[]> {
    return this.prisma.clarificationRequest.findMany({
      where: {
        status: 'pending',
        expiresAt: { lt: new Date() },
      },
    });
  }
}
