/**
 * =============================================================================
 * CLARIFICATION TIMEOUT SERVICE
 * =============================================================================
 *
 * Handles timeouts, reminders, and escalation for unanswered clarification
 * requests in the PRD generation flow.
 *
 * Timeout Strategy:
 * -----------------
 * - 24 hours: Send first reminder to original stakeholder
 * - 48 hours: Send second reminder + escalate to manager
 * - 72 hours: Auto-proceed with assumptions OR expire request
 *
 * Configuration:
 * --------------
 * Timeout behavior can be configured per tenant:
 * - reminderIntervalHours: Time between reminders (default: 24)
 * - maxReminders: Maximum number of reminders (default: 2)
 * - escalateAfterHours: When to escalate (default: 48)
 * - autoApproveAfterHours: When to auto-approve (default: null = disabled)
 * - escalationEmail: Who to escalate to
 *
 * @module services/agent/clarification-timeout
 */

import { PrismaClient } from '../../lib/prisma.js';
import { createChildLogger } from '../../lib/logger.js';
import { GoogleChatService } from '../integrations/gchat.service.js';
import { QueueService, JobType, ClarificationReminderJobData } from '../queue/queue.service.js';

const logger = createChildLogger({ service: 'ClarificationTimeoutService' });

/**
 * Timeout configuration per tenant.
 */
export interface TimeoutConfig {
  /** Hours between reminder notifications (default: 24) */
  reminderIntervalHours: number;
  /** Maximum number of reminders to send (default: 2) */
  maxReminders: number;
  /** Hours after which to escalate to manager (default: 48) */
  escalateAfterHours: number;
  /** Hours after which to auto-approve with assumptions (null = disabled) */
  autoApproveAfterHours: number | null;
  /** Email to escalate to (optional) */
  escalationEmail?: string;
  /** Whether to proceed with assumptions on timeout (default: false) */
  proceedWithAssumptions: boolean;
}

const DEFAULT_CONFIG: TimeoutConfig = {
  reminderIntervalHours: 24,
  maxReminders: 2,
  escalateAfterHours: 48,
  autoApproveAfterHours: null, // Disabled by default
  proceedWithAssumptions: false,
};

/**
 * Stale clarification request with related data.
 */
/**
 * StaleClarification is the shape this legacy service operates on.
 * The upstream findMany + the pre-filter at processStaleClarifications
 * guarantee task + taskId are non-null by the time anything downstream
 * touches them — so this type stays non-nullable despite N6b making
 * the underlying columns optional.
 */
interface StaleClarification {
  id: string;
  taskId: string;
  question: string;
  context: string;
  routeTo: string;
  urgency: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  task: {
    id: string;
    tenantId: string;
    meetingId: string | null;
  };
  // Computed fields
  hoursStale: number;
  remindersSent: number;
}

/**
 * Service for handling clarification timeouts.
 */
