/**
 * =============================================================================
 * QUEUE SERVICE (BULLMQ)
 * =============================================================================
 *
 * Background job processing using BullMQ and Redis.
 *
 * Why BullMQ?
 * -----------
 * 1. Battle-tested Redis-based queue
 * 2. Built-in retry logic with exponential backoff
 * 3. Job prioritization and rate limiting
 * 4. Delayed jobs (schedule for later)
 * 5. Job events for monitoring
 *
 * Queue Architecture:
 * -------------------
 * ```
 * ┌─────────────────┐     ┌─────────────┐     ┌──────────────┐
 * │   API/Webhook   │────▶│    Redis    │────▶│   Workers    │
 * │   (Producer)    │     │   (Queue)   │     │  (Consumer)  │
 * └─────────────────┘     └─────────────┘     └──────────────┘
 *                                                    │
 *                               ┌────────────────────┼────────────────────┐
 *                               │                    │                    │
 *                               ▼                    ▼                    ▼
 *                        ┌──────────┐         ┌──────────┐         ┌──────────┐
 *                        │ Meeting  │         │ BA Agent │         │  Notify  │
 *                        │ Process  │         │ Process  │         │  Process │
 *                        └──────────┘         └──────────┘         └──────────┘
 * ```
 *
 * Job Types:
 * ----------
 * 1. MEETING_PROCESS: Process meeting after bot leaves
 * 2. BA_AGENT_PROCESS: Generate PRD from transcript
 * 3. JIRA_SYNC: Create/sync Jira tickets
 * 4. NOTIFICATION: Send notifications (non-blocking)
 *
 * Job Lifecycle:
 * --------------
 * waiting → active → completed
 *                  ↘ failed → (retry) → active
 *
 * Retry Strategy:
 * ---------------
 * - Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s
 * - Max 5 retries (total ~1 minute of retrying)
 * - Dead letter queue for permanently failed jobs
 *
 * @module services/queue
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { createChildLogger } from '../../lib/logger.js';
import { AppError } from '../../lib/error-handler.js';

/**
 * Job type definitions.
 *
 * Each job type has specific data requirements and processing logic.
 */
export enum JobType {
  /** Process meeting after transcription */
  MEETING_PROCESS = 'meeting_process',
  /** Generate PRD from transcript */
  BA_AGENT_PROCESS = 'ba_agent_process',
  /** Create Jira tickets from PRD */
  JIRA_SYNC = 'jira_sync',
  /** Send notification (Google Chat, email, etc.) */
  NOTIFICATION = 'notification_send',
  /** Cleanup old/stale data */
  CLEANUP = 'system_cleanup',
  /** Check for stale clarification requests and send reminders */
  CLARIFICATION_TIMEOUT = 'clarification_timeout',
  /** Send clarification reminder */
  CLARIFICATION_REMINDER = 'clarification_reminder',
  /** Dev Agent processes an approved PRD */
  DEV_AGENT_PROCESS = 'dev_agent_process',
  /** QA Agent reviews a PR */
  QA_AGENT_PROCESS = 'qa_agent_process',
  /** Memory Optimizer Agent — nightly per-tenant memory consolidation */
  MEMORY_OPTIMIZER = 'memory_optimizer',
  /** Transcribe meeting audio (S3 → Whisper → Transcript) */
  MEETING_TRANSCRIBE = 'meeting_transcribe',
  /** Send daily activity digest email to all tenant users */
  EMAIL_DIGEST = 'email_digest',
  /** Hermes: nightly skill distillation pass (clusters approved outcomes). */
  SKILL_DISTILL = 'skill_distill',
  /** Hermes: daily outcome-based reranking of learned skills. */
  SKILL_RERANK = 'skill_rerank',
}

/**
 * Job data interfaces for type safety.
 */
export interface MeetingProcessJobData {
  meetingId: string;
  tenantId: string;
}

export interface BAAgentProcessJobData {
  taskId: string;
  /** N6 final: canonical Ticket id for the BA work. When set, the
   *  processor prefers ticket-first state updates; empty/undefined
   *  falls through to the legacy taskId path (deprecation-logged). */
  ticketId?: string;
  tenantId: string;
  meetingId: string;
  transcript: string;
}

