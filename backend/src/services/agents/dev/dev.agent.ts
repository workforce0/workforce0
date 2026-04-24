// mvp/src/services/agents/dev/dev.agent.ts

import { BaseConsultant } from '../base-consultant.js';
import type {
  AgentRunResult,
  ModelClient,
} from '../../agent-runtime/types.js';
import type { MemoryService } from '../../memory/memory.service.js';
import type { ModelRegistryService } from '../../model-registry/model-registry.service.js';
import type { SkillLoader } from '../skills/loader.js';
import type { LibraryService } from '../../library/library.service.js';
import { createDevTools } from './tools.js';
import { DEV_SYSTEM_PROMPT } from './prompts.js';

/**
 * DevAgent — Dev Agent (Agent Loop pattern)
 *
 * Implements approved PRDs by generating code, writing tests,
 * self-reviewing for quality, and creating pull requests for human review.
 *
 * Uses Claude Sonnet as its primary model for precise code generation.
 */
export class DevAgent extends BaseConsultant {
  readonly agentType = 'dev_agent' as const;

  constructor(
    modelClient: ModelClient,
    private prisma: any,
    private memoryService: MemoryService,
    modelRegistry?: ModelRegistryService,
    skillLoader?: SkillLoader,
    /** M7.7: see BAAgent — opt-in ticket-scoped skill injection. */
    libraryService?: LibraryService,
  ) {
    super(
      modelClient,
      modelRegistry,
      {
        agentType: 'dev_agent',
        rolePrompt: DEV_SYSTEM_PROMPT,
        roleSkillTargets: ['all', 'dev'],
        tools: createDevTools({ prisma, memoryService }),
        maxSteps: 50,
        confidenceThreshold: 0.9,
        defaultModel: { provider: 'anthropic', modelId: 'anthropic/claude-sonnet-4' },
      },
      skillLoader,
      undefined,
      libraryService,
      prisma,
    );
  }

  /**
   * Implement an approved PRD by generating code and creating a PR.
   *
   * The agent will:
   * 1. Read the approved PRD
   * 2. Recall codebase conventions from memory
   * 3. Generate implementation code and tests
   * 4. Self-review for bugs, security, and convention adherence
   * 5. Create a PR for human review (NEVER auto-deploy)
   *
   * @param tenantId      - Tenant context
   * @param prdId         - Approved PRD to implement
   * @param engagementId  - Parent engagement
   * @param taskId        - AgentTask tracking this work
   */
  async implementPrd(
    tenantId: string,
    prdId: string,
    engagementId: string,
    taskId: string,
  ): Promise<AgentRunResult> {
    const task = [
      'Implement the approved PRD by generating code and creating a pull request.',
      '',
      'Follow the process defined in your instructions:',
      '1. Read the approved PRD thoroughly',
      '2. Recall codebase conventions and coding standards from memory',
      '3. Generate implementation code following existing patterns',
      '4. Write tests alongside every implementation file',
      '5. Self-review all code for bugs, security issues, and convention adherence',
      '6. Create a pull request for human review — NEVER auto-deploy',
      '',
      'Be precise and follow existing patterns. Flag any ambiguities in the PR description.',
    ].join('\n');

    return this.runLoop(task, {
      tenantId,
      engagementId,
      agentType: this.agentType,
      traceId: `dev-implement-${prdId}-${Date.now()}`,
      memory: {
        prdId,
        taskId,
      },
    });
  }
}
