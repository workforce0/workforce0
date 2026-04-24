/**
 * =============================================================================
 * BA AGENT SERVICE
 * =============================================================================
 *
 * Business Analyst Agent - generates PRDs from meeting transcripts.
 *
 * This is the core AI agent that transforms unstructured meeting discussions
 * into structured Product Requirements Documents (PRDs).
 *
 * Processing Pipeline (with AI Council):
 * --------------------------------------
 * 1. Receive transcript
 * 2. Generate PRD with AI Council (Gemini + OpenAI critique)
 * 3. If council says "needs_revision" → feed critique back, regenerate (max 2x)
 * 4. If council says "approved" → create PRD record
 * 5. If council says "needs_human_review" → request clarification
 * 6. Optionally create Jira tickets
 *
 * Council Decision Handling:
 * --------------------------
 * - "approved": Auto-approve, ready for ticket creation
 * - "needs_revision": Regenerate with critique feedback (up to maxRevisions)
 * - "needs_human_review": Request clarification from human
 * - "rejected": Fail the task, notify human
 *
 * @module services/agent/ba-agent
 */

import { createChildLogger } from '../../lib/logger.js';
import { AppError } from '../../lib/error-handler.js';
import { TaskRepository } from '../../repositories/task.repository.js';
import { PRDRepository } from '../../repositories/prd.repository.js';
import { MeetingRepository } from '../../repositories/meeting.repository.js';
import { GeminiService, GeneratedPRD, GeneratePRDOptions } from '../ai/gemini.service.js';
import { AICouncil, CouncilDecision } from '../ai/ai-council.js';
import { JiraService, CreateIssueInput, BulkCreateResult } from '../integrations/jira.service.js';
import { GoogleChatService } from '../integrations/gchat.service.js';
import { GoogleDocsService, PRDExportContent } from '../integrations/gdocs.service.js';
import { Requirement, Risk } from '../../types/index.js';
import { PrismaClient } from '../../../prisma/generated/client/index.js';
import { config } from '../../config/index.js';

const logger = createChildLogger({ service: 'BAAgentService' });

/**
 * Configuration for BA Agent behavior.
 */
export interface BAAgentConfig {
  /** Confidence threshold for auto-approval */
  autoApproveThreshold: number;
  /** Confidence threshold below which clarification is requested */
  clarificationThreshold: number;
  /** Maximum clarifying questions to ask */
  maxClarifyingQuestions: number;
  /** Whether to notify on PRD generation */
  notifyOnGeneration: boolean;
  /** Default Jira project key */
  defaultJiraProject?: string;
  /** Maximum revision iterations when council says needs_revision */
  maxRevisionIterations: number;
  /** Use AI Council for multi-model consensus (if available) */
  useCouncil: boolean;
}

const DEFAULT_CONFIG: BAAgentConfig = {
  autoApproveThreshold: 0.9,
  clarificationThreshold: 0.7,
  maxClarifyingQuestions: 5,
  notifyOnGeneration: true,
  maxRevisionIterations: 2,
  useCouncil: true,
};

/**
 * Transform new GeneratedPRD format to old database format.
 * This allows us to use the new executive PRD structure with AI
 * while keeping the database schema unchanged.
 */
function transformPRDForDatabase(prd: GeneratedPRD): {
  summary: string;
  objectives: string[];
  requirements: Requirement[];
  acceptanceCriteria: string[];
  outOfScope: string[];
  timeline?: string;
} {
  // Combine user stories and functional requirements into a flat list
  const requirements: Requirement[] = [
    // Convert user stories to requirements
    ...prd.userStories.map((story) => ({
      id: story.id,
      title: `[${story.persona}] ${story.story.substring(0, 80)}`,
      description: story.story,
      priority: mapPriority(story.priority),
      type: 'functional' as const,
      acceptanceCriteria: story.acceptanceCriteria,
    })),
    // Add functional requirements
    ...prd.functionalRequirements.map((req) => ({
      id: req.id,
      title: req.title,
      description: req.description,
      priority: mapPriority(req.priority),
      type: 'functional' as const,
      acceptanceCriteria: [],
    })),
  ];

  // Extract all acceptance criteria from user stories
  const acceptanceCriteria = prd.userStories
    .flatMap((story) => story.acceptanceCriteria)
    .concat(prd.goals.successCriteria);

  return {
    summary: prd.executiveSummary.overview,
    objectives: prd.goals.objectives.map((obj) => obj.objective),
    requirements,
    acceptanceCriteria,
    outOfScope: prd.scope.outOfScope,
    timeline: prd.timeline?.estimatedDuration,
  };
}

/**
 * Map generated risks to repository type.
 */
function mapRisks(risks: GeneratedPRD['risks']): Risk[] {
  return risks.map((r) => ({
    description: r.description,
    impact: mapImpact(r.impact),
    mitigation: r.mitigation,
  }));
}

/**
 * Map priority string to union type.
 */
function mapPriority(p: string): Requirement['priority'] {
  const mapping: Record<string, Requirement['priority']> = {
    'must-have': 'critical',
    'should-have': 'high',
    'nice-to-have': 'medium',
    'future': 'low',
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
  };
  return mapping[p.toLowerCase()] || 'medium';
}

/**
 * Map type string to union type.
 */
function mapType(t: string): Requirement['type'] {
  const mapping: Record<string, Requirement['type']> = {
    functional: 'functional',
    non_functional: 'non_functional',
    technical: 'technical',
    business: 'functional',
  };
  return mapping[t.toLowerCase()] || 'functional';
}

/**
 * Map impact string to union type.
 */
function mapImpact(i: string): Risk['impact'] {
  const mapping: Record<string, Risk['impact']> = {
    high: 'high',
    medium: 'medium',
    low: 'low',
    critical: 'high',
  };
  return mapping[i.toLowerCase()] || 'medium';
}

/**
 * Result of processing a meeting transcript.
 */
export interface ProcessResult {
  taskId: string;
  prd?: {
    id: string;
    title: string;
    status: string;
    /** URL to Google Docs export (if configured) */
    googleDocsUrl?: string | null;
  };
  confidence: number;
  needsClarification: boolean;
  clarificationQuestions?: string[];
  /** Council decision (if council was used) */
  councilDecision?: CouncilDecision['decision'];
  /** Number of revision iterations performed */
  revisionIterations?: number;
  /** Outstanding issues from council critique */
  outstandingIssues?: string[];
}

