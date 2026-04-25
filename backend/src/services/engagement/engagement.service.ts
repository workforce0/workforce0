/**
 * =============================================================================
 * ENGAGEMENT SERVICE
 * =============================================================================
 *
 * Manages the engagement lifecycle through an 8-phase state machine:
 * listen → understand → analyze_ask → approve → build → test → ship → learn
 *
 * Each phase maps to a responsible agent (or null for human-driven phases).
 * Transitions are validated against VALID_TRANSITIONS to prevent invalid jumps.
 * Confidence gating pauses engagements when confidence drops below 0.5.
 *
 * @module services/engagement
 */

import { createChildLogger } from '../../lib/logger.js';
import {
  type EngagementPhase,
  type EngagementStatus,
  PHASE_ORDER,
  PHASE_AGENT_MAP,
  VALID_TRANSITIONS,
} from './engagement.types.js';

/** Minimal queue service interface for dispatching agent jobs */
interface QueueServiceLike {
  addJob(jobType: string, data: unknown, options?: { priority?: number; delay?: number }): Promise<string>;
}

const logger = createChildLogger({ service: 'EngagementService' });

/** Minimum confidence required to advance (below this, engagement is paused). */
const CONFIDENCE_THRESHOLD = 0.5;

export interface CreateEngagementInput {
  title: string;
  meetingId?: string;
  metadata?: Record<string, unknown>;
}

export interface AdvancePhaseInput {
  confidence?: number;
  targetPhase?: EngagementPhase;
  output?: Record<string, unknown>;
}

export class EngagementService {
  private prisma: any;
  private queueService: QueueServiceLike | null;

  constructor(prisma: any, queueService?: QueueServiceLike) {
    this.prisma = prisma;
    this.queueService = queueService ?? null;
  }

  /** Attach queue service after construction (for DI circular ref avoidance) */
  setQueueService(queueService: QueueServiceLike): void {
    this.queueService = queueService;
  }

  /**
   * Create a new engagement starting in the 'listen' phase.
   */
  async create(tenantId: string, input: CreateEngagementInput) {
    logger.info({ tenantId, title: input.title }, 'Creating engagement');

    const engagement = await this.prisma.engagement.create({
      data: {
        tenantId,
        title: input.title,
        meetingId: input.meetingId ?? null,
        phase: 'listen',
        status: 'active',
        confidence: 0,
        agentType: PHASE_AGENT_MAP['listen'],
        metadata: input.metadata ?? null,
      },
    });

    logger.info({ engagementId: engagement.id, phase: 'listen' }, 'Engagement created');
    return engagement;
  }

  /**
   * Advance the engagement to the next phase.
   *
   * Rules:
   * - If a targetPhase is specified, validates it against VALID_TRANSITIONS.
   * - If no targetPhase, advances to the next phase in PHASE_ORDER.
   * - If confidence < CONFIDENCE_THRESHOLD, pauses instead of advancing.
   * - Engagement must be active to advance.
   */
  async advancePhase(tenantId: string, engagementId: string, input: AdvancePhaseInput) {
    const engagement = await this.prisma.engagement.findFirst({
      where: { id: engagementId, tenantId },
    });

    if (!engagement) {
      throw new Error('Engagement not found');
    }

    if (engagement.status !== 'active') {
      throw new Error(`Engagement is ${engagement.status}, cannot advance`);
    }

    const currentPhase = engagement.phase as EngagementPhase;
    const confidence = input.confidence ?? engagement.confidence;

    // Determine target phase
    const targetPhase = input.targetPhase ?? this.getNextPhase(currentPhase);

    // Validate the transition before anything else
    const validTransition = VALID_TRANSITIONS.find(
      (t) => t.from === currentPhase && t.to === targetPhase,
    );

    if (!validTransition) {
      throw new Error(
        `Invalid transition from '${currentPhase}' to '${targetPhase}'`,
      );
    }

    // If confidence is below threshold, pause the engagement instead of advancing
    if (confidence < CONFIDENCE_THRESHOLD) {
      logger.warn(
        { engagementId, phase: currentPhase, confidence },
        'Confidence below threshold, pausing engagement',
      );
      const result = await this.prisma.engagement.updateMany({
        where: { id: engagementId, tenantId },
        data: {
          status: 'paused' as EngagementStatus,
          confidence,
        },
      });
      if (result.count === 0) {
        throw new Error('Engagement not found');
      }
      return { ...engagement, status: 'paused' as EngagementStatus, confidence };
    }

    logger.info(
      { engagementId, from: currentPhase, to: targetPhase, condition: validTransition.condition },
      'Advancing engagement phase',
    );

    const result = await this.prisma.engagement.updateMany({
      where: { id: engagementId, tenantId },
      data: {
        phase: targetPhase,
        confidence,
        agentType: PHASE_AGENT_MAP[targetPhase],
        output: input.output ?? null,
      },
    });

    if (result.count === 0) {
      throw new Error('Engagement not found');
    }

    const updated = {
      ...engagement,
      phase: targetPhase,
      confidence,
      agentType: PHASE_AGENT_MAP[targetPhase],
      output: input.output ?? null,
    };

    // Auto-dispatch agent for the new phase (if one is assigned)
    const agentType = PHASE_AGENT_MAP[targetPhase];
    if (agentType && this.queueService) {
      try {
        await this.dispatchAgentForPhase(tenantId, engagementId, targetPhase, agentType, input.output);
      } catch (err) {
        logger.error(
          { engagementId, phase: targetPhase, agentType, error: (err as Error).message },
          'Failed to dispatch agent for phase (non-fatal)',
        );
      }
    }

    return updated;
  }