export class ClarificationTimeoutService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gchatService: GoogleChatService,
    private readonly queueService: QueueService
  ) {
    logger.info('ClarificationTimeoutService initialized');
  }

  /**
   * Get timeout configuration for a tenant.
   *
   * Merges tenant-specific settings with defaults.
   */
  async getTimeoutConfig(tenantId: string): Promise<TimeoutConfig> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });

      const settings = (tenant?.settings as Record<string, unknown>) || {};
      const clarificationSettings = (settings.clarificationTimeout as Partial<TimeoutConfig>) || {};

      return {
        ...DEFAULT_CONFIG,
        ...clarificationSettings,
      };
    } catch (error) {
      logger.warn('Failed to get tenant config, using defaults', {
        tenantId,
        error: (error as Error).message,
      });
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Check for stale clarification requests and schedule reminders/escalations.
   *
   * This is called periodically by the scheduled job.
   */
  async checkStaleClarifications(): Promise<{
    checked: number;
    remindersScheduled: number;
    escalated: number;
    expired: number;
    autoApproved: number;
  }> {
    logger.info('Checking for stale clarification requests');

    const stats = {
      checked: 0,
      remindersScheduled: 0,
      escalated: 0,
      expired: 0,
      autoApproved: 0,
    };

    try {
      // Find all pending clarification requests
      const pendingRequests = await this.prisma.clarificationRequest.findMany({
        where: {
          status: 'pending',
        },
        include: {
          task: {
            select: {
              id: true,
              tenantId: true,
              meetingId: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      stats.checked = pendingRequests.length;
      logger.info(`Found ${stats.checked} pending clarification requests`);

      for (const request of pendingRequests) {
        // N6b: skip ticket-only clarifications here — they're timed out
        // through EscalationService rather than this legacy loop.
        if (!request.task || !request.taskId) {
          logger.debug('Skipping ticket-only clarification', { clarificationId: request.id });
          continue;
        }
        const hoursStale = this.getHoursStale(request.createdAt);
        const config = await this.getTimeoutConfig(request.task.tenantId);

        // Get how many reminders have been sent (stored in metadata)
        const remindersSent = await this.getReminderCount(request.id);

        const staleClarification: StaleClarification = {
          ...request,
          taskId: request.taskId, // narrowed by the guard above
          task: request.task,     // narrowed by the guard above
          hoursStale,
          remindersSent,
        };

        // Determine action based on hours stale
        const action = this.determineAction(staleClarification, config);

        switch (action) {
          case 'send_reminder':
            await this.scheduleReminder(staleClarification, config, remindersSent + 1);
            stats.remindersScheduled++;
            break;

          case 'escalate':
            await this.escalate(staleClarification, config);
            stats.escalated++;
            break;

          case 'auto_approve':
            await this.autoApproveWithAssumptions(staleClarification);
            stats.autoApproved++;
            break;

          case 'expire':
            await this.expireRequest(staleClarification);
            stats.expired++;
            break;

          case 'none':
            // No action needed yet
            break;
        }
      }

      logger.info('Stale clarification check complete', stats);
      return stats;
    } catch (error) {
      logger.error('Error checking stale clarifications', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Determine what action to take for a stale clarification.
   */
  private determineAction(
    clarification: StaleClarification,
    config: TimeoutConfig
  ): 'send_reminder' | 'escalate' | 'auto_approve' | 'expire' | 'none' {
    const { hoursStale, remindersSent } = clarification;
    const {
      reminderIntervalHours,
      maxReminders,
      escalateAfterHours,
      autoApproveAfterHours,
      proceedWithAssumptions,
    } = config;

    // Check if past expiration
    if (new Date() > clarification.expiresAt) {
      if (autoApproveAfterHours !== null && proceedWithAssumptions) {
        return 'auto_approve';
      }
      return 'expire';
    }

    // Check for auto-approve threshold
    if (autoApproveAfterHours !== null && hoursStale >= autoApproveAfterHours) {
      return 'auto_approve';
    }

    // Check for escalation threshold
    if (hoursStale >= escalateAfterHours && remindersSent >= maxReminders) {
      return 'escalate';
    }

    // Check if it's time for a reminder
    const nextReminderAt = reminderIntervalHours * (remindersSent + 1);
    if (hoursStale >= nextReminderAt && remindersSent < maxReminders) {
      return 'send_reminder';
    }

    return 'none';
  }

  /**
   * Schedule a reminder notification.
   */
  private async scheduleReminder(
    clarification: StaleClarification,
    config: TimeoutConfig,
    reminderNumber: number
  ): Promise<void> {
    logger.info('Scheduling reminder', {
      clarificationId: clarification.id,
      reminderNumber,
      hoursStale: clarification.hoursStale,
    });

    // Get PRD info for the notification
    const prd = await this.prisma.pRD.findFirst({
      where: {
        taskId: clarification.taskId,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!prd) {
      logger.warn('No PRD found for clarification, skipping reminder', {
        clarificationId: clarification.id,
        taskId: clarification.taskId,
      });
      return;
    }

    // Schedule the reminder job
    const threadKey = `prd-clarify-${prd.id}`;
    const isLastReminder = reminderNumber >= config.maxReminders;

    await this.queueService.addJob(JobType.CLARIFICATION_REMINDER, {
      clarificationRequestId: clarification.id,
      prdId: prd.id,
      tenantId: clarification.task.tenantId,
      reminderNumber,
      threadKey,
      escalateTo: isLastReminder ? config.escalationEmail : undefined,
    });

    // Update reminder count in metadata
    await this.incrementReminderCount(clarification.id);
  }

  /**
   * Send a reminder notification via Google Chat.
   *
   * Called by the job processor.
   */
  async sendReminder(data: ClarificationReminderJobData): Promise<void> {
    logger.info('Sending reminder notification', {
      clarificationId: data.clarificationRequestId,
      reminderNumber: data.reminderNumber,
    });

    // Get clarification details
    const clarification = await this.prisma.clarificationRequest.findUnique({
      where: { id: data.clarificationRequestId },
      include: {
        task: true,
      },
    });

    if (!clarification || clarification.status !== 'pending') {
      logger.info('Clarification already resolved, skipping reminder', {
        clarificationId: data.clarificationRequestId,
      });
      return;
    }

    const prd = await this.prisma.pRD.findUnique({
      where: { id: data.prdId },
      select: { title: true },
    });

    const hoursWaiting = this.getHoursStale(clarification.createdAt);
    const daysWaiting = Math.floor(hoursWaiting / 24);

    // Build reminder message
    const urgencyEmoji = data.reminderNumber >= 2 ? '🚨' : '⏰';
    const urgencyText = data.reminderNumber >= 2 ? 'URGENT REMINDER' : 'Reminder';

    let message = `${urgencyEmoji} *${urgencyText}*\n\n`;
    message += `Your input is needed for *${prd?.title || 'PRD'}*.\n`;
    message += `_Waiting for ${daysWaiting} day${daysWaiting !== 1 ? 's' : ''}_\n\n`;
    message += `*Question:*\n${clarification.question}\n\n`;
    message += `Reply with your answer: "Q1: [your response]"`;

    if (data.escalateTo) {
      message += `\n\n_This will be escalated if not answered soon._`;
    }

    await this.gchatService.sendText({
      text: message,
      threadKey: data.threadKey,
    });

    logger.info('Reminder sent', {
      clarificationId: data.clarificationRequestId,
      reminderNumber: data.reminderNumber,
    });
  }

  /**
   * Escalate a clarification request.
   */
  private async escalate(
    clarification: StaleClarification,
    config: TimeoutConfig
  ): Promise<void> {
    logger.info('Escalating clarification request', {
      clarificationId: clarification.id,
      escalateTo: config.escalationEmail,
      hoursStale: clarification.hoursStale,
    });

    const prd = await this.prisma.pRD.findFirst({
      where: { taskId: clarification.taskId },
      select: { id: true, title: true },
    });

    // Send escalation notification to Google Chat
    const threadKey = prd ? `prd-clarify-${prd.id}` : undefined;
    const daysWaiting = Math.floor(clarification.hoursStale / 24);

    await this.gchatService.sendCard({
      header: {
        title: '🚨 Escalation: Clarification Needed',
        subtitle: prd?.title || 'PRD Review',
      },
      sections: [
        {
          widgets: [
            {
              type: 'textParagraph',
              data: {
                text: `A clarification request has been waiting for *${daysWaiting} days* without response.`,
              },
            },
          ],
        },
        {
          header: 'Question',
          widgets: [
            {
              type: 'textParagraph',
              data: { text: clarification.question },
            },
          ],
        },
        {
          widgets: [
            {
              type: 'keyValue',
              data: {
                topLabel: 'Originally Assigned To',
                content: clarification.routeTo,
              },
            },
          ],
        },
        {
          widgets: [
            {
              type: 'textParagraph',
              data: {
                text: `_Please respond or assign to the appropriate person._\n\n` +
                      `Format: "Q1: [your answer]"`,
              },
            },
          ],
        },
      ],
      threadKey,
    });

    // Create an in-app notification for escalation so the dashboard always shows it
    try {
      const daysText = `${daysWaiting} day${daysWaiting !== 1 ? 's' : ''}`;
      await this.prisma.notification.create({
        data: {
          tenantId: clarification.task.tenantId,
          channel: 'in_app',
          type: 'escalation',
          title: `Escalation: Clarification waiting ${daysText}`,
          message: `A clarification request for "${prd?.title || 'PRD'}" has been waiting ${daysText} without response.\n\nQuestion: ${clarification.question}`,
          metadata: {
            referenceId: clarification.id,
            referenceType: 'clarification_escalation',
            prdId: prd?.id,
            prdTitle: prd?.title,
            escalationEmail: config.escalationEmail || null,
            hoursStale: clarification.hoursStale,
            originalRouteTo: clarification.routeTo,
          },
          status: 'pending',
        },
      });
      logger.info('In-app escalation notification created', {
        clarificationId: clarification.id,
        tenantId: clarification.task.tenantId,
      });
    } catch (err) {
      logger.warn('Failed to create in-app escalation notification', {
        error: (err as Error).message,
        clarificationId: clarification.id,
      });
    }

    // Mark as escalated in metadata
    await this.prisma.clarificationRequest.update({
      where: { id: clarification.id },
      data: {
        // Store escalation info in task output or add metadata field
      },
    });
  }

  /**
   * Auto-approve the PRD with assumptions.
   */
  private async autoApproveWithAssumptions(
    clarification: StaleClarification
  ): Promise<void> {
    logger.info('Auto-approving with assumptions', {
      clarificationId: clarification.id,
      hoursStale: clarification.hoursStale,
    });

    // Mark clarification as expired with assumption
    await this.prisma.clarificationRequest.update({
      where: { id: clarification.id },
      data: {
        status: 'expired',
        response: `[AUTO-ASSUMED] No response received after ${Math.floor(clarification.hoursStale / 24)} days. Proceeding with AI-generated assumption.`,
        respondedAt: new Date(),
        respondedBy: 'system:auto-approve',
      },
    });

    // Find associated PRD
    const prd = await this.prisma.pRD.findFirst({
      where: { taskId: clarification.taskId },
      select: { id: true, title: true },
    });

    // Notify via Google Chat
    if (prd) {
      await this.gchatService.sendCard({
        header: {
          title: '⚡ PRD Auto-Approved',
          subtitle: prd.title,
        },
        sections: [
          {
            widgets: [
              {
                type: 'textParagraph',
                data: {
                  text: `The PRD has been auto-approved with AI-generated assumptions after ` +
                        `*${Math.floor(clarification.hoursStale / 24)} days* without clarification.\n\n` +
                        `_Please review the document to verify the assumptions are correct._`,
                },
              },
            ],
          },
          {
            header: 'Unanswered Question',
            widgets: [
              {
                type: 'textParagraph',
                data: { text: clarification.question },
              },
            ],
          },
        ],
        threadKey: `prd-clarify-${prd.id}`,
      });
    }

    // Check if all clarifications for this task are now resolved
    const pendingCount = await this.prisma.clarificationRequest.count({
      where: {
        taskId: clarification.taskId,
        status: 'pending',
      },
    });

    if (pendingCount === 0) {
      // Update task status
      await this.prisma.agentTask.update({
        where: { id: clarification.taskId },
        data: {
          status: 'awaiting_approval',
        },
      });
    }
  }

  /**
   * Expire a clarification request without proceeding.
   */
  private async expireRequest(clarification: StaleClarification): Promise<void> {
    logger.info('Expiring clarification request', {
      clarificationId: clarification.id,
      hoursStale: clarification.hoursStale,
    });

    await this.prisma.clarificationRequest.update({
      where: { id: clarification.id },
      data: {
        status: 'expired',
        response: `[EXPIRED] No response received. Request expired after ${Math.floor(clarification.hoursStale / 24)} days.`,
        respondedAt: new Date(),
        respondedBy: 'system:expired',
      },
    });

    // Notify via Google Chat
    const prd = await this.prisma.pRD.findFirst({
      where: { taskId: clarification.taskId },
      select: { id: true, title: true },
    });

    if (prd) {
      await this.gchatService.sendText({
        text: `⚠️ *Clarification Request Expired*\n\n` +
              `The clarification request for *${prd.title}* has expired without a response.\n\n` +
              `The PRD will remain in draft status until manually reviewed.`,
        threadKey: `prd-clarify-${prd.id}`,
      });
    }
  }

  /**
   * Calculate hours since creation.
   */
  private getHoursStale(createdAt: Date): number {
    const now = new Date();
    const diff = now.getTime() - createdAt.getTime();
    return Math.floor(diff / (1000 * 60 * 60));
  }

  /**
   * Get reminder count from Redis or database.
   */
  private async getReminderCount(clarificationId: string): Promise<number> {
    // For simplicity, we'll use the task metadata
    // In production, you might want to use Redis for this
    try {
      const clarification = await this.prisma.clarificationRequest.findUnique({
        where: { id: clarificationId },
        include: {
          task: {
            select: { output: true },
          },
        },
      });

      const output = (clarification?.task?.output as Record<string, unknown>) || {};
      const reminders = (output.remindersSent as Record<string, number>) || {};
      return reminders[clarificationId] || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Increment reminder count.
   */
  private async incrementReminderCount(clarificationId: string): Promise<void> {
    try {
      const clarification = await this.prisma.clarificationRequest.findUnique({
        where: { id: clarificationId },
        select: { taskId: true },
      });

      // N6b: taskId is now nullable. Ticket-only clarifications track
      // their reminder count elsewhere (ExecutionPlan audit trail);
      // only the legacy AgentTask-backed ones store it on task.output.
      if (!clarification || !clarification.taskId) return;

      const task = await this.prisma.agentTask.findUnique({
        where: { id: clarification.taskId },
        select: { output: true },
      });

      const output = ((task?.output as Record<string, unknown>) || {}) as Record<string, unknown>;
      const reminders = ((output.remindersSent as Record<string, number>) || {}) as Record<string, number>;
      reminders[clarificationId] = (reminders[clarificationId] || 0) + 1;

      await this.prisma.agentTask.update({
        where: { id: clarification.taskId },
        data: {
          output: {
            ...output,
            remindersSent: reminders,
          },
        },
      });
    } catch (error) {
      logger.warn('Failed to increment reminder count', {
        clarificationId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Schedule the periodic timeout check.
   *
   * Call this on application startup.
   */
  async schedulePeriodicCheck(intervalHours: number = 1): Promise<void> {
    logger.info('Scheduling periodic clarification timeout check', {
      intervalHours,
    });

    // Schedule a repeating job every hour
    // Note: BullMQ supports cron expressions for this
    const intervalMs = intervalHours * 60 * 60 * 1000;

    const runCheck = async () => {
      try {
        await this.checkStaleClarifications();
      } catch (error) {
        logger.error('Periodic clarification check failed', {
          error: (error as Error).message,
        });
      }

      // Schedule next check
      setTimeout(runCheck, intervalMs);
    };

    // Run first check after a short delay
    setTimeout(runCheck, 60 * 1000); // 1 minute after startup
  }
}

/**
 * Create a clarification timeout service.
 */
export function createClarificationTimeoutService(
  prisma: PrismaClient,
  gchatService: GoogleChatService,
  queueService: QueueService
): ClarificationTimeoutService {
  return new ClarificationTimeoutService(prisma, gchatService, queueService);
}