export interface JiraSyncJobData {
  prdId: string;
  tenantId: string;
  tickets: Array<{
    id: string;
    projectKey: string;
    issueType: string;
    summary: string;
    description: string;
    priority: string;
    labels: string[];
    storyPoints?: number;
  }>;
}

export interface NotificationJobData {
  type: 'gchat' | 'email' | 'slack';
  tenantId: string;
  payload: Record<string, unknown>;
}

export interface ClarificationTimeoutJobData {
  /** Scheduled check - no specific target, checks all stale requests */
  checkType: 'scheduled';
}

export interface ClarificationReminderJobData {
  clarificationRequestId: string;
  prdId: string;
  tenantId: string;
  reminderNumber: number; // 1st, 2nd, 3rd reminder
  threadKey: string;
  escalateTo?: string; // Email to escalate to if this is the final reminder
}

export interface DevAgentProcessJobData {
  prdId: string;
  engagementId: string;
  tenantId: string;
  /** Legacy AgentTask id. N6 follow-up: still required for
   *  BAAgentService / outcome observer compat; ticketId below is the
   *  canonical reference going forward. */
  taskId: string;
  /** N6 follow-up: canonical Ticket id. When present, processors prefer
   *  updating the Ticket over the AgentTask (mirror keeps the legacy
   *  side in sync). */
  ticketId?: string;
}

export interface QAAgentProcessJobData {
  prdId: string;
  prNumber: number;
  engagementId: string;
  tenantId: string;
  taskId: string;
  ticketId?: string;
  repoOwner?: string;
  repoName?: string;
}

export interface MemoryOptimizerJobData {
  tenantId: string;
  /** 'scheduled' for nightly runs, 'engagement_complete' after engagement reaches learn phase */
  trigger: 'scheduled' | 'engagement_complete';
  engagementId?: string;
}

export interface MeetingTranscribeJobData {
  meetingId: string;
  tenantId: string;
  storageKey: string;
  source: 'upload' | 'google_meet' | 'voice_dialin';
}

/**
 * Union type for all job data.
 */
export type JobData =
  | { type: JobType.MEETING_PROCESS; data: MeetingProcessJobData }
  | { type: JobType.BA_AGENT_PROCESS; data: BAAgentProcessJobData }
  | { type: JobType.JIRA_SYNC; data: JiraSyncJobData }
  | { type: JobType.NOTIFICATION; data: NotificationJobData }
  | { type: JobType.CLARIFICATION_TIMEOUT; data: ClarificationTimeoutJobData }
  | { type: JobType.CLARIFICATION_REMINDER; data: ClarificationReminderJobData }
  | { type: JobType.DEV_AGENT_PROCESS; data: DevAgentProcessJobData }
  | { type: JobType.QA_AGENT_PROCESS; data: QAAgentProcessJobData }
  | { type: JobType.MEMORY_OPTIMIZER; data: MemoryOptimizerJobData }
  | { type: JobType.MEETING_TRANSCRIBE; data: MeetingTranscribeJobData }
  | { type: JobType.EMAIL_DIGEST; data: Record<string, never> }
  | { type: JobType.SKILL_DISTILL; data: Record<string, never> }
  | { type: JobType.SKILL_RERANK; data: Record<string, never> };

/**
 * Job processor function type.
 */
export type JobProcessor<T = unknown> = (job: Job<T>) => Promise<void>;

/**
 * Dead Letter Queue entry format.
 *
 * Stored as JSON in Redis lists keyed by `wf0:dlq:{jobType}`.
 */
export interface DLQEntry {
  jobId: string;
  jobType: string;
  data: Record<string, unknown>;
  failedReason: string;
  failedAt: string; // ISO 8601
  attemptsMade: number;
}

/** DLQ Redis key prefix */
const DLQ_KEY_PREFIX = 'wf0:dlq';