  /**
   * Dispatch the appropriate agent job for an engagement phase.
   */
  private async dispatchAgentForPhase(
    tenantId: string,
    engagementId: string,
    phase: EngagementPhase,
    agentType: string,
    output?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.queueService) return;

    logger.info({ engagementId, phase, agentType }, 'Dispatching agent for phase');

    // Map agent types to job types
    switch (agentType) {
      case 'dev_agent': {
        const prdId = output?.prdId as string;
        // The route that triggers PRD approval now mints a dev_agent
        // ticket+AgentTask and passes their IDs through output (see
        // routes/agents.routes.ts approve handler). Forward both to the
        // DEV_AGENT_PROCESS handler so it doesn't fall back to
        // tix_legacy_<empty-taskId> and fail downstream prisma updates.
        // We pass `undefined` (not `''`) when missing so the handler's
        // `?? \`tix_legacy_${taskId}\`` fallback actually triggers — an
        // empty string is truthy enough to defeat `??`.
        const taskId = (output?.taskId as string) || undefined;
        const ticketId = (output?.ticketId as string) || undefined;
        if (prdId) {
          await this.queueService.addJob('dev_agent_process', {
            prdId,
            engagementId,
            tenantId,
            taskId,
            ticketId,
          });
        }
        break;
      }
      case 'qa_agent': {
        const prNumber = output?.prNumber as number;
        const prdId = output?.prdId as string;
        if (prNumber && prdId) {
          await this.queueService.addJob('qa_agent_process', {
            prdId,
            prNumber,
            engagementId,
            tenantId,
            taskId: '',
          });
        }
        break;
      }
      case 'memory_optimizer': {
        await this.queueService.addJob('memory_optimizer', {
          tenantId,
          trigger: 'engagement_complete',
          engagementId,
        });
        break;
      }
      // ba_agent and meeting_brain are dispatched elsewhere (meeting processor)
      default:
        logger.debug({ agentType, phase }, 'No auto-dispatch for this agent type');
    }
  }

  /**
   * Get the next phase in the ordered lifecycle.
   */
  private getNextPhase(currentPhase: EngagementPhase): EngagementPhase {
    const currentIndex = PHASE_ORDER.indexOf(currentPhase);
    const nextIndex = (currentIndex + 1) % PHASE_ORDER.length;
    return PHASE_ORDER[nextIndex];
  }

  /**
   * Get a single engagement by ID.
   */
  async get(engagementId: string) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });

    if (!engagement) {
      throw new Error('Engagement not found');
    }

    return engagement;
  }

  /**
   * List engagements for a tenant, optionally filtered by status.
   */
  async listByTenant(tenantId: string, status?: EngagementStatus, projectId?: string | null) {
    const where: Record<string, unknown> = { tenantId };
    if (status) {
      where.status = status;
    }
    if (projectId) {
      where.projectId = projectId;
    }

    return this.prisma.engagement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Pause an engagement.
   */
  async pause(tenantId: string, engagementId: string, reason?: string) {
    logger.info({ engagementId, reason }, 'Pausing engagement');

    const result = await this.prisma.engagement.updateMany({
      where: { id: engagementId, tenantId },
      data: {
        status: 'paused' as EngagementStatus,
        metadata: reason ? { pauseReason: reason } : undefined,
      },
    });

    if (result.count === 0) {
      throw new Error('Engagement not found');
    }

    return { id: engagementId, status: 'paused' as EngagementStatus };
  }

  /**
   * Resume a paused engagement.
   */
  async resume(tenantId: string, engagementId: string) {
    logger.info({ engagementId }, 'Resuming engagement');

    const result = await this.prisma.engagement.updateMany({
      where: { id: engagementId, tenantId },
      data: {
        status: 'active' as EngagementStatus,
      },
    });

    if (result.count === 0) {
      throw new Error('Engagement not found');
    }

    return { id: engagementId, status: 'active' as EngagementStatus };
  }
}
