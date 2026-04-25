/**
 * =============================================================================
 * QUEUE JOB PROCESSORS - MVP
 * =============================================================================
 *
 * Processor functions for BullMQ job types in the MVP.
 *
 * Job Types:
 * ----------
 * 1. MEETING_PROCESS - Process meeting after bot leaves
 * 2. BA_AGENT_PROCESS - Generate PRD from transcript
 * 3. JIRA_SYNC - Create/sync Jira tickets
 * 4. NOTIFICATION - Send notifications (Google Chat)
 *
 * @module mvp/services/queue/processors
 */

import { Job } from 'bullmq';
import type { DevAgentProcessJobData, QAAgentProcessJobData, ClarificationTimeoutJobData, ClarificationReminderJobData, MemoryOptimizerJobData } from './queue.service.js';
import { buildCodeGenerationPrompt, buildCodeReviewPrompt } from '../agents/coding-standards.js';
import { sanitizeForAI } from '../../lib/sanitize.js';
import { OutcomeObserver } from '../agents/outcome-observer.js';
import type { AgentHub } from '../agent-hub/agent-hub.service.js';
import { EmailDigestService } from '../communication/email-digest.service.js';
import type { EmailChannel } from '../communication/channels/email.channel.js';

/**
 * Job type definitions.
 */
export enum JobType {
  MEETING_PROCESS = 'meeting_process',
  BA_AGENT_PROCESS = 'ba_agent_process',
  JIRA_SYNC = 'jira_sync',
  NOTIFICATION = 'notification_send',
  DEV_AGENT_PROCESS = 'dev_agent_process',
  QA_AGENT_PROCESS = 'qa_agent_process',
  CLARIFICATION_TIMEOUT = 'clarification_timeout',
  CLARIFICATION_REMINDER = 'clarification_reminder',
  MEMORY_OPTIMIZER = 'memory_optimizer',
  MEETING_TRANSCRIBE = 'meeting_transcribe',
  EMAIL_DIGEST = 'email_digest',
  /** Hermes: nightly skill distillation pass (clusters approved outcomes). */
  SKILL_DISTILL = 'skill_distill',
  /** Hermes: daily outcome-based reranking of learned skills. */
  SKILL_RERANK = 'skill_rerank',
}

/**
 * Job data interfaces.
 */
export interface MeetingProcessJobData {
  meetingId: string;
  tenantId: string;
}