/** DLQ entries expire after 7 days (in seconds) */
const DLQ_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Rate-limit key prefix in Redis */
const RATE_LIMIT_KEY_PREFIX = 'wf0:rate';

/** Default rate-limit: 20 jobs per hour per tenant per job type */
const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_RATE_LIMIT_WINDOW = 3600; // seconds

/**
 * Queue rate-limit configuration (per tenant, per job type).
 */
export interface QueueRateLimitConfig {
  /** Max jobs per tenant per job type within the window. Default: 20 */
  maxJobsPerWindow?: number;
  /** Window duration in seconds. Default: 3600 (1 hour) */
  windowSeconds?: number;
}

/**
 * Queue configuration options.
 */
export interface QueueConfig {
  /** Redis connection (shared with other services) */
  redis: Redis;
  /** Queue name prefix */
  prefix?: string;
  /** Default job options */
  defaultJobOptions?: {
    attempts?: number;
    backoff?: { type: 'exponential' | 'fixed'; delay: number };
    removeOnComplete?: number;
    removeOnFail?: number;
  };
  /** Optional Prisma client for creating in-app notifications on DLQ entries */
  prisma?: { notification: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } };
  /** Per-tenant queue rate limiting. Pass false to disable. Default: enabled (20 jobs/hr). */
  rateLimit?: QueueRateLimitConfig | false;
}

/**
 * Queue Service for background job processing.
 *
 * @example
 * ```typescript
 * const queueService = new QueueService({ redis });
 *
 * // Register job processors
 * queueService.registerProcessor(JobType.BA_AGENT_PROCESS, async (job) => {
 *   const { taskId, transcript } = job.data;
 *   await baAgentService.processTranscript(taskId, transcript);
 * });
 *
 * // Start processing
 * await queueService.start();
 *
 * // Add jobs
 * await queueService.addJob(JobType.BA_AGENT_PROCESS, {
 *   taskId: 'task_123',
 *   tenantId: 'tenant_456',
 *   meetingId: 'meeting_789',
 *   transcript: '...',
 * });
 * ```
 */
export class QueueService {
  private readonly logger = createChildLogger({ service: 'QueueService' });
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly defaultJobOptions: QueueConfig['defaultJobOptions'];
  private prisma: QueueConfig['prisma'];

  /** Rate-limit settings (null = disabled) */
  private readonly rateLimitMax: number | null;
  private readonly rateLimitWindow: number | null;

  /** Map of queue name to Queue instance */
  private queues: Map<string, Queue> = new Map();

  /** Map of queue name to Worker instance */
  private workers: Map<string, Worker> = new Map();

  /** Map of job type to processor function */
  private processors: Map<JobType, JobProcessor> = new Map();

  /** Queue events for monitoring */
  private queueEvents: Map<string, QueueEvents> = new Map();

  /** Whether the service is running */
  private isRunning = false;

  constructor(config: QueueConfig) {
    this.redis = config.redis;
    this.prefix = config.prefix || 'workforce0';
    this.prisma = config.prisma;
    this.defaultJobOptions = config.defaultJobOptions || {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 500, // Keep last 500 failed jobs for debugging
    };

    // Rate limiting setup
    if (config.rateLimit === false) {
      this.rateLimitMax = null;
      this.rateLimitWindow = null;
    } else {
      this.rateLimitMax = config.rateLimit?.maxJobsPerWindow ?? DEFAULT_RATE_LIMIT_MAX;
      this.rateLimitWindow = config.rateLimit?.windowSeconds ?? DEFAULT_RATE_LIMIT_WINDOW;
    }

    this.logger.info('Queue service initialized', {
      prefix: this.prefix,
      rateLimit: this.rateLimitMax !== null
        ? `${this.rateLimitMax} jobs / ${this.rateLimitWindow}s`
        : 'disabled',
    });
  }

  /**
   * Set the Prisma client after construction (for DI scenarios where
   * Prisma is not available at construction time).
   */
  setPrisma(prisma: QueueConfig['prisma']): void {
    this.prisma = prisma;
  }

