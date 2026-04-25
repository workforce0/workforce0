// mvp/src/services/agents/ba/ba.agent.ts

import { BaseConsultant } from '../base-consultant.js';
import type {
  AgentRunResult,
  ModelClient,
} from '../../agent-runtime/types.js';
import type { CommunicationRouter } from '../../communication/router.js';
import type { MemoryService } from '../../memory/memory.service.js';
import type { ModelRegistryService } from '../../model-registry/model-registry.service.js';
import type { SkillLoader } from '../skills/loader.js';
import type { LibraryService } from '../../library/library.service.js';
import { createBATools } from './tools.js';
import { BA_SYSTEM_PROMPT } from './prompts.js';

/**
 * BAAgent — Business Analyst Agent (Agent Loop pattern)
 *
 * Transforms meeting transcripts into structured PRDs using the AgentLoop.
 * Leverages tenant memory for context, checks for duplicate backlog items,
 * and asks role-based clarifications when confidence is low.
 *
 * This is the new implementation that replaces the legacy ba-agent.service.ts.
 * The old service is kept for backward compatibility.
 */
export class BAAgent extends BaseConsultant {
  readonly agentType = 'ba_agent' as const;

  constructor(
    modelClient: ModelClient,
    private prisma: any,
    private commsRouter: CommunicationRouter,
    private memoryService: MemoryService,
    modelRegistry?: ModelRegistryService,
    skillLoader?: SkillLoader,
    /** M7.7: LibraryService — when present together with a ticketId
     *  in AgentContext, the base class prepends the active skills
     *  preamble to the system prompt. Optional so existing tests and
     *  bootstrap paths keep working. */
    libraryService?: LibraryService,
  ) {
    super(
      modelClient,
      modelRegistry,
      {
        agentType: 'ba_agent',
        rolePrompt: BA_SYSTEM_PROMPT,
        roleSkillTargets: ['all', 'ba'],
        tools: createBATools({ prisma, commsRouter, memoryService }),
        maxSteps: 25,
        confidenceThreshold: 0.85,
        defaultModel: { provider: 'google', modelId: 'gemini-3.1-pro' },
      },
      skillLoader,
      undefined, // pipeline — unchanged
      libraryService,
      prisma, // M7.7: also a source of the ticket lookup
    );
  }

  /**
   * Process a meeting transcript and produce a PRD.
   *
   * The agent will:
   * 1. Read the transcript
   * 2. Recall tenant preferences/conventions from memory
   * 3. Check existing backlog for duplicates
   * 4. Extract requirements and create a PRD
   * 5. Ask clarifications if confidence is low
   *
   * @param tenantId      - Tenant context
   * @param meetingId      - Source meeting
   * @param engagementId   - Parent engagement
   * @param taskId         - AgentTask tracking this work
   */
  async processTranscript(
    tenantId: string,
    meetingId: string,
    engagementId: string,
    taskId: string,
  ): Promise<AgentRunResult> {
    const task = [
      'Process the meeting transcript and create a comprehensive PRD.',
      '',
      'Follow the process defined in your instructions:',
      '1. Read the transcript thoroughly',
      '2. Recall tenant preferences and conventions from memory',
      '3. Check existing backlog for duplicates or related PRDs',
      '4. Extract requirements with priorities (P0/P1/P2) and acceptance criteria',
      '5. Create the PRD document',
      '6. Ask clarifications for any requirement where confidence < 70%',
      '',
      'Be thorough and precise. Flag ambiguities and conflicts.',
    ].join('\n');

    return this.runLoop(task, {
      tenantId,
      engagementId,
      agentType: this.agentType,
      traceId: `ba-transcript-${meetingId}-${Date.now()}`,
      memory: {
        meetingId,
        taskId,
      },
    });
  }
}
