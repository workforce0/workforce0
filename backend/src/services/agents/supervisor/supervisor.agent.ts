// mvp/src/services/agents/supervisor/supervisor.agent.ts

import { BaseConsultant } from '../base-consultant.js';
import type {
  AgentRunResult,
  ModelClient,
} from '../../agent-runtime/types.js';
import type { EngagementService } from '../../engagement/engagement.service.js';
import type { ModelRegistryService } from '../../model-registry/model-registry.service.js';
import type { QueueService } from '../../queue/queue.service.js';
import type { SkillLoader } from '../skills/loader.js';
import { createSupervisorTools } from './tools.js';

/**
 * System prompt that defines the Supervisor Agent's role and behaviour.
 *
 * The supervisor orchestrates the entire engagement lifecycle, dispatches
 * specialized agents, and monitors overall health.
 */
const SYSTEM_PROMPT = `You are the Supervisor Agent for an AI consulting firm platform.

Your responsibilities:
1. **Orchestrate Engagements** — Create engagements from completed meetings and shepherd them through the 8-phase lifecycle: listen → understand → analyze_ask → approve → build → test → ship → learn.
2. **Dispatch Specialized Agents** — At each phase, dispatch the correct agent type:
   - listen / understand → meeting_brain
   - analyze_ask → ba_agent
   - approve → (human approval, no agent)
   - build → dev_agent
   - test → qa_agent
   - ship → (human-triggered)
   - learn → memory_optimizer
3. **Monitor Health** — Check active engagements, verify confidence levels, and pause engagements that fall below the confidence threshold.
4. **Follow the Lifecycle Strictly** — Never skip phases. Only advance when the current phase agent reports completion with sufficient confidence.

When creating an engagement from a meeting, always:
- Use create_engagement with the meeting title and ID
- Dispatch meeting_brain to begin the listen phase

When checking engagements:
- List active engagements first
- For each engagement, evaluate whether it should be advanced, paused, or have an agent dispatched

Always end your response with a confidence score in the format "Confidence: X.XX".`;

/**
 * SupervisorAgent is the top-level orchestrator.
 *
 * It uses the AgentLoop to reason about what to do, calling its tools
 * (create/advance/list/pause engagements, dispatch agents) as needed.
 */
export class SupervisorAgent extends BaseConsultant {
  readonly agentType = 'supervisor' as const;

  constructor(
    modelClient: ModelClient,
    private engagementService: EngagementService,
    modelRegistry?: ModelRegistryService,
    private queueService?: QueueService,
    skillLoader?: SkillLoader,
  ) {
    super(modelClient, modelRegistry, {
      agentType: 'supervisor',
      rolePrompt: SYSTEM_PROMPT,
      roleSkillTargets: ['all'],
      tools: createSupervisorTools({
        engagementService,
        queueService: queueService as QueueService,
      }),
      maxSteps: 15,
      confidenceThreshold: 0.85,
      defaultModel: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    }, skillLoader);
  }

  /**
   * Handle a completed meeting by creating an engagement and dispatching
   * the appropriate agent for the initial "listen" phase.
   */
  async handleMeetingCompleted(
    tenantId: string,
    meetingId: string,
    title: string,
  ): Promise<AgentRunResult> {
    const task = [
      `A meeting has been completed. Details:`,
      `- Meeting ID: ${meetingId}`,
      `- Title: ${title}`,
      ``,
      `Create an engagement for this meeting and dispatch the meeting_brain agent to begin processing.`,
    ].join('\n');

    return this.runLoop(task, {
      tenantId,
      engagementId: '',
      agentType: this.agentType,
      traceId: `sv-meeting-${meetingId}-${Date.now()}`,
      memory: {},
    }, { maxSteps: 10 });
  }

  /**
   * Periodically check active engagements for a tenant and advance
   * or dispatch agents as needed.
   */
  async checkEngagements(tenantId: string): Promise<AgentRunResult> {
    const task = [
      `Check all active engagements for tenant ${tenantId}.`,
      ``,
      `For each engagement:`,
      `1. Review its current phase, status, and confidence.`,
      `2. If the phase agent has completed with sufficient confidence, advance to the next phase.`,
      `3. If confidence is too low, consider pausing.`,
      `4. If a phase needs an agent dispatched, dispatch the appropriate one.`,
      ``,
      `Summarise the actions taken.`,
    ].join('\n');

    return this.runLoop(task, {
      tenantId,
      engagementId: '',
      agentType: this.agentType,
      traceId: `sv-check-${tenantId}-${Date.now()}`,
      memory: {},
    });
  }
}