  /**
   * Register a job processor for a specific job type.
   *
   * Processors are functions that handle jobs of a specific type.
   *
   * @param jobType - The type of job to process
   * @param processor - The processor function
   */
  registerProcessor<T>(jobType: JobType, processor: JobProcessor<T>): void {
    this.logger.info('Registering processor', { jobType });
    this.processors.set(jobType, processor as JobProcessor);
  }

  /**
   * Start all queue workers.
   *
   * This should be called after all processors are registered.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Queue service already running');
      return;
    }

    this.logger.info('Starting queue workers');

    // Create workers for each registered processor
    for (const [jobType, processor] of this.processors) {
      const queueName = this.getQueueName(jobType);

      // Create queue if not exists
      if (!this.queues.has(queueName)) {
        const queue = new Queue(queueName, {
          connection: this.redis,
          prefix: this.prefix,
        });
        this.queues.set(queueName, queue);
      }

      // Create worker
      const worker = new Worker(
        queueName,
        async (job) => {
          this.logger.info('Processing job', {
            jobId: job.id,
            type: jobType,
            attempt: job.attemptsMade + 1,
          });

          try {
            await processor(job);
            this.logger.info('Job completed', { jobId: job.id, type: jobType });
          } catch (error) {
            this.logger.error('Job failed', {
              jobId: job.id,
              type: jobType,
              error: (error as Error).message,
              attempt: job.attemptsMade + 1,
            });
            throw error; // Re-throw to trigger retry
          }
        },
        {
          connection: this.redis,
          prefix: this.prefix,
          concurrency: this.getConcurrency(jobType),
        }
      );

      // Set up worker event handlers
      worker.on('error', (err) => {
        this.logger.error('Worker error', { queueName, error: err.message });
      });

      // Detect permanently failed jobs (all retries exhausted) and move to DLQ
      worker.on('failed', (job: Job | undefined, err: Error, prev: string) => {
        if (!job) return;
        const maxAttempts = (this.defaultJobOptions?.attempts ?? 5);
        // Job has exhausted all retries when attemptsMade reaches maxAttempts
        if (job.attemptsMade >= maxAttempts) {
          this.moveToDLQ(jobType, job, err.message).catch((dlqErr) => {
            this.logger.error('Failed to move job to DLQ', {
              jobId: job.id,
              jobType,
              error: (dlqErr as Error).message,
            });
          });
        }
      });

      this.workers.set(queueName, worker);

      // Set up queue events for monitoring
      const events = new QueueEvents(queueName, {
        connection: this.redis,
        prefix: this.prefix,
      });

      events.on('completed', ({ jobId }) => {
        this.logger.debug('Job completed event', { queueName, jobId });
      });

      events.on('failed', ({ jobId, failedReason }) => {
        this.logger.warn('Job failed event', { queueName, jobId, failedReason });
      });

      this.queueEvents.set(queueName, events);

      this.logger.info('Worker started', { queueName, jobType });
    }

    this.isRunning = true;
    this.logger.info('Queue service started', {
      workerCount: this.workers.size,
    });
  }

  /**
   * Stop all queue workers gracefully.
   *
   * Waits for active jobs to complete before stopping.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping queue workers');

    // Close all workers (waits for active jobs)
    const closePromises: Promise<void>[] = [];

    for (const [name, worker] of this.workers) {
      this.logger.info('Closing worker', { name });
      closePromises.push(worker.close());
    }

    for (const [name, events] of this.queueEvents) {
      closePromises.push(events.close());
    }

    await Promise.all(closePromises);

    this.workers.clear();
    this.queueEvents.clear();
    this.isRunning = false;

    this.logger.info('Queue service stopped');
  }

  /**
   * Add a job to the queue.
   *
   * @param jobType - Type of job
   * @param data - Job data
   * @param options - Optional job options
   * @returns Job ID
   */
  async addJob<T extends JobType>(
    jobType: T,
    data: ExtractJobData<T>,
    options?: {
      priority?: number; // 1 (highest) to 10 (lowest)
      delay?: number; // Delay in ms
      jobId?: string; // Custom job ID (for deduplication)
      skipRateLimit?: boolean; // Bypass rate limiting (for system-initiated jobs)
      /**
       * BullMQ repeatable-job options. When present, the job runs on a
       * cron / interval schedule instead of firing once. Example:
       *   { repeat: { pattern: '0 2 * * *' } }  // 02:00 UTC daily
       * System crons (distill, rerank, email digest) use this.
       */
      repeat?: { pattern?: string; every?: number; tz?: string; limit?: number };
    }
  ): Promise<string> {
    // ---- Rate-limit check (per tenant, per job type) ----
    const tenantId = (data as Record<string, unknown>)?.tenantId as string | undefined;
    if (tenantId && this.rateLimitMax !== null && !options?.skipRateLimit) {
      await this.enforceRateLimit(tenantId, jobType);
    }

    const queueName = this.getQueueName(jobType);

    // Ensure queue exists
    if (!this.queues.has(queueName)) {
      const queue = new Queue(queueName, {
        connection: this.redis,
        prefix: this.prefix,
      });
      this.queues.set(queueName, queue);
    }

    const queue = this.queues.get(queueName)!;

    const job = await queue.add(jobType, data, {
      ...this.defaultJobOptions,
      priority: options?.priority,
      delay: options?.delay,
      jobId: options?.jobId,
      ...(options?.repeat ? { repeat: options.repeat } : {}),
    });

    this.logger.info('Job added', {
      jobId: job.id,
      type: jobType,
      priority: options?.priority,
      delay: options?.delay,
      repeat: options?.repeat,
    });

    return job.id || '';
  }