export interface BAAgentProcessJobData {
  taskId: string;
  /** N6 follow-up: canonical Ticket id for newer callers. Falls back to
   *  `tix_legacy_<taskId>` via the TaskRepository mirror when absent. */
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

export interface MeetingTranscribeJobData {
  meetingId: string;
  tenantId: string;
  storageKey: string;
  source: 'upload' | 'google_meet' | 'voice_dialin';
}

/**
 * Processor dependencies interface.
 */
export interface ProcessorDependencies {
  baAgentService: {
    processMeetingTranscript: (
      taskId: string,
      tenantId: string,
      meetingId: string,
      transcript: string,
      options?: { additionalContext?: string }
    ) => Promise<{
      taskId: string;
      prd?: { id: string; title: string; status: string; googleDocsUrl?: string | null };
      confidence: number;
      needsClarification: boolean;
      clarificationQuestions?: string[];
      councilDecision?: 'approved' | 'needs_revision' | 'needs_human_review' | 'rejected';
    }>;
  };
  meetingService: {
    getMeetingWithTranscript: (meetingId: string) => Promise<{
      id: string;
      tenantId: string;
      title?: string;
      transcript?: { id: string; fullText: string };
    } | null>;
  };
  meetingRepository?: {
    findById: (id: string) => Promise<{
      id: string;
      metadata?: Record<string, unknown>;
    } | null>;
  };
  googleChatService: {
    sendNotification: (params: {
      tenantId: string;
      type: string;
      title: string;
      message: string;
      metadata?: Record<string, unknown>;
    }) => Promise<void>;
  };
  jiraService: {
    createIssue: (input: {
      projectKey: string;
      issueType: string;
      summary: string;
      description: string;
      priority: string;
      labels: string[];
      storyPoints?: number;
    }) => Promise<{ key: string }>;
  };
  prdRepository: {
    updateTicketExternalKey: (ticketId: string, externalKey: string) => Promise<void>;
  };
  taskRepository: {
    createTask: (options: {
      tenantId: string;
      agentType: 'ba_agent' | 'dev_agent' | 'sales_agent' | 'marketing_agent';
      meetingId?: string;
      input: { type: string; [key: string]: unknown };
    }) => Promise<{ id: string }>;
  };
  /**
   * N6 final: ticket-first writer. MEETING_PROCESS now creates a
   * Ticket as primary and reverse-mirrors an AgentTask for legacy
   * readers. Optional so existing tests that construct ProcessorDeps
   * without it keep working.
   */
  ticketService?: {
    createAsNewWork: (input: {
      tenantId: string;
      roleSlug: string;
      title: string;
      description?: string;
      meetingId?: string | null;
      payload?: Record<string, unknown>;
      agentTaskInput?: Record<string, unknown>;
    }) => Promise<{ ticket: { id: string }; agentTaskId: string }>;
  };
  logger: {
    info: (message: string, data?: Record<string, unknown>) => void;
    debug: (message: string, data?: Record<string, unknown>) => void;
    warn: (message: string, data?: Record<string, unknown>) => void;
    error: (message: string, data?: Record<string, unknown>) => void;
  };
  /** GitHub service for Dev/QA agent operations */
  githubService?: {
    isAvailable: () => boolean;
    createBranch: (input: { branchName: string; fromRef?: string }) => Promise<{ ref: string; sha: string }>;
    createOrUpdateFile: (input: {
      path: string; content: string; message: string; branch: string; sha?: string;
    }) => Promise<{ sha: string; path: string }>;
    createPullRequest: (input: {
      title: string; body: string; head: string; base?: string; labels?: string[]; reviewers?: string[];
    }) => Promise<{ number: number; htmlUrl: string; title: string; state: string }>;
    getPRFiles: (owner: string | undefined, repo: string | undefined, prNumber: number) => Promise<Array<{
      filename: string; status: string; additions: number; deletions: number; patch?: string;
    }>>;
    getCheckRuns: (owner: string | undefined, repo: string | undefined, ref: string) => Promise<Array<{
      name: string; status: string; conclusion: string | null; htmlUrl: string;
    }>>;
    getDefaultOwner?: () => string | undefined;
    getDefaultRepo?: () => string | undefined;
  };
  /** Gemini service for AI code generation and review */
  geminiService?: {
    generateContent: (prompt: string) => Promise<string>;
  };
  /** Clarification timeout service */
  clarificationTimeoutService?: {
    checkStaleClarifications: () => Promise<{
      checked: number; remindersScheduled: number; escalated: number; expired: number; autoApproved: number;
    }>;
    sendReminder: (data: ClarificationReminderJobData) => Promise<void>;
  };
  /** Engagement service for advancing phases */
  engagementService: {
    create: (tenantId: string, input: {
      title: string;
      meetingId?: string;
      metadata?: Record<string, unknown>;
    }) => Promise<{ id: string }>;
    advancePhase?: (tenantId: string, engagementId: string, input: {
      confidence?: number;
      targetPhase?: string;
      output?: Record<string, unknown>;
    }) => Promise<any>;
  };
  /** Queue service for dispatching follow-up jobs */
  queueService?: {
    addJob: (jobType: string, data: unknown, options?: { priority?: number; delay?: number }) => Promise<string>;
  };
  /** Communication router for multi-channel notifications */
  communicationRouter?: {
    send: (input: {
      tenantId: string;
      recipientRole: string;
      messageType: string;
      content: string;
      metadata?: Record<string, unknown>;
      urgency?: string;
    }) => Promise<{ success: boolean; channel?: string }>;
  };
  /** Storage service for downloading audio (local or S3) */
  storageService?: {
    generatePresignedDownloadUrl: (storageKey: string) => Promise<string>;
    deleteObject: (storageKey: string) => Promise<void>;
  };
  /** Transcription service (Whisper API) */
  transcriptionService?: {
    isEnabled: () => boolean;
    transcribe: (buffer: Buffer, filename: string, mimeType?: string) => Promise<{
      segments: Array<{ start: number; end: number; text: string }>;
      fullText: string;
      duration: number;
      wordCount: number;
    }>;
  };
  /** Prisma client for direct database access */
  prisma?: {
    meeting: { update: (args: any) => Promise<any>; };
    transcript: { create: (args: any) => Promise<any>; };
    meetingInsights: { create: (args: any) => Promise<any>; };
  };
  /** Memory Optimizer Agent for the 'learn' phase */
  memoryOptimizerAgent?: {
    optimizeTenant: (tenantId: string) => Promise<{
      success: boolean;
      memoriesScanned: number;
      memoriesPromoted: number;
      memoriesPruned: number;
      patternsExtracted: number;
      confidence: number;
    }>;
  };
  /** OutcomeObserver for recording task outcomes into the learning loop */
  outcomeObserver?: OutcomeObserver;
  /** AgentHub for dispatching jobs to external coding agents */
  agentHub?: AgentHub;
  /** SkillLoader for agent skill injection */
  skillLoader?: {
    resolveAllSkills: (targets: string[]) => Promise<Array<{
      name: string;
      version: string;
      scope: 'foundation' | 'learned';
      content: string;
    }>>;
    loadFoundationSkills: (targets: string[]) => Array<{
      name: string;
      version: string;
      scope: 'foundation' | 'learned';
      content: string;
    }>;
    loadLearnedSkills: (targets: string[]) => Promise<Array<{
      name: string;
      version: string;
      scope: 'foundation' | 'learned';
      content: string;
    }>>;
  };
  /** EmailChannel for digest delivery */
  emailChannel?: EmailChannel;
  /** Prisma client for email digest queries (tenant/user/activity lookups) */
  prismaForDigest?: any;
  /** Hermes nightly distillation — optional, skipped if not wired. */
  skillDistillerService?: {
    distill: () => Promise<{ scanned: number; clusters: number; proposed: number; skipped: number }>;
  };
  /** Hermes daily rerank — optional, skipped if not wired. */
  skillRankingService?: {
    recompute: () => Promise<{ scanned: number; bumped: number; dropped: number; demoted: number }>;
  };
}

/**
 * Create all processor functions with injected dependencies.
 */
export function createProcessors(deps: ProcessorDependencies) {
  const {
    baAgentService,
    engagementService,
    meetingService,
    meetingRepository,
    googleChatService,
    jiraService,
    prdRepository,
    taskRepository,
    ticketService,
    logger,
    githubService,
    geminiService,
    clarificationTimeoutService,
    queueService,
    memoryOptimizerAgent,
    communicationRouter,
    storageService,
    transcriptionService,
    prisma,
    skillLoader,
    outcomeObserver,
    agentHub,
    emailChannel,
    prismaForDigest,
    skillDistillerService,
    skillRankingService,
  } = deps;

  return {
    /**
     * Transcribe meeting audio: download from storage, run through Whisper,
     * store transcript, optionally generate insights, then queue MEETING_PROCESS.
     */
    [JobType.MEETING_TRANSCRIBE]: async (job: Job<MeetingTranscribeJobData>) => {
      const { meetingId, tenantId, storageKey, source } = job.data;
      logger.info('Starting meeting transcription', { jobId: job.id, meetingId, tenantId, source, storageKey });

      // ---- Validate dependencies ----
      if (!storageService) {
        throw new Error('storageService is not available — cannot download audio');
      }
      if (!transcriptionService || !transcriptionService.isEnabled()) {
        throw new Error('transcriptionService is not available or not enabled');
      }
      if (!prisma) {
        throw new Error('prisma client is not available — cannot persist transcript');
      }

      await job.updateProgress(5);

      // 1. Download audio from storage via presigned URL
      logger.info('Generating presigned download URL', { meetingId, storageKey });
      const presignedUrl = await storageService.generatePresignedDownloadUrl(storageKey);

      await job.updateProgress(10);

      logger.info('Downloading audio from storage', { meetingId });
      const response = await fetch(presignedUrl);
      if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      await job.updateProgress(25);
      logger.info('Audio downloaded', { meetingId, sizeBytes: audioBuffer.length });

      // 2. Transcribe via Whisper
      const filename = storageKey.split('/').pop() || 'audio.webm';
      const mimeType = filename.endsWith('.mp3') ? 'audio/mpeg'
        : filename.endsWith('.wav') ? 'audio/wav'
        : filename.endsWith('.m4a') ? 'audio/mp4'
        : 'audio/webm';

      logger.info('Sending audio to transcription service', { meetingId, filename, mimeType });
      const transcriptionResult = await transcriptionService.transcribe(audioBuffer, filename, mimeType);

      await job.updateProgress(60);
      logger.info('Transcription complete', {
        meetingId,
        duration: transcriptionResult.duration,
        wordCount: transcriptionResult.wordCount,
        segmentCount: transcriptionResult.segments.length,
      });

      // 3. Create Transcript record via Prisma
      const transcript = await prisma.transcript.create({
        data: {
          meetingId,
          fullText: transcriptionResult.fullText,
          segments: transcriptionResult.segments,
          duration: transcriptionResult.duration,
          wordCount: transcriptionResult.wordCount,
          source,
          storageKey,
        },
      });

      await job.updateProgress(70);
      logger.info('Transcript record created', { meetingId, transcriptId: transcript.id });

      // 4. Generate MeetingInsights via geminiService (if available)
      if (geminiService) {
        try {
          const insightsPrompt = [
            'Analyze the following meeting transcript and extract structured insights.',
            'Return a JSON object with: summary (string), keyDecisions (string[]),',
            'actionItems (string[]), risks (string[]), sentiment (positive/neutral/negative).',
            '',
            'Transcript:',
            transcriptionResult.fullText,
          ].join('\n');

          const insightsRaw = await geminiService.generateContent(insightsPrompt);
          const jsonMatch = insightsRaw.match(/\{[\s\S]*\}/);

          if (jsonMatch) {
            const insights = JSON.parse(jsonMatch[0]);
            await prisma.meetingInsights.create({
              data: {
                meetingId,
                summary: insights.summary || '',
                keyDecisions: insights.keyDecisions || [],
                actionItems: insights.actionItems || [],
                risks: insights.risks || [],
                sentiment: insights.sentiment || 'neutral',
              },
            });
            logger.info('Meeting insights generated and saved', { meetingId });
          }
        } catch (insightErr) {
          logger.warn('Failed to generate meeting insights (non-fatal)', {
            meetingId,
            error: (insightErr as Error).message,
          });
        }
      }

      await job.updateProgress(85);

      // 5. Update meeting status to 'completed'
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { status: 'completed' },
      });

      logger.info('Meeting status updated to completed', { meetingId });

      // 6. Queue MEETING_PROCESS job for downstream processing (BA Agent, etc.)
      if (queueService) {
        await queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId,
          tenantId,
        });
        logger.info('Queued MEETING_PROCESS job for downstream processing', { meetingId });
      } else {
        logger.warn('queueService not available — cannot queue MEETING_PROCESS follow-up', { meetingId });
      }

      await job.updateProgress(100);
      logger.info('Meeting transcription pipeline complete', {
        meetingId,
        tenantId,
        source,
        transcriptId: transcript.id,
        duration: transcriptionResult.duration,
        wordCount: transcriptionResult.wordCount,
      });

      return {
        transcriptId: transcript.id,
        duration: transcriptionResult.duration,
        wordCount: transcriptionResult.wordCount,
      };
    },

    /**
     * Process a completed meeting.
     */
    [JobType.MEETING_PROCESS]: async (job: Job<MeetingProcessJobData>) => {
      const { meetingId, tenantId } = job.data;
      logger.info('Processing meeting', { jobId: job.id, meetingId });

      const meeting = await meetingService.getMeetingWithTranscript(meetingId);

      if (!meeting) {
        throw new Error(`Meeting not found: ${meetingId}`);
      }

      if (!meeting.transcript) {
        logger.warn('Meeting has no transcript, skipping', { meetingId });
        return;
      }

      // Create or reuse an engagement for this completed meeting. BullMQ may
      // retry MEETING_PROCESS jobs, and a duplicate enqueue would otherwise
      // produce two active engagements for the same meeting — the
      // approve-time "find latest active engagement by meetingId" lookup
      // would then resolve non-deterministically. We look for an existing
      // active engagement first and reuse it on retries.
      let createdEngagementId: string | null = null;
      try {
        const existing = await (engagementService as any).prisma?.engagement?.findFirst?.({
          where: { tenantId, meetingId, status: 'active' },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (existing?.id) {
          createdEngagementId = existing.id;
          logger.info('Reusing existing active engagement for meeting', {
            engagementId: existing.id,
            meetingId,
          });
        } else {
          const engagement = await engagementService.create(tenantId, {
            title: meeting.title || `Meeting ${meetingId}`,
            meetingId,
          });
          createdEngagementId = engagement.id;
          logger.info('Engagement created for completed meeting', {
            engagementId: engagement.id,
            meetingId,
          });
        }
      } catch (engagementError) {
        logger.error('Failed to create or reuse engagement for meeting', {
          meetingId,
          error: (engagementError as Error).message,
        });
        // Non-fatal: continue with BA agent processing even if engagement creation fails
      }

      // N6 final: Ticket is the primary write path. When ticketService
      // is wired, use createAsNewWork so the Ticket row drives
      // everything and an AgentTask is reverse-mirrored for legacy
      // readers. Falls back to the pre-N6 createTask path when
      // ticketService isn't in the deps (older test harnesses).
      let task: { id: string };
      if (ticketService) {
        const created = await ticketService.createAsNewWork({
          tenantId,
          roleSlug: 'ba_agent',
          title: meeting.title || `Meeting ${meetingId}`,
          meetingId,
          agentTaskInput: {
            type: 'meeting_transcript',
            meetingId,
            transcriptId: meeting.transcript.id,
            transcript: meeting.transcript.fullText,
          },
          payload: {
            type: 'meeting_transcript',
            meetingId,
            transcriptId: meeting.transcript.id,
          },
        });
        task = { id: created.agentTaskId };
      } else {
        task = await taskRepository.createTask({
          tenantId,
          meetingId,
          agentType: 'ba_agent',
          input: {
            type: 'meeting_transcript',
            meetingId,
            transcriptId: meeting.transcript.id,
            transcript: meeting.transcript.fullText,
          },
        });
      }

      logger.info('Agent task created for meeting, dispatching BA Agent', {
        taskId: task.id,
        meetingId,
      });

      // Build additional context from voice-captured data (if any)
      let additionalContext: string | undefined;
      if (meetingRepository) {
        try {
          const meetingRecord = await meetingRepository.findById(meetingId);
          const voiceData = (meetingRecord?.metadata as Record<string, unknown>)?.voiceCapturedData as {
            requirements?: Array<{ name: string; args: Record<string, unknown> }>;
            decisions?: Array<{ name: string; args: Record<string, unknown> }>;
            actionItems?: Array<{ name: string; args: Record<string, unknown> }>;
            flags?: Array<{ name: string; args: Record<string, unknown> }>;
          } | undefined;

          if (voiceData) {
            const parts: string[] = ['VOICE-CAPTURED DATA FROM MEETING (real-time AI notes):'];
            if (voiceData.requirements && voiceData.requirements.length > 0) {
              parts.push('\nRequirements captured:');
              voiceData.requirements.forEach((r, i) => {
                parts.push(`${i + 1}. ${JSON.stringify(r.args)}`);
              });
            }
            if (voiceData.decisions && voiceData.decisions.length > 0) {
              parts.push('\nDecisions captured:');
              voiceData.decisions.forEach((d, i) => {
                parts.push(`${i + 1}. ${JSON.stringify(d.args)}`);
              });
            }
            if (voiceData.actionItems && voiceData.actionItems.length > 0) {
              parts.push('\nAction items captured:');
              voiceData.actionItems.forEach((a, i) => {
                parts.push(`${i + 1}. ${JSON.stringify(a.args)}`);
              });
            }
            if (voiceData.flags && voiceData.flags.length > 0) {
              parts.push('\nFlags/concerns captured:');
              voiceData.flags.forEach((f, i) => {
                parts.push(`${i + 1}. [${f.name}] ${JSON.stringify(f.args)}`);
              });
            }
            if (parts.length > 1) {
              additionalContext = parts.join('\n');
              logger.info('Including voice-captured data as additional context', {
                meetingId,
                contextLength: additionalContext.length,
              });
            }
          }
        } catch (err) {
          logger.warn('Failed to fetch voice-captured data for meeting', {
            meetingId,
            error: (err as Error).message,
          });
        }
      }

      // Auto-trigger PRD generation by dispatching to BA Agent
      // Sanitize transcript before passing to AI pipeline to mitigate prompt injection
      const sanitizedTranscript = sanitizeForAI(meeting.transcript.fullText);
      try {
        const result = await baAgentService.processMeetingTranscript(
          task.id,
          tenantId,
          meetingId,
          sanitizedTranscript,
          additionalContext ? { additionalContext } : undefined
        );

        logger.info('BA Agent processing completed from meeting processor', {
          taskId: task.id,
          meetingId,
          prdId: result.prd?.id,
          confidence: result.confidence,
          needsClarification: result.needsClarification,
          councilDecision: result.councilDecision,
        });

        // Engagement phase advancement: BA agent does the work of three
        // phases in one shot (listen → understand → analyze_ask → approve).
        // Walk the engagement through those transitions so a subsequent
        // PRD-approve call (approve → build) is a valid transition.
        // Without this the engagement stays in `listen` and the dev
        // dispatch silently fails on `Invalid transition from 'listen'
        // to 'build'`. See task #187.
        if (
          createdEngagementId &&
          result.prd?.id &&
          !result.needsClarification &&
          (engagementService as any).advancePhase
        ) {
          // Each transition has its OWN try/catch and we re-read the
          // engagement's current phase before each step, so:
          //   (a) a transient mid-walk failure no longer leaves the
          //       engagement permanently stuck — a BA retry will pick
          //       up wherever the previous run got to instead of
          //       trying to redo `listen → understand` on something
          //       that's already at `understand` and immediately
          //       throwing "Invalid transition" (greptile P1 here).
          //   (b) the loop continues on transient failures rather than
          //       breaking, so a Prisma blip on step 2 doesn't skip
          //       step 3 — at worst the next retry catches it.
          // We also force confidence to 1.0 because the BA agent
          // finishing without flagging clarification is itself proof
          // the work is done. Forwarding `result.confidence` would
          // silently pause the engagement when Gemini returned <0.5.
          const PHASE_ORDER = ['listen', 'understand', 'analyze_ask', 'approve'] as const;
          const targets = ['understand', 'analyze_ask', 'approve'] as const;
          let stuckAt: string | null = null;
          for (const target of targets) {
            try {
              const current = await (engagementService as any).get?.(createdEngagementId);
              const currentIdx = current ? PHASE_ORDER.indexOf(current.phase) : -1;
              const targetIdx = PHASE_ORDER.indexOf(target);
              // Skip if the engagement is already at-or-past this
              // phase (likely a retry of a partially-completed walk).
              if (currentIdx >= targetIdx) continue;
              await (engagementService as any).advancePhase(tenantId, createdEngagementId, {
                confidence: 1.0,
                targetPhase: target,
                output: { prdId: result.prd.id, baCompleted: true },
              });
            } catch (advanceErr) {
              stuckAt = target;
              logger.error('Failed to advance engagement phase after BA', {
                engagementId: createdEngagementId,
                target,
                error: (advanceErr as Error).message,
              });
              // Don't break — a later phase might still succeed even
              // if this one threw transiently. If it doesn't, the
              // next BA retry's skip-if-past-phase check resumes.
            }
          }
          if (!stuckAt) {
            logger.info('Engagement walked through BA phases to approve', {
              engagementId: createdEngagementId,
              prdId: result.prd.id,
            });
          } else {
            logger.warn('Engagement may be stuck after BA — next retry will resume', {
              engagementId: createdEngagementId,
              prdId: result.prd.id,
              stuckAt,
            });
          }
        }

        // Record outcome for the learning loop
        if (outcomeObserver) {
          await outcomeObserver.recordFromTask(task.id);
        }
      } catch (error) {
        logger.error('BA Agent processing failed from meeting processor', {
          taskId: task.id,
          meetingId,
          error: (error as Error).message,
        });
        // Record rejected outcome even on failure (non-fatal)
        if (outcomeObserver) {
          await outcomeObserver.recordFromTask(task.id);
        }
        // Don't rethrow - the task is already marked as failed by BAAgentService
      }
    },

    /**
     * Process transcript with BA Agent.
     */
    [JobType.BA_AGENT_PROCESS]: async (job: Job<BAAgentProcessJobData>) => {
      const { taskId, tenantId, meetingId, transcript } = job.data;
      // Sanitize transcript from job data before passing to AI pipeline
      const sanitizedTranscript = sanitizeForAI(transcript);
      logger.info('Processing transcript with BA Agent', {
        jobId: job.id,
        taskId,
        transcriptLength: sanitizedTranscript.length,
      });

      await job.updateProgress(10);

      try {
        const result = await baAgentService.processMeetingTranscript(
          taskId,
          tenantId,
          meetingId,
          sanitizedTranscript
        );

        await job.updateProgress(80);

        // Determine status based on council decision and clarification needs
        const needsReview = result.councilDecision === 'needs_human_review';
        const needsClarification = result.needsClarification;

        logger.info('BA Agent processing complete', {
          taskId,
          prdId: result.prd?.id,
          confidence: result.confidence,
          councilDecision: result.councilDecision,
          needsClarification,
        });

        // Record outcome for the learning loop
        if (outcomeObserver) {
          await outcomeObserver.recordFromTask(taskId);
        }

        await job.updateProgress(100);

        return {
          prdId: result.prd?.id,
          confidence: result.confidence,
          status: needsClarification
            ? 'clarification_needed'
            : needsReview
              ? 'review_needed'
              : 'completed',
          googleDocsUrl: result.prd?.googleDocsUrl,
        };
      } catch (error) {
        logger.error('BA Agent processing failed', {
          taskId,
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
        // Record rejected outcome even on failure
        if (outcomeObserver) {
          await outcomeObserver.recordFromTask(taskId);
        }
        throw error;
      }
    },

    /**
     * Sync tickets to Jira.
     */
    [JobType.JIRA_SYNC]: async (job: Job<JiraSyncJobData>) => {
      const { prdId, tenantId, tickets } = job.data;
      logger.info('Syncing tickets to Jira', {
        jobId: job.id,
        prdId,
        ticketCount: tickets.length,
      });

      const results = {
        created: [] as string[],
        failed: [] as Array<{ summary: string; error: string }>,
      };

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        await job.updateProgress(Math.round((i / tickets.length) * 100));

        try {
          const jiraResult = await jiraService.createIssue({
            projectKey: ticket.projectKey,
            issueType: ticket.issueType,
            summary: ticket.summary,
            description: ticket.description,
            priority: ticket.priority,
            labels: ticket.labels,
            storyPoints: ticket.storyPoints,
          });

          await prdRepository.updateTicketExternalKey(ticket.id, jiraResult.key);
          results.created.push(jiraResult.key);

          logger.debug('Ticket synced', {
            localId: ticket.id,
            jiraKey: jiraResult.key,
          });
        } catch (error) {
          results.failed.push({
            summary: ticket.summary,
            error: (error as Error).message,
          });
          logger.error('Failed to sync ticket', {
            ticketId: ticket.id,
            error: (error as Error).message,
          });
        }
      }

      await job.updateProgress(100);

      await googleChatService.sendNotification({
        tenantId,
        type: results.failed.length > 0 ? 'warning' : 'success',
        title: 'Jira Sync Complete',
        message: `Created ${results.created.length} tickets. ` +
          (results.failed.length > 0
            ? `${results.failed.length} failed.`
            : 'All tickets synced successfully.'),
        metadata: {
          prdId,
          jiraKeys: results.created,
          failures: results.failed,
        },
      });

      logger.info('Jira sync completed', {
        prdId,
        created: results.created.length,
        failed: results.failed.length,
      });

      return results;
    },

    /**
     * Send notification.
     */
    [JobType.NOTIFICATION]: async (job: Job<NotificationJobData>) => {
      const { type, tenantId, payload } = job.data;
      logger.info('Sending notification', {
        jobId: job.id,
        type,
        tenantId,
      });

      try {
        switch (type) {
          case 'gchat':
            await googleChatService.sendNotification({
              tenantId,
              type: (payload.type as string) || 'info',
              title: payload.title as string,
              message: payload.message as string,
              metadata: payload.metadata as Record<string, unknown>,
            });
            break;

          case 'email':
          case 'slack':
            if (communicationRouter) {
              await communicationRouter.send({
                tenantId,
                recipientRole: (payload.recipientRole as string) || 'founder',
                messageType: 'notification',
                content: `${payload.title ?? 'Notification'}\n\n${payload.message ?? ''}`,
                metadata: { ...(payload.metadata as Record<string, unknown> ?? {}), preferredChannel: type },
                urgency: (payload.urgency as string) || 'medium',
              });
            } else {
              logger.warn(`${type} notification: CommunicationRouter not available`);
            }
            break;

          default:
            logger.warn('Unknown notification type', { type });
        }

        logger.info('Notification sent', { type, tenantId });
      } catch (error) {
        logger.error('Failed to send notification', {
          type,
          tenantId,
          error: (error as Error).message,
        });
      }
    },

    /**
     * Dev Agent: dispatches PRD implementation to AgentHub for external coding agents.
     * Creates an AgentTask, serializes the PRD to markdown, and calls agentHub.dispatchJob().
     * Async completion is handled by the AgentHub bridge (job_result handler).
     */
    [JobType.DEV_AGENT_PROCESS]: async (job: Job<DevAgentProcessJobData>) => {
      const { prdId, engagementId, tenantId, taskId } = job.data;
      // N6 follow-up: ticketId defaults to the mirror id; callers that
      // want to skip AgentTask entirely can pass their own.
      const ticketId = job.data.ticketId ?? `tix_legacy_${taskId}`;
      logger.info('Dev Agent dispatching PRD to AgentHub', { jobId: job.id, prdId, engagementId, ticketId });

      await job.updateProgress(5);

      // Mark task as processing
      try {
        await (prdRepository as any).prisma?.agentTask?.update?.({
          where: { id: taskId },
          data: { status: 'processing' },
        });
      } catch { /* best-effort */ }

      // Gate: agentHub must be available
      if (!agentHub) {
        logger.error('No agent hub configured — Dev Agent cannot dispatch', { prdId });
        try {
          await (prdRepository as any).prisma?.agentTask?.update?.({
            where: { id: taskId },
            data: { status: 'failed', error: 'No agent hub configured', completedAt: new Date() },
          });
        } catch { /* best-effort */ }
        return;
      }

      // 1. Read the approved PRD
      const prd = await (prdRepository as any).findByIdWithTickets?.(prdId) ?? await (prdRepository as any).findById?.(prdId);
      if (!prd || prd.status !== 'approved') {
        throw new Error(`PRD ${prdId} not found or not approved`);
      }

      await job.updateProgress(20);

      // 2. Serialize PRD to readable markdown
      const prdContent = [
        `# ${prd.title}`,
        prd.summary ? `\n## Summary\n${prd.summary}` : '',
        prd.requirements ? `\n## Requirements\n${JSON.stringify(prd.requirements, null, 2)}` : '',
        prd.acceptanceCriteria ? `\n## Acceptance Criteria\n${prd.acceptanceCriteria}` : '',
      ].filter(Boolean).join('\n');

      const targetRepo = prd.targetRepo || 'default';

      await job.updateProgress(40);

      // 3. Dispatch to AgentHub
      try {
        const jobId = await agentHub.dispatchJob(tenantId, targetRepo, {
          tenantId,
          action: 'implement_prd',
          targetRepo,
          payload: {
            taskId,
            ticketId, // N6: daemon callbacks can target ticket-first
            prdId,
            engagementId,
            prdContent,
            branch: `workforce0/prd-${prdId.slice(0, 8)}`,
            // The daemon's executor reads targetRepo from payload to
            // route the work to the right local checkout. Without it the
            // job fails with "Unknown targetRepo: """.
            targetRepo,
          },
        });

        logger.info('Dev Agent job dispatched to AgentHub', { prdId, jobId, targetRepo, ticketId });
      } catch (err) {
        logger.error('Failed to dispatch Dev Agent job to AgentHub', { prdId, error: (err as Error).message });
        try {
          await (prdRepository as any).prisma?.agentTask?.update?.({
            where: { id: taskId },
            data: { status: 'failed', error: (err as Error).message, completedAt: new Date() },
          });
        } catch { /* best-effort */ }
        return;
      }

      await job.updateProgress(100);

      logger.info('Dev Agent dispatch complete — async completion via AgentHub', { prdId, taskId });
      return { dispatched: true, prdId, taskId };
    },

    /**
     * QA Agent: dispatches PR review to AgentHub for external coding agents.
     * Creates an AgentTask, reads PRD for context, and calls agentHub.dispatchJob().
     * This path handles both queue-triggered and manual triggers; AgentHub also
     * chains QA jobs automatically after dev completion.
     */
    [JobType.QA_AGENT_PROCESS]: async (job: Job<QAAgentProcessJobData>) => {
      const { prdId, prNumber, engagementId, tenantId, taskId, repoOwner, repoName } = job.data;
      const ticketId = job.data.ticketId ?? `tix_legacy_${taskId}`;
      logger.info('QA Agent dispatching PR review to AgentHub', { jobId: job.id, prdId, prNumber, ticketId });

      await job.updateProgress(5);

      // Gate: agentHub must be available
      if (!agentHub) {
        logger.error('No agent hub configured — QA Agent cannot dispatch', { prdId, prNumber });
        try {
          await (prdRepository as any).prisma?.agentTask?.update?.({
            where: { id: taskId },
            data: { status: 'failed', error: 'No agent hub configured', completedAt: new Date() },
          });
        } catch { /* best-effort */ }
        return;
      }

      // 1. Read PRD for context
      const prd = await (prdRepository as any).findById?.(prdId);
      if (!prd) {
        throw new Error(`PRD ${prdId} not found`);
      }

      await job.updateProgress(20);

      // 2. Serialize PRD to readable markdown
      const prdContent = [
        `# ${prd.title}`,
        prd.summary ? `\n## Summary\n${prd.summary}` : '',
        prd.requirements ? `\n## Requirements\n${JSON.stringify(prd.requirements, null, 2)}` : '',
        prd.acceptanceCriteria ? `\n## Acceptance Criteria\n${prd.acceptanceCriteria}` : '',
      ].filter(Boolean).join('\n');

      const targetRepo = prd.targetRepo || (repoOwner && repoName ? `${repoOwner}/${repoName}` : 'default');

      await job.updateProgress(40);

      // 3. Dispatch to AgentHub
      try {
        const jobId = await agentHub.dispatchJob(tenantId, targetRepo, {
          tenantId,
          action: 'review_pr',
          targetRepo,
          payload: {
            taskId,
            ticketId, // N6: daemon callbacks can target ticket-first
            prdId,
            engagementId,
            prdContent,
            prNumber,
            repoOwner,
            repoName,
          },
        });

        logger.info('QA Agent job dispatched to AgentHub', { prdId, prNumber, jobId, targetRepo, ticketId });
      } catch (err) {
        logger.error('Failed to dispatch QA Agent job to AgentHub', { prdId, prNumber, error: (err as Error).message });
        try {
          await (prdRepository as any).prisma?.agentTask?.update?.({
            where: { id: taskId },
            data: { status: 'failed', error: (err as Error).message, completedAt: new Date() },
          });
        } catch { /* best-effort */ }
        return;
      }

      await job.updateProgress(100);

      logger.info('QA Agent dispatch complete — async completion via AgentHub', { prdId, prNumber, taskId });
      return { dispatched: true, prdId, prNumber, taskId };
    },

    /**
     * Check for stale clarification requests and process timeouts.
     */
    [JobType.CLARIFICATION_TIMEOUT]: async (job: Job<ClarificationTimeoutJobData>) => {
      logger.info('Running clarification timeout check', { jobId: job.id });

      if (!clarificationTimeoutService) {
        logger.warn('ClarificationTimeoutService not available');
        return;
      }

      const result = await clarificationTimeoutService.checkStaleClarifications();
      logger.info('Clarification timeout check complete', result);
      return result;
    },

    /**
     * Send a clarification reminder notification.
     */
    [JobType.CLARIFICATION_REMINDER]: async (job: Job<ClarificationReminderJobData>) => {
      logger.info('Sending clarification reminder', { jobId: job.id, data: job.data });

      if (!clarificationTimeoutService) {
        logger.warn('ClarificationTimeoutService not available');
        return;
      }

      await clarificationTimeoutService.sendReminder(job.data);
    },

    /**
     * Memory Optimizer: consolidate, pattern-extract, prune per-tenant memories.
     * Triggered by the 'learn' phase or scheduled nightly.
     */
    [JobType.MEMORY_OPTIMIZER]: async (job: Job<MemoryOptimizerJobData>) => {
      const { tenantId, trigger, engagementId } = job.data;
      logger.info('Memory Optimizer running', { jobId: job.id, tenantId, trigger, engagementId });

      if (!memoryOptimizerAgent) {
        logger.warn('MemoryOptimizerAgent not available — skipping memory optimization');
        return;
      }

      await job.updateProgress(10);

      try {
        const result = await memoryOptimizerAgent.optimizeTenant(tenantId);

        await job.updateProgress(90);

        // Notify on completion
        await googleChatService.sendNotification({
          tenantId,
          type: result.success ? 'success' : 'warning',
          title: 'Memory Optimization Complete',
          message: [
            `Scanned: ${result.memoriesScanned}`,
            `Promoted: ${result.memoriesPromoted}`,
            `Pruned: ${result.memoriesPruned}`,
            `Patterns: ${result.patternsExtracted}`,
            `Confidence: ${(result.confidence * 100).toFixed(0)}%`,
          ].join(' | '),
        });

        // If triggered by engagement completion, advance to next phase
        if (trigger === 'engagement_complete' && engagementId && engagementService.advancePhase) {
          try {
            await engagementService.advancePhase(tenantId, engagementId, {
              confidence: result.confidence,
              output: {
                memoriesScanned: result.memoriesScanned,
                memoriesPromoted: result.memoriesPromoted,
                memoriesPruned: result.memoriesPruned,
                patternsExtracted: result.patternsExtracted,
              },
            });
          } catch (err) {
            logger.error('Failed to advance engagement after memory optimization', {
              engagementId,
              error: (err as Error).message,
            });
          }
        }

        await job.updateProgress(100);
        logger.info('Memory Optimizer completed', { tenantId, ...result });
        return result;
      } catch (err) {
        logger.error('Memory Optimizer failed', { tenantId, error: (err as Error).message });
        throw err;
      }
    },

    /**
     * Send the daily email digest to all tenant users.
     *
     * Uses the EmailDigestService which gracefully handles stub mode when
     * SendGrid is not configured.
     */
    [JobType.EMAIL_DIGEST]: async (job: Job) => {
      logger.info('Starting daily email digest run', { jobId: job.id });

      const digestPrisma = prismaForDigest ?? prisma;
      if (!digestPrisma) {
        throw new Error('Prisma client not available for email digest');
      }

      const digestService = new EmailDigestService(digestPrisma, emailChannel);
      await digestService.sendDigestToAllTenants();

      logger.info('Daily email digest run complete', { jobId: job.id });
    },

    /**
     * Hermes nightly distillation. Scans the last 30 days of AgentOutcomes,
     * clusters approved runs by (agentType, tool signature), and drops
     * candidate LearnedSkill rows for admin review. Gemini-dependent — the
     * service itself short-circuits when Gemini isn't configured, so this
     * processor is always safe to run.
     */
    [JobType.SKILL_DISTILL]: async (job: Job) => {
      if (!skillDistillerService) {
        logger.info('Skill distill job skipped — service not wired', { jobId: job.id });
        return;
      }
      logger.info('Starting nightly skill distillation', { jobId: job.id });
      const result = await skillDistillerService.distill();
      logger.info('Skill distillation complete', { jobId: job.id, ...result });
    },

    /**
     * Hermes daily rerank. Pulls the last 14 days of AgentOutcomes per
     * agentType, nudges each active learned skill's confidence up or down,
     * auto-demoting anything that drops below threshold.
     */
    [JobType.SKILL_RERANK]: async (job: Job) => {
      if (!skillRankingService) {
        logger.info('Skill rerank job skipped — service not wired', { jobId: job.id });
        return;
      }
      logger.info('Starting daily skill rerank', { jobId: job.id });
      const result = await skillRankingService.recompute();
      logger.info('Skill rerank complete', { jobId: job.id, ...result });
    },
  };
}
