// mvp/src/services/agents/qa/qa.agent.ts

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
import { createQATools } from './tools.js';
import { QA_SYSTEM_PROMPT } from './prompts.js';

/**
 * QAAgent — QA Agent (Agent Loop pattern)
 *
 * Validates code changes against approved requirements by reading PRDs,
 * reviewing code from PRs, running tests, checking coverage, and
 * reporting issues back to the Dev Agent or human reviewers.
 *
 * Uses Claude Sonnet as its primary model for thorough analysis.
 */
export class QAAgent extends BaseConsultant {
  readonly agentType = 'qa_agent' as const;

  constructor(
    modelClient: ModelClient,
    private prisma: any,
    private commsRouter: CommunicationRouter,
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
        agentType: 'qa_agent',
        rolePrompt: QA_SYSTEM_PROMPT,
        roleSkillTargets: ['all', 'qa'],
        tools: createQATools({ prisma, commsRouter, memoryService }),
        maxSteps: 30,
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
   * Validate code changes in a PR against the approved PRD.
   *
   * The agent will:
   * 1. Read the approved requirements
   * 2. Read code changes from the PR
   * 3. Run the test suite
   * 4. Check coverage against requirements
   * 5. Report edge cases, missing tests, potential regressions
   *
   * @param tenantId      - Tenant context
   * @param prdId         - Approved PRD to validate against
   * @param prNumber      - Pull request number to review
   * @param engagementId  - Parent engagement
   * @param taskId        - AgentTask tracking this work
   */
  async validatePr(
    tenantId: string,
    prdId: string,
    prNumber: number,
    engagementId: string,
    taskId: string,
  ): Promise<AgentRunResult> {
    const task = [
      'Validate the code changes in the pull request against the approved requirements.',
      '',
      'Follow the process defined in your instructions:',
      '1. Read the approved PRD to understand all requirements and acceptance criteria',
      '2. Read the code changes from the pull request',
      '3. Run the test suite to check for failures and regressions',
      '4. Check test coverage against each PRD requirement',
      '5. Report all issues found — edge cases, missing tests, regressions, security concerns',
      '',
      'Be thorough and fair. Map every finding to a specific requirement.',
    ].join('\n');

    return this.runLoop(task, {
      tenantId,
      engagementId,
      agentType: this.agentType,
      traceId: `qa-validate-pr${prNumber}-${Date.now()}`,
      memory: {
        prdId,
        prNumber,
        taskId,
      },
    });
  }
}