  /**
   * Schedule a job for later execution.
   *
   * Convenience method for delayed jobs.
   */
  async scheduleJob<T extends JobType>(
    jobType: T,
    data: ExtractJobData<T>,
    runAt: Date
  ): Promise<string> {
    const delay = Math.max(0, runAt.getTime() - Date.now());
    return this.addJob(jobType, data, { delay });
  }

  /**
   * Get job by ID.
   *
   * @param jobType - Type of job
   * @param jobId - Job ID
   * @returns Job or null
   */
  async getJob(jobType: JobType, jobId: string): Promise<Job | null> {
    const queueName = this.getQueueName(jobType);
    const queue = this.queues.get(queueName);

    if (!queue) {
      return null;
    }

    return (await queue.getJob(jobId)) ?? null;
  }

  /**
   * Get queue statistics.
   *
   * @param jobType - Optional job type filter
   * @returns Queue stats
   */
  async getStats(jobType?: JobType): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const queues = jobType
      ? [this.queues.get(this.getQueueName(jobType))].filter(Boolean)
      : Array.from(this.queues.values());

    let waiting = 0;
    let active = 0;
    let completed = 0;
    let failed = 0;
    let delayed = 0;

    for (const queue of queues) {
      if (!queue) continue;
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      waiting += counts.waiting;
      active += counts.active;
      completed += counts.completed;
      failed += counts.failed;
      delayed += counts.delayed;
    }

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Retry a failed job.
   *
   * @param jobType - Type of job
   * @param jobId - Job ID
   */
  async retryJob(jobType: JobType, jobId: string): Promise<void> {
    const job = await this.getJob(jobType, jobId);
    if (job) {
      await job.retry();
      this.logger.info('Job retried', { jobId, type: jobType });
    }
  }

  /**
   * Remove a job from the queue.
   *
   * @param jobType - Type of job
   * @param jobId - Job ID
   */
  async removeJob(jobType: JobType, jobId: string): Promise<void> {
    const job = await this.getJob(jobType, jobId);
    if (job) {
      await job.remove();
      this.logger.info('Job removed', { jobId, type: jobType });
    }
  }

  // ===========================================================================
  // RATE LIMITING (per tenant, per job type)
  // ===========================================================================