/**
 * BA Agent Service - generates PRDs from meeting transcripts.
 *
 * @example
 * ```typescript
 * const baAgent = new BAAgentService(
 *   taskRepo,
 *   prdRepo,
 *   meetingRepo,
 *   geminiService,
 *   jiraService,
 *   gchatService,
 *   config
 * );
 *
 * // Process a meeting transcript
 * const result = await baAgent.processMeetingTranscript(
 *   taskId,
 *   tenantId,
 *   meetingId,
 *   transcript
 * );
 *
 * // Handle clarification response
 * if (result.needsClarification) {
 *   await baAgent.handleClarificationResponse(clarificationId, answer);
 * }
 *
 * // Create Jira tickets from approved PRD
 * await baAgent.createJiraTickets(prdId, 'PROJ', { epicKey: 'PROJ-100' });
 * ```
 */
export class BAAgentService {
  private readonly config: BAAgentConfig;

  /**
   * Hermes III integration hooks — optional. When provided, the service
   * redacts transcripts before model calls, prefetches memory context,
   * and emits trajectory events. Not required (legacy tests pass none).
   */
  private readonly hermesRedact?: (text: string) => string;
  private readonly hermesMemory?: {
    prefetchAll: (q: string, sid: string) => Promise<string>;
    buildContextBlock: (raw: string) => string;
    providerCount: () => number;
  };
  private readonly hermesTrajectory?: {
    record: (event: Record<string, unknown>) => Promise<void>;
  };
  /**
   * M2 goal-ancestry hook. Given a meetingId, returns a short text block
   * the BA can prepend to its prompt so Gemini knows the "why" behind
   * the transcript. Returns empty string when no goal is wired.
   */
  private readonly goalContext?: (tenantId: string, meetingId: string) => Promise<string>;

  /**
   * M3 per-role budget gate. Pre-flight check returning `{over, used, cap}`
   * for the BA role. When `over=true`, the service fails the task fast
   * with a typed error instead of burning more tokens.
   */
  private readonly budgetGate?: (tenantId: string) => Promise<{ over: boolean; used: number; cap: number | null }>;

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly prdRepository: PRDRepository,
    private readonly meetingRepository: MeetingRepository,
    private readonly geminiService: GeminiService,
    private readonly jiraService: JiraService | null,
    private readonly gchatService: GoogleChatService | null,
    private readonly aiCouncil: AICouncil | null = null,
    private readonly googleDocsService: GoogleDocsService | null = null,
    private readonly prisma: PrismaClient | null = null,
    config: Partial<BAAgentConfig> = {},
    hermes?: {
      redact?: (text: string) => string;
      memory?: {
        prefetchAll: (q: string, sid: string) => Promise<string>;
        buildContextBlock: (raw: string) => string;
        providerCount: () => number;
      };
      trajectory?: {
        record: (event: Record<string, unknown>) => Promise<void>;
      };
      goalContext?: (tenantId: string, meetingId: string) => Promise<string>;
      budgetGate?: (tenantId: string) => Promise<{ over: boolean; used: number; cap: number | null }>;
    }
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.hermesRedact = hermes?.redact;
    this.hermesMemory = hermes?.memory;
    this.hermesTrajectory = hermes?.trajectory;
    this.goalContext = hermes?.goalContext;
    this.budgetGate = hermes?.budgetGate;