  /**
   * Enforce per-tenant, per-job-type rate limiting using Redis INCR + EXPIRE.
   *
   * Uses a fixed-window counter. The key auto-expires after the window elapses,
   * so there is no cleanup burden.
   *
   * @throws AppError with 429 status if rate limit exceeded
   */
  private async enforceRateLimit(tenantId: string, jobType: JobType): Promise<void> {
    if (this.rateLimitMax === null || this.rateLimitWindow === null) return;

    const key = `${RATE_LIMIT_KEY_PREFIX}:${tenantId}:${jobType}`;
    const current = await this.redis.incr(key);

    // Set TTL only on first increment (when counter goes from 0 → 1)
    if (current === 1) {
      await this.redis.expire(key, this.rateLimitWindow);
    }

    if (current > this.rateLimitMax) {
      const ttl = await this.redis.ttl(key);
      this.logger.warn('Queue rate limit exceeded', {
        tenantId,
        jobType,
        current,
        limit: this.rateLimitMax,
        retryAfterSeconds: ttl,
      });

      throw new AppError(
        `Rate limit exceeded: tenant ${tenantId} can queue at most ${this.rateLimitMax} ` +
        `${jobType} jobs per ${this.rateLimitWindow / 60} minutes. ` +
        `Try again in ${ttl > 0 ? ttl : this.rateLimitWindow} seconds.`,
        429,
      );
    }
  }

  // ===========================================================================
  // DEAD LETTER QUEUE (DLQ)
  // ===========================================================================

  /**
   * Move a permanently failed job into the Redis-backed DLQ.
   *
   * Called automatically when a job exhausts all retries.
   * Also creates an in-app Notification (via Prisma) so the tenant is aware.
   */
  private async moveToDLQ(jobType: JobType, job: Job, failedReason: string): Promise<void> {
    const entry: DLQEntry = {
      jobId: job.id ?? 'unknown',
      jobType,
      data: job.data as Record<string, unknown>,
      failedReason,
      failedAt: new Date().toISOString(),
      attemptsMade: job.attemptsMade,
    };

    const dlqKey = `${DLQ_KEY_PREFIX}:${jobType}`;

    // Push entry and set 7-day TTL
    await this.redis.rpush(dlqKey, JSON.stringify(entry));
    await this.redis.expire(dlqKey, DLQ_TTL_SECONDS);

    this.logger.warn('Job moved to Dead Letter Queue', {
      jobId: entry.jobId,
      jobType,
      failedReason,
      attemptsMade: entry.attemptsMade,
    });

    // Create in-app notification so the tenant knows
    const tenantId = (job.data as Record<string, unknown>)?.tenantId as string | undefined;
    if (tenantId && this.prisma) {
      try {
        await this.prisma.notification.create({
          data: {
            tenantId,
            channel: 'in_app',
            type: 'error',
            title: `Job permanently failed: ${jobType}`,
            message: `Job ${entry.jobId} failed after ${entry.attemptsMade} attempts. Reason: ${failedReason}`,
            metadata: { dlqEntry: entry },
            status: 'sent',
            sentAt: new Date(),
          },
        });
      } catch (notifErr) {
        this.logger.error('Failed to create DLQ notification', {
          jobId: entry.jobId,
          error: (notifErr as Error).message,
        });
      }
    }
  }

  /**
   * Retrieve all DLQ entries for a given job type.
   *
   * @param jobType - The job type to query
   * @returns Array of DLQ entries (newest last)
   */
  async getDLQEntries(jobType: JobType): Promise<DLQEntry[]> {
    const dlqKey = `${DLQ_KEY_PREFIX}:${jobType}`;
    const raw = await this.redis.lrange(dlqKey, 0, -1);
    return raw.map((r) => JSON.parse(r) as DLQEntry);
  }