    logger.info('BAAgentService initialized', {
      autoApproveThreshold: this.config.autoApproveThreshold,
      clarificationThreshold: this.config.clarificationThreshold,
      useCouncil: this.config.useCouncil && this.aiCouncil !== null,
      maxRevisionIterations: this.config.maxRevisionIterations,
      googleDocsEnabled: this.googleDocsService?.isAvailable() ?? false,
      hermesWired: Boolean(hermes),
    });
  }

  /**
   * Process a meeting transcript to generate a PRD.
   *
   * Uses AI Council for multi-model consensus when available.
   * Implements revision loop: if council says "needs_revision",
   * feeds critique back and regenerates (up to maxRevisionIterations).
   *
   * @param taskId - Task ID (or undefined to create new)
   * @param tenantId - Tenant ID
   * @param meetingId - Meeting ID
   * @param transcript - Full transcript text
   * @param options - Additional options
   * @returns Processing result
   */
  async processMeetingTranscript(
    taskId: string | undefined,
    tenantId: string,
    meetingId: string,
    transcript: string,
    options: GeneratePRDOptions = {}
  ): Promise<ProcessResult> {
    // M3: pre-flight budget check. If the BA role has blown its monthly
    // token cap, bail immediately with a clear error — never start the
    // task, never hit Gemini. Silent no-op when no cap is configured.
    if (this.budgetGate) {
      try {
        const { over, used, cap } = await this.budgetGate(tenantId);
        if (over) {
          const msg = `BA agent has exceeded its monthly token budget (${used.toLocaleString()} / ${cap?.toLocaleString() ?? '∞'}). Raise the cap in Settings → Agent Roles, or wait until next month.`;
          logger.warn('BA budget exceeded — refusing to process', { tenantId, used, cap });
          if (taskId) {
            try {
              await this.taskRepository.failTask(taskId, msg);
            } catch { /* best-effort — failing the repo write shouldn't mask the budget error */ }
          }
          throw new Error(msg);
        }
      } catch (err) {
        // If the budget check itself throws (network/DB issue), fail-open —
        // better to let the job run than stall the pipeline on a transient.
        if (err instanceof Error && err.message.startsWith('BA agent has exceeded')) throw err;
        logger.warn('BA budget check failed — treating as under budget', { error: (err as Error).message });
      }
    }

    // Hermes III integration: redact before model sees it, prefetch memory,
    // record trajectory. All optional — degrades to identical legacy
    // behavior when hooks aren't wired.
    let processedTranscript = transcript;
    if (this.hermesRedact) {
      processedTranscript = this.hermesRedact(transcript);
    }

    if (this.hermesMemory && this.hermesMemory.providerCount() > 0) {
      try {
        const recall = await this.hermesMemory.prefetchAll(
          processedTranscript.slice(0, 1000),
          meetingId,
        );
        const block = this.hermesMemory.buildContextBlock(recall);
        if (block) {
          // Prepend memory as fenced context — keeps the transcript intact
          // so the BA agent still does its normal analysis
          processedTranscript = `${block}\n\n---\n\nMeeting transcript:\n${processedTranscript}`;
        }
      } catch (err) {
        logger.warn('Memory prefetch failed (swallowed)', { error: (err as Error).message });
      }
    }

    logger.info('Processing meeting transcript', {
      taskId,
      tenantId,
      meetingId,
      transcriptLength: transcript.length,
      processedLength: processedTranscript.length,
      useCouncil: this.config.useCouncil && this.aiCouncil !== null,
      hermesWired: Boolean(this.hermesRedact || this.hermesMemory),
    });

    // Create or update task
    let task;
    if (taskId) {
      task = await this.taskRepository.startProcessing(taskId);
    } else {
      task = await this.taskRepository.createTask({
        tenantId,
        agentType: 'ba_agent',
        meetingId,
        input: {
          type: 'meeting_transcript',
          meetingId,
          transcriptLength: transcript.length,
        },
      });
      await this.taskRepository.startProcessing(task.id);
    }

    if (this.hermesTrajectory) {
      void this.hermesTrajectory.record({
        tenantId,
        sessionId: meetingId,
        agentName: 'ba',
        type: 'turn_started',
        payload: { taskId: task.id, useCouncil: Boolean(this.aiCouncil) },
      });
    }

    // M2: Prepend the goal context block to options.additionalContext so
    // Gemini sees "Working toward: <goal.title> — <goal.outcome>" at the
    // top of the prompt. Non-fatal if the hook is unwired or the
    // engagement has no goal yet.
    let enrichedOptions = options;
    if (this.goalContext) {
      try {
        const goalBlock = await this.goalContext(tenantId, meetingId);
        if (goalBlock) {
          enrichedOptions = {
            ...options,
            additionalContext: options.additionalContext
              ? `${goalBlock}\n\n${options.additionalContext}`
              : goalBlock,
          };
        }
      } catch (err) {
        logger.warn('Goal context lookup failed (swallowed)', { error: (err as Error).message });
      }
    }

    try {
      // Use AI Council if available and enabled
      let result: ProcessResult;
      if (this.config.useCouncil && this.aiCouncil) {
        result = await this.processWithCouncil(task.id, tenantId, meetingId, processedTranscript, enrichedOptions);
      } else {
        // Fallback: Generate PRD using Gemini directly
        result = await this.processWithGeminiOnly(task.id, tenantId, meetingId, processedTranscript, enrichedOptions);
      }

      if (this.hermesTrajectory) {
        void this.hermesTrajectory.record({
          tenantId,
          sessionId: meetingId,
          agentName: 'ba',
          type: 'turn_completed',
          payload: {
            taskId: task.id,
            prdId: result.prd?.id,
            confidence: result.confidence,
            councilDecision: result.councilDecision,
          },
        });
      }

      return result;
    } catch (error) {
      logger.error('Failed to process transcript', {
        taskId: task.id,
        error: (error as Error).message,
      });

      if (this.hermesTrajectory) {
        void this.hermesTrajectory.record({
          tenantId,
          sessionId: meetingId,
          agentName: 'ba',
          type: 'turn_failed',
          payload: { taskId: task.id, error: (error as Error).message },
        });
      }

      await this.taskRepository.failTask(task.id, (error as Error).message);
      throw error;
    }
  }

  /**
   * Process transcript with AI Council (multi-model consensus with revision loop).
   */
  private async processWithCouncil(
    taskId: string,
    tenantId: string,
    meetingId: string,
    transcript: string,
    options: GeneratePRDOptions,
    iteration: number = 0
  ): Promise<ProcessResult> {
    logger.info('Processing with AI Council', {
      taskId,
      iteration,
      maxIterations: this.config.maxRevisionIterations,
    });

    // Generate PRD with council review
    const decision = await this.aiCouncil!.generatePRDWithCouncil(transcript, options);

    logger.info('Council decision received', {
      taskId,
      decision: decision.decision,
      confidence: decision.confidence,
      issueCount: decision.outstandingIssues.length,
      iteration,
    });

    // Handle council decision
    switch (decision.decision) {
      case 'approved':
        return await this.createApprovedPRD(taskId, tenantId, meetingId, decision);

      case 'needs_revision':
        // Check if we can do another revision
        if (iteration < this.config.maxRevisionIterations) {
          logger.info('Revision needed, regenerating with critique feedback', {
            taskId,
            iteration: iteration + 1,
            issues: decision.outstandingIssues.slice(0, 3),
          });

          // Feed critique back as additional context
          const revisionContext = this.buildRevisionContext(decision);
          return this.processWithCouncil(
            taskId,
            tenantId,
            meetingId,
            transcript,
            { ...options, additionalContext: revisionContext },
            iteration + 1
          );
        }

        // Max revisions reached - create PRD in review status
        logger.warn('Max revisions reached, creating PRD for human review', {
          taskId,
          iterations: iteration,
        });
        return await this.createPRDForReview(taskId, tenantId, meetingId, decision, iteration);

      case 'needs_human_review':
        return await this.handleCouncilClarification(taskId, tenantId, meetingId, decision);

      case 'rejected':
        logger.error('Council rejected PRD', {
          taskId,
          issues: decision.outstandingIssues,
        });
        throw new AppError(
          `PRD rejected by AI Council: ${decision.outstandingIssues[0] || 'Unknown reason'}`,
          400,
          'PRD_REJECTED'
        );

      default:
        // Fallback - treat as needs review
        return await this.createPRDForReview(taskId, tenantId, meetingId, decision, iteration);
    }
  }

  /**
   * Build revision context from council critique.
   */
  private buildRevisionContext(decision: CouncilDecision): string {
    const parts: string[] = ['REVISION REQUESTED - Please address the following issues:'];

    if (decision.outstandingIssues.length > 0) {
      parts.push('\nIssues to fix:');
      decision.outstandingIssues.forEach((issue, i) => {
        parts.push(`${i + 1}. ${issue}`);
      });
    }

    if (decision.clarificationQuestions.length > 0) {
      parts.push('\nQuestions to address:');
      decision.clarificationQuestions.forEach((q, i) => {
        parts.push(`${i + 1}. ${q}`);
      });
    }

    if (decision.critique) {
      const criticalIssues = decision.critique.issues.filter(i => i.severity === 'critical');
      if (criticalIssues.length > 0) {
        parts.push('\nCritical issues requiring immediate attention:');
        criticalIssues.forEach((issue, i) => {
          parts.push(`${i + 1}. [${issue.affectedSection}] ${issue.description}`);
          if (issue.suggestion) {
            parts.push(`   Suggestion: ${issue.suggestion}`);
          }
        });
      }
    }

    return parts.join('\n');
  }

  /**
   * Create an approved PRD from council decision.
   */
  private async createApprovedPRD(
    taskId: string,
    tenantId: string,
    meetingId: string,
    decision: CouncilDecision
  ): Promise<ProcessResult> {
    const generatedPrd = decision.prd;

    // Transform new PRD format to database format
    const dbFormat = transformPRDForDatabase(generatedPrd);

    const prd = await this.prdRepository.createPRD({
      taskId,
      meetingId,
      tenantId,
      title: generatedPrd.title,
      summary: dbFormat.summary,
      objectives: dbFormat.objectives,
      requirements: dbFormat.requirements,
      acceptanceCriteria: dbFormat.acceptanceCriteria,
      outOfScope: dbFormat.outOfScope,
      assumptions: generatedPrd.assumptions,
      risks: mapRisks(generatedPrd.risks),
      timeline: dbFormat.timeline,
      confidence: decision.confidence,
    });

    await this.prdRepository.updateStatus(prd.id, 'approved');

    await this.taskRepository.completeTask(
      taskId,
      {
        type: 'prd',
        prdId: prd.id,
        councilDecision: decision.decision,
        council: {
          votes: decision.votes?.map(v => ({
            model: v.model,
            vote: v.vote,
            confidence: v.confidence,
            reasoning: v.reasoning,
            concerns: v.concerns,
          })) ?? [],
          critique: decision.critique ? {
            assessment: decision.critique.overallAssessment,
            confidence: decision.critique.critiqueConfidence,
            issues: decision.critique.issues?.length ?? 0,
            strengths: decision.critique.strengths ?? [],
            missingRisks: decision.critique.missingRisks ?? [],
          } : null,
          consensusReached: decision.consensusReached ?? false,
          outstandingIssues: decision.outstandingIssues ?? [],
          estimatedCost: decision.estimatedCost ?? null,
          timing: decision.timing ?? null,
        },
      },
      decision.confidence,
      false
    );

    if (this.config.notifyOnGeneration && this.gchatService) {
      await this.sendPrdNotification(prd.id, generatedPrd);
    }

    // Export to Google Docs if configured (uses full executive PRD format)
    const googleDocsUrl = await this.exportPrdToGoogleDocs(prd.id, generatedPrd, meetingId);

    logger.info('PRD approved by council', {
      prdId: prd.id,
      confidence: decision.confidence,
      googleDocsUrl,
    });

    return {
      taskId,
      prd: { id: prd.id, title: prd.title, status: 'approved', googleDocsUrl },
      confidence: decision.confidence,
      needsClarification: false,
      councilDecision: decision.decision,
      revisionIterations: 0,
    };
  }

  /**
   * Create PRD in review status (after max revisions or needs_revision).
   */
  private async createPRDForReview(
    taskId: string,
    tenantId: string,
    meetingId: string,
    decision: CouncilDecision,
    iterations: number
  ): Promise<ProcessResult> {
    const generatedPrd = decision.prd;

    // Transform new PRD format to database format
    const dbFormat = transformPRDForDatabase(generatedPrd);

    const prd = await this.prdRepository.createPRD({
      taskId,
      meetingId,
      tenantId,
      title: generatedPrd.title,
      summary: dbFormat.summary,
      objectives: dbFormat.objectives,
      requirements: dbFormat.requirements,
      acceptanceCriteria: dbFormat.acceptanceCriteria,
      outOfScope: dbFormat.outOfScope,
      assumptions: generatedPrd.assumptions,
      risks: mapRisks(generatedPrd.risks),
      timeline: dbFormat.timeline,
      confidence: decision.confidence,
    });

    await this.prdRepository.updateStatus(prd.id, 'review');

    await this.taskRepository.completeTask(
      taskId,
      {
        type: 'prd',
        prdId: prd.id,
        councilDecision: decision.decision,
        iterations,
        council: {
          votes: decision.votes?.map(v => ({
            model: v.model,
            vote: v.vote,
            confidence: v.confidence,
            reasoning: v.reasoning,
            concerns: v.concerns,
          })) ?? [],
          critique: decision.critique ? {
            assessment: decision.critique.overallAssessment,
            confidence: decision.critique.critiqueConfidence,
            issues: decision.critique.issues?.length ?? 0,
            strengths: decision.critique.strengths ?? [],
            missingRisks: decision.critique.missingRisks ?? [],
          } : null,
          consensusReached: decision.consensusReached ?? false,
          outstandingIssues: decision.outstandingIssues ?? [],
          estimatedCost: decision.estimatedCost ?? null,
          timing: decision.timing ?? null,
        },
      },
      decision.confidence,
      true // needs human review
    );

    if (this.config.notifyOnGeneration && this.gchatService) {
      await this.sendPrdNotification(prd.id, generatedPrd);
    }

    // Export to Google Docs if configured
    const googleDocsUrl = await this.exportPrdToGoogleDocs(prd.id, generatedPrd, meetingId);

    logger.info('PRD created for review', {
      prdId: prd.id,
      confidence: decision.confidence,
      iterations,
      outstandingIssues: decision.outstandingIssues.length,
      googleDocsUrl,
    });

    return {
      taskId,
      prd: { id: prd.id, title: prd.title, status: 'review', googleDocsUrl },
      confidence: decision.confidence,
      needsClarification: false,
      councilDecision: decision.decision,
      revisionIterations: iterations,
      outstandingIssues: decision.outstandingIssues,
    };
  }

  /**
   * Handle council decision that needs human clarification.
   */
  private async handleCouncilClarification(
    taskId: string,
    tenantId: string,
    meetingId: string,
    decision: CouncilDecision
  ): Promise<ProcessResult> {
    const questions = decision.clarificationQuestions.length > 0
      ? decision.clarificationQuestions
      : this.generateClarificationQuestions(decision.prd);

    const clarification = await this.taskRepository.createClarificationRequest(
      taskId,
      {
        question: questions[0],
        context: `PRD: ${decision.prd.title}\nCouncil Decision: ${decision.decision}\nConfidence: ${decision.confidence}\nIssues: ${decision.outstandingIssues.join('; ')}`,
        options: [],
        routeTo: 'product_lead',
        urgency: 'medium',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }
    );

    // Always create in-app notification so clarifications are visible on the UI
    await this.createClarificationNotification(tenantId, clarification.id, questions, decision.prd.title);

    // Also try to send via Google Chat if configured
    if (this.gchatService) {
      await this.gchatService.sendClarificationRequest(
        { id: clarification.id, text: questions[0], context: decision.prd.title },
        questions.slice(1),
        `${config.PUBLIC_URL || ''}/api/agents/clarifications/${clarification.id}/respond`
      ).catch(err => {
        logger.warn('Failed to send clarification via GChat, in-app notification still created', {
          error: (err as Error).message,
        });
      });
    }

    logger.info('Clarification requested by council', {
      taskId,
      questionCount: questions.length,
      notifiedInApp: true,
      notifiedGChat: !!this.gchatService,
    });

    return {
      taskId,
      confidence: decision.confidence,
      needsClarification: true,
      clarificationQuestions: questions,
      councilDecision: decision.decision,
      outstandingIssues: decision.outstandingIssues,
    };
  }

  /**
   * Fallback: Process with Gemini only (no council).
   */
  private async processWithGeminiOnly(
    taskId: string,
    tenantId: string,
    meetingId: string,
    transcript: string,
    options: GeneratePRDOptions
  ): Promise<ProcessResult> {
    const generatedPrd = await this.geminiService.generatePRD(transcript, options);

    logger.info('PRD generated (Gemini only)', {
      taskId,
      title: generatedPrd.title,
      confidence: generatedPrd.confidence,
      userStoriesCount: generatedPrd.userStories.length,
      functionalReqsCount: generatedPrd.functionalRequirements.length,
    });

    if (generatedPrd.confidence < this.config.clarificationThreshold) {
      return await this.handleLowConfidence(taskId, tenantId, meetingId, generatedPrd);
    }

    // Transform new PRD format to database format
    const dbFormat = transformPRDForDatabase(generatedPrd);

    const prd = await this.prdRepository.createPRD({
      taskId,
      meetingId,
      tenantId,
      title: generatedPrd.title,
      summary: dbFormat.summary,
      objectives: dbFormat.objectives,
      requirements: dbFormat.requirements,
      acceptanceCriteria: dbFormat.acceptanceCriteria,
      outOfScope: dbFormat.outOfScope,
      assumptions: generatedPrd.assumptions,
      risks: mapRisks(generatedPrd.risks),
      timeline: dbFormat.timeline,
      confidence: generatedPrd.confidence,
    });

    const status = generatedPrd.confidence >= this.config.autoApproveThreshold
      ? 'approved'
      : 'review';

    await this.prdRepository.updateStatus(prd.id, status);

    await this.taskRepository.completeTask(
      taskId,
      { type: 'prd', prdId: prd.id },
      generatedPrd.confidence,
      status === 'review'
    );

    if (this.config.notifyOnGeneration && this.gchatService) {
      await this.sendPrdNotification(prd.id, generatedPrd);
    }

    // Export to Google Docs if configured
    const googleDocsUrl = await this.exportPrdToGoogleDocs(prd.id, generatedPrd, meetingId);

    logger.info('PRD created (Gemini only)', {
      prdId: prd.id,
      status,
      confidence: generatedPrd.confidence,
      googleDocsUrl,
    });

    return {
      taskId,
      prd: { id: prd.id, title: prd.title, status, googleDocsUrl },
      confidence: generatedPrd.confidence,
      needsClarification: false,
    };
  }

  /**
   * Handle low confidence - request clarification.
   */
  private async handleLowConfidence(
    taskId: string,
    tenantId: string,
    meetingId: string,
    generatedPrd: GeneratedPRD
  ): Promise<ProcessResult> {
    logger.info('Low confidence, requesting clarification', {
      taskId,
      confidence: generatedPrd.confidence,
    });

    // Generate clarification questions
    const questions = this.generateClarificationQuestions(generatedPrd);

    // Create clarification request
    const clarification = await this.taskRepository.createClarificationRequest(
      taskId,
      {
        question: questions[0], // Primary question
        context: `PRD: ${generatedPrd.title}\nConfidence: ${generatedPrd.confidence}\nReasoning: ${generatedPrd.reasoning}`,
        options: [], // Could provide options based on the question
        routeTo: 'product_lead', // Route to product lead for clarification
        urgency: 'medium',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      }
    );

    // Always create in-app notification so clarifications are visible on the UI
    await this.createClarificationNotification(tenantId, clarification.id, questions, generatedPrd.title);

    // Also try to send via Google Chat if configured
    if (this.gchatService) {
      await this.gchatService.sendClarificationRequest(
        {
          id: clarification.id,
          text: questions[0],
          context: generatedPrd.title,
        },
        questions.slice(1),
        `${config.PUBLIC_URL || ''}/api/agents/clarifications/${clarification.id}/respond`
      ).catch(err => {
        logger.warn('Failed to send clarification via GChat, in-app notification still created', {
          error: (err as Error).message,
        });
      });
    }

    return {
      taskId,
      confidence: generatedPrd.confidence,
      needsClarification: true,
      clarificationQuestions: questions,
    };
  }

  /**
   * Generate clarification questions based on PRD analysis.
   */
  private generateClarificationQuestions(prd: GeneratedPRD): string[] {
    const questions: string[] = [];

    // Check for missing critical information
    if (prd.goals.objectives.length === 0) {
      questions.push('What are the main business objectives for this feature?');
    }

    if (prd.userStories.length === 0 && prd.functionalRequirements.length === 0) {
      questions.push('What are the key requirements for this feature?');
    }

    // Check for ambiguous user stories
    const ambiguousStories = prd.userStories.filter(
      (s) => s.acceptanceCriteria.length === 0 || s.priority === 'nice-to-have'
    );
    if (ambiguousStories.length > 0) {
      questions.push(
        `Could you clarify the acceptance criteria for: ${ambiguousStories[0].story.substring(0, 50)}...?`
      );
    }

    // Add reasoning-based question if available
    if (prd.reasoning && prd.reasoning.toLowerCase().includes('unclear')) {
      questions.push('Some parts of the discussion were unclear. Could you provide more details on the core functionality?');
    }

    // Ensure at least one question
    if (questions.length === 0) {
      questions.push('Could you confirm the priority order of the requirements discussed?');
    }

    return questions.slice(0, this.config.maxClarifyingQuestions);
  }

  /**
   * Handle a clarification response and continue processing.
   *
   * @param clarificationId - Clarification request ID
   * @param response - User's response
   * @returns Updated processing result
   */
  async handleClarificationResponse(
    clarificationId: string,
    response: string,
    userId?: string
  ): Promise<ProcessResult> {
    logger.info('Handling clarification response', { clarificationId });

    // Get clarification and associated task
    const clarification = await this.taskRepository.answerClarification(
      clarificationId,
      response,
      userId || 'system'
    );

    // Get the original task. N6b made taskId nullable (clarifications
    // can now originate from a Ticket without an AgentTask); this
    // legacy BA flow still needs a task, so bail clearly if the row is
    // ticket-only.
    if (!clarification.taskId) {
      throw new AppError(
        'Clarification is ticket-scoped; legacy BA flow cannot resume it',
        409,
        'WRONG_FLOW',
      );
    }
    const task = await this.taskRepository.findByIdWithClarifications(clarification.taskId);
    if (!task) {
      throw new AppError('Task not found', 404, 'NOT_FOUND');
    }

    // Get original transcript from meeting
    const meeting = await this.meetingRepository.findByIdWithTranscript(task.meetingId!);
    if (!meeting?.transcript) {
      throw new AppError('Meeting transcript not found', 404, 'NOT_FOUND');
    }

    // Re-process with additional context from clarification
    return this.processMeetingTranscript(
      task.id,
      task.tenantId,
      task.meetingId!,
      (meeting.transcript as unknown as { fullText: string }).fullText,
      {
        additionalContext: `Clarification provided:\nQ: ${clarification.question}\nA: ${response}`,
      }
    );
  }

  /**
   * Create Jira tickets from an approved PRD.
   *
   * @param prdId - PRD ID
   * @param projectKey - Jira project key
   * @param options - Additional options
   * @returns Bulk create result
   */
  async createJiraTickets(
    prdId: string,
    projectKey: string,
    options: { epicKey?: string } = {}
  ): Promise<BulkCreateResult> {
    if (!this.jiraService) {
      throw new AppError('Jira integration not configured', 400, 'JIRA_NOT_CONFIGURED');
    }

    logger.info('Creating Jira tickets from PRD', { prdId, projectKey });

    // Get PRD
    const prd = await this.prdRepository.findByIdWithTickets(prdId);
    if (!prd) {
      throw new AppError('PRD not found', 404, 'NOT_FOUND');
    }

    if (prd.status !== 'approved') {
      throw new AppError('PRD must be approved before creating tickets', 400, 'INVALID_STATUS');
    }

    // Convert requirements to Jira issues
    const requirements = prd.requirements as Array<{
      id: string;
      title: string;
      description: string;
      priority: string;
      type: string;
      acceptanceCriteria: string[];
      estimatedEffort?: string;
    }>;

    const issueInputs: CreateIssueInput[] = requirements.map((req) => ({
      projectKey,
      issueType: this.mapRequirementTypeToIssueType(req.type),
      summary: req.title,
      description: this.formatDescription(req),
      priority: this.mapPriorityToJira(req.priority),
      labels: ['workforce-ai', 'prd-generated'],
      acceptanceCriteria: req.acceptanceCriteria.join('\n'),
      storyPoints: this.estimateStoryPoints(req.estimatedEffort),
      epicKey: options.epicKey,
    }));

    // Create tickets via Jira
    const result = await this.jiraService.bulkCreateIssues(issueInputs);

    // Store ticket records in our DB
    if (result.created.length > 0) {
      const ticketRecords = result.created.map((created, index) => ({
        projectKey,
        issueType: issueInputs[index].issueType,
        summary: issueInputs[index].summary,
        description: issueInputs[index].description,
        priority: issueInputs[index].priority || 'Medium',
        labels: issueInputs[index].labels || [],
        externalKey: created.key,
      }));

      await this.prdRepository.createTickets(prdId, ticketRecords);
    }

    logger.info('Jira tickets created', {
      prdId,
      created: result.created.length,
      failed: result.failed.length,
    });

    return result;
  }

  /**
   * Send PRD notification via Google Chat.
   */
  private async sendPrdNotification(prdId: string, prd: GeneratedPRD): Promise<void> {
    if (!this.gchatService) return;

    try {
      await this.gchatService.sendPRDNotification(
        {
          title: prd.title,
          summary: prd.executiveSummary.overview.substring(0, 500),
          confidence: prd.confidence,
          requirementsCount: prd.userStories.length + prd.functionalRequirements.length,
        },
        {
          viewUrl: `${config.PUBLIC_URL || ''}/prds/${prdId}`,
          approveUrl: `${config.PUBLIC_URL || ''}/api/agents/prds/${prdId}/approve`,
          rejectUrl: `${config.PUBLIC_URL || ''}/api/agents/prds/${prdId}/reject`,
        }
      );
    } catch (error) {
      logger.warn('Failed to send PRD notification', {
        prdId,
        error: (error as Error).message,
      });
      // Don't throw - notification failure shouldn't fail the whole process
    }
  }

  /**
   * Export PRD to Google Docs (if configured).
   *
   * Converts the GeneratedPRD to a formatted executive-quality document.
   *
   * @param prdId - PRD ID in database
   * @param prd - Generated PRD content (new executive format)
   * @param meetingId - Optional meeting ID for metadata
   * @returns Document URL or null if not exported
   */
  private async exportPrdToGoogleDocs(
    prdId: string,
    prd: GeneratedPRD,
    meetingId?: string
  ): Promise<string | null> {
    if (!this.googleDocsService?.isAvailable()) {
      logger.debug('Google Docs export skipped (not configured)');
      return null;
    }

    try {
      // Get meeting info for context
      let meetingTitle: string | undefined;
      let meetingDate: string | undefined;

      if (meetingId) {
        const meeting = await this.meetingRepository.findById(meetingId);
        if (meeting) {
          meetingTitle = meeting.title;
          meetingDate = meeting.startTime?.toISOString();
        }
      }

      // Build export content - PRD now matches PRDExportContent structure
      const exportContent: PRDExportContent = {
        metadata: {
          version: prd.metadata.version,
          generatedAt: prd.metadata.generatedAt,
          meetingDate: meetingDate || prd.metadata.meetingDate,
          participants: prd.metadata.participants,
        },
        title: prd.title,
        executiveSummary: prd.executiveSummary,
        problemStatement: prd.problemStatement,
        goals: prd.goals,
        scope: prd.scope,
        userStories: prd.userStories,
        functionalRequirements: prd.functionalRequirements,
        nonFunctionalRequirements: prd.nonFunctionalRequirements,
        successMetrics: prd.successMetrics,
        risks: prd.risks,
        assumptions: prd.assumptions,
        openQuestions: prd.openQuestions,
        timeline: prd.timeline,
        confidence: prd.confidence,
        reasoning: prd.reasoning,
      };

      const result = await this.googleDocsService.createPRDDocument(exportContent);

      logger.info('PRD exported to Google Docs', {
        prdId,
        documentId: result.documentId,
        documentUrl: result.documentUrl,
      });

      // Update PRD with Google Docs info
      await this.prdRepository.update(prdId, {
        googleDocId: result.documentId,
        googleDocUrl: result.documentUrl,
      });

      return result.documentUrl;
    } catch (error) {
      logger.error('Failed to export PRD to Google Docs', {
        prdId,
        error: (error as Error).message,
      });
      // Don't throw - export failure shouldn't fail the whole process
      return null;
    }
  }

  /**
   * Map requirement type to Jira issue type.
   */
  private mapRequirementTypeToIssueType(type: string): string {
    const mapping: Record<string, string> = {
      functional: 'Story',
      non_functional: 'Task',
      technical: 'Task',
      business: 'Story',
    };
    return mapping[type] || 'Task';
  }

  /**
   * Map priority to Jira format.
   */
  private mapPriorityToJira(priority: string): string {
    const mapping: Record<string, string> = {
      'must-have': 'Highest',
      'should-have': 'High',
      'nice-to-have': 'Medium',
      'future': 'Low',
      critical: 'Highest',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    };
    return mapping[priority] || 'Medium';
  }

  /**
   * Estimate story points from effort description.
   */
  private estimateStoryPoints(effort?: string): number | undefined {
    if (!effort) return undefined;

    const mapping: Record<string, number> = {
      trivial: 1,
      small: 2,
      medium: 5,
      large: 13,
      epic: 21,
    };
    return mapping[effort];
  }

  /**
   * Format requirement description for Jira.
   */
  private formatDescription(req: {
    description: string;
    acceptanceCriteria: string[];
  }): string {
    let description = req.description;

    if (req.acceptanceCriteria.length > 0) {
      description += '\n\n*Acceptance Criteria:*\n';
      description += req.acceptanceCriteria.map((ac) => `- ${ac}`).join('\n');
    }

    return description;
  }

  // ==========================================================================
  // CLARIFICATION LOOP - Google Chat Integration
  // ==========================================================================

  /**
   * Process clarification responses received from Google Chat webhook.
   *
   * This method is called when stakeholders reply to clarification questions
   * in Google Chat. It stores the answers, checks if all questions are
   * answered, and regenerates the PRD if complete.
   *
   * Flow:
   * 1. Receive answers from webhook handler
   * 2. Find the PRD associated with this clarification thread
   * 3. Store the answers
   * 4. If all questions answered → regenerate PRD
   * 5. Update Google Doc
   * 6. Notify via Google Chat
   *
   * @param request - Clarification response from webhook
   * @returns Processing result
   *
   * @example
   * ```typescript
   * await baAgent.processClarificationResponse({
   *   prdId: 'prd-123',
   *   threadKey: 'prd-clarify-prd-123',
   *   answers: [
   *     { questionId: 'Q1', answer: 'Use OAuth2 with JWT tokens' },
   *     { questionId: 'Q2', answer: 'Target 200ms response time' },
   *   ],
   *   respondent: 'pm@company.com',
   * });
   * ```
   */
  async processClarificationResponse(request: {
    prdId: string;
    threadKey: string;
    answers: Array<{ questionId: string; answer: string }>;
    respondent: string;
  }): Promise<{
    success: boolean;
    allQuestionsAnswered: boolean;
    regenerated: boolean;
    newPrdId?: string;
    documentUrl?: string;
  }> {
    logger.info('Processing clarification response', {
      prdId: request.prdId,
      answerCount: request.answers.length,
      respondent: request.respondent,
    });

    try {
      // 1. Get the PRD
      const prd = await this.prdRepository.findByIdWithTickets(request.prdId);
      if (!prd) {
        logger.warn('PRD not found for clarification response', { prdId: request.prdId });
        return { success: false, allQuestionsAnswered: false, regenerated: false };
      }

      // 2. Get the original task and meeting
      const task = await this.taskRepository.findById(prd.taskId);
      if (!task) {
        logger.warn('Task not found for PRD', { prdId: request.prdId, taskId: prd.taskId });
        return { success: false, allQuestionsAnswered: false, regenerated: false };
      }

      const meeting = await this.meetingRepository.findByIdWithTranscript(prd.meetingId);
      if (!meeting?.transcript) {
        logger.warn('Meeting transcript not found', { meetingId: prd.meetingId });
        return { success: false, allQuestionsAnswered: false, regenerated: false };
      }

      // 3. Build additional context from answers
      const answersContext = request.answers
        .map((a) => `${a.questionId}: ${a.answer}`)
        .join('\n\n');

      const additionalContext = `
CLARIFICATION ANSWERS PROVIDED BY STAKEHOLDERS:
Respondent: ${request.respondent}
Date: ${new Date().toISOString()}

${answersContext}

Please incorporate these answers into the PRD. Update any sections that were
unclear or had open questions based on this feedback.
`;

      // 4. Send acknowledgment via Google Chat
      if (this.gchatService) {
        await this.gchatService.sendClarificationReceived({
          prdId: request.prdId,
          threadKey: request.threadKey,
          answeredQuestions: request.answers.map((a) => ({ id: a.questionId, answer: a.answer })),
          remainingQuestions: 0, // We'll update this after regeneration
        });
      }

      // 5. Regenerate PRD with clarification context
      const transcript = (meeting.transcript as unknown as { fullText: string }).fullText;

      logger.info('Regenerating PRD with clarification answers', {
        prdId: request.prdId,
        taskId: task.id,
      });

      // Use the council if available for regeneration
      let newPrd: GeneratedPRD;
      if (this.config.useCouncil && this.aiCouncil) {
        const decision = await this.aiCouncil.generatePRDWithCouncil(transcript, {
          additionalContext,
          maxRevisions: 1, // Single revision with clarification
        } as any);
        newPrd = decision.prd;
      } else {
        newPrd = await this.geminiService.generatePRD(transcript, {
          additionalContext,
        });
      }

      // 6. Check if there are still open questions
      const hasMoreQuestions = newPrd.openQuestions && newPrd.openQuestions.length > 0;

      // 7. Update the PRD in database
      const dbFormat = transformPRDForDatabase(newPrd);
      await this.prdRepository.update(request.prdId, {
        summary: dbFormat.summary,
        objectives: dbFormat.objectives,
        requirements: dbFormat.requirements as any,
        acceptanceCriteria: dbFormat.acceptanceCriteria,
        outOfScope: dbFormat.outOfScope,
        assumptions: newPrd.assumptions,
        risks: mapRisks(newPrd.risks) as any,
        timeline: dbFormat.timeline,
        confidence: newPrd.confidence,
        status: hasMoreQuestions ? 'needs_clarification' : (newPrd.confidence >= this.config.autoApproveThreshold ? 'approved' : 'review'),
      });

      // 8. Update Google Doc if exists
      let documentUrl: string | null = null;
      const existingDocUrl = ((prd as any).metadata as any)?.googleDocsUrl;

      if (this.googleDocsService?.isAvailable()) {
        // Create a new version of the document
        documentUrl = await this.exportPrdToGoogleDocs(request.prdId, newPrd, prd.meetingId);
      }

      // 9. Notify completion via Google Chat
      if (this.gchatService) {
        if (hasMoreQuestions) {
          // Send new questions
          await this.gchatService.sendClarificationQuestions({
            prdId: request.prdId,
            title: newPrd.title,
            questions: newPrd.openQuestions.map((q, i) => ({ id: `Q${i + 1}`, text: q })),
            documentUrl: documentUrl || existingDocUrl,
            confidence: newPrd.confidence,
          });
        } else {
          // Send completion notification
          await this.gchatService.sendPRDUpdated({
            prdId: request.prdId,
            threadKey: request.threadKey,
            title: newPrd.title,
            documentUrl: documentUrl || existingDocUrl,
            newConfidence: newPrd.confidence,
            hasMoreQuestions: false,
          });
        }
      }

      logger.info('Clarification response processed successfully', {
        prdId: request.prdId,
        newConfidence: newPrd.confidence,
        hasMoreQuestions,
        documentUrl,
      });

      return {
        success: true,
        allQuestionsAnswered: !hasMoreQuestions,
        regenerated: true,
        newPrdId: request.prdId,
        documentUrl: documentUrl || undefined,
      };

    } catch (error) {
      logger.error('Failed to process clarification response', {
        prdId: request.prdId,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });

      // Notify error via Google Chat
      if (this.gchatService) {
        await this.gchatService.sendErrorNotification(
          { message: `Failed to process clarification: ${(error as Error).message}` },
          { taskId: request.prdId }
        );
      }

      return { success: false, allQuestionsAnswered: false, regenerated: false };
    }
  }

  /**
   * Send clarification questions for a PRD via Google Chat.
   *
   * Call this when a PRD has open questions that need stakeholder input.
   *
   * @param prdId - PRD ID
   * @param questions - Questions to ask
   * @param documentUrl - Optional Google Docs URL
   * @returns Thread key for tracking responses
   */
  async sendClarificationQuestions(
    prdId: string,
    questions: string[],
    documentUrl?: string
  ): Promise<string | null> {
    const prd = await this.prdRepository.findById(prdId);
    if (!prd) {
      logger.warn('PRD not found for sending clarification', { prdId });
      return null;
    }

    // Always create in-app notification so clarifications are visible on the UI
    await this.createClarificationNotification(prd.tenantId, prdId, questions, prd.title);

    // Try Google Chat if configured
    let threadKey: string | null = null;
    if (this.gchatService?.isEnabled()) {
      threadKey = await this.gchatService.sendClarificationQuestions({
        prdId,
        title: prd.title,
        questions: questions.map((q, i) => ({ id: `Q${i + 1}`, text: q })),
        documentUrl,
        confidence: prd.confidence,
      });
    }

    // Update PRD status to indicate clarification is pending
    await this.prdRepository.updateStatus(prdId, 'needs_clarification');

    logger.info('Clarification questions sent', {
      prdId,
      questionCount: questions.length,
      threadKey,
      notifiedInApp: true,
      notifiedGChat: !!threadKey,
    });

    return threadKey;
  }

  /**
   * Create an in-app notification for clarification questions.
   * This ensures the user always sees pending clarifications on the dashboard,
   * even if external channels (GChat, Slack, etc.) are not configured.
   */
  private async createClarificationNotification(
    tenantId: string,
    referenceId: string,
    questions: string[],
    prdTitle: string
  ): Promise<void> {
    if (!this.prisma) {
      logger.debug('Prisma not available, skipping in-app notification');
      return;
    }

    try {
      await this.prisma.notification.create({
        data: {
          tenantId,
          channel: 'in_app',
          type: 'clarification',
          title: `Clarification needed: ${prdTitle}`,
          message: questions.join('\n\n'),
          metadata: {
            referenceId,
            referenceType: 'clarification',
            prdTitle,
            questionCount: questions.length,
            questions,
          },
          status: 'pending',
        },
      });
      logger.debug('In-app clarification notification created', { tenantId, referenceId });
    } catch (err) {
      logger.warn('Failed to create in-app notification', { error: (err as Error).message });
    }
  }
}