  /**
   * Retry a specific job from the DLQ by re-queuing it.
   *
   * Removes the matching entry from the DLQ list and adds a fresh job
   * to the original queue with default retry settings.
   *
   * @param jobType - The job type
   * @param jobId - The original job ID stored in the DLQ entry
   * @returns The new job ID, or null if the entry was not found
   */
  async retryDLQEntry(jobType: JobType, jobId: string): Promise<string | null> {
    const dlqKey = `${DLQ_KEY_PREFIX}:${jobType}`;
    const raw = await this.redis.lrange(dlqKey, 0, -1);

    let matchedEntry: DLQEntry | null = null;
    let matchedRaw: string | null = null;

    for (const r of raw) {
      const entry = JSON.parse(r) as DLQEntry;
      if (entry.jobId === jobId) {
        matchedEntry = entry;
        matchedRaw = r;
        break;
      }
    }

    if (!matchedEntry || !matchedRaw) {
      this.logger.warn('DLQ entry not found for retry', { jobType, jobId });
      return null;
    }

    // Remove the entry from the DLQ list (remove first occurrence)
    await this.redis.lrem(dlqKey, 1, matchedRaw);

    // Re-queue as a fresh job
    const newJobId = await this.addJob(jobType as any, matchedEntry.data as any);

    this.logger.info('DLQ entry re-queued', {
      jobType,
      originalJobId: jobId,
      newJobId,
    });

    return newJobId;
  }

  /**
   * Get queue name from job type.
   *
   * Groups related jobs into the same queue.
   */
  private getQueueName(jobType: JobType): string {
    // Group by category (meeting, ba_agent, jira, etc.)
    const category = jobType.split('_')[0];
    return `${this.prefix}_${category}`;
  }

  /**
   * Get concurrency for job type.
   *
   * Different job types may need different concurrency levels.
   */
  private getConcurrency(jobType: JobType): number {
    const concurrencyMap: Record<JobType, number> = {
      [JobType.MEETING_PROCESS]: 5, // Multiple meetings can process in parallel
      [JobType.BA_AGENT_PROCESS]: 3, // AI calls are slow, limit concurrency
      [JobType.JIRA_SYNC]: 5, // Jira has rate limits, moderate concurrency
      [JobType.NOTIFICATION]: 10, // Notifications are fast, high concurrency
      [JobType.CLEANUP]: 1, // Cleanup runs sequentially
      [JobType.CLARIFICATION_TIMEOUT]: 1, // Single scheduled check
      [JobType.CLARIFICATION_REMINDER]: 5, // Reminders can be sent in parallel
      [JobType.DEV_AGENT_PROCESS]: 2, // AI-heavy, limit concurrency
      [JobType.QA_AGENT_PROCESS]: 3, // Slightly more parallel than dev
      [JobType.MEMORY_OPTIMIZER]: 2, // Memory optimization per-tenant
      [JobType.MEETING_TRANSCRIBE]: 3, // Transcription is CPU/network heavy, moderate concurrency
      [JobType.EMAIL_DIGEST]: 1,       // Single system-wide run, no parallelism needed
      [JobType.SKILL_DISTILL]: 1,      // Nightly Gemini-heavy pass, keep it serial
      [JobType.SKILL_RERANK]: 1,       // Single system-wide recompute, no parallelism needed
    };

    return concurrencyMap[jobType] || 5;
  }
}

/**
 * Type helper to extract job data type from job type.
 */
type ExtractJobData<T extends JobType> =
  T extends JobType.MEETING_PROCESS ? MeetingProcessJobData :
  T extends JobType.BA_AGENT_PROCESS ? BAAgentProcessJobData :
  T extends JobType.JIRA_SYNC ? JiraSyncJobData :
  T extends JobType.NOTIFICATION ? NotificationJobData :
  T extends JobType.CLARIFICATION_TIMEOUT ? ClarificationTimeoutJobData :
  T extends JobType.CLARIFICATION_REMINDER ? ClarificationReminderJobData :
  T extends JobType.DEV_AGENT_PROCESS ? DevAgentProcessJobData :
  T extends JobType.QA_AGENT_PROCESS ? QAAgentProcessJobData :
  T extends JobType.MEMORY_OPTIMIZER ? MemoryOptimizerJobData :
  T extends JobType.MEETING_TRANSCRIBE ? MeetingTranscribeJobData :
  T extends JobType.EMAIL_DIGEST ? Record<string, never> :
  Record<string, unknown>;

/**
 * Create a queue service with default configuration.
 *
 * @param redis - Redis connection
 * @returns Configured queue service
 */
export function createQueueService(redis: Redis): QueueService {
  return new QueueService({ redis });
}
