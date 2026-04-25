// mvp/src/services/agents/meeting-brain/meeting-brain.agent.ts

import { BaseConsultant } from '../base-consultant.js';
import type {
  AgentRunResult,
  ModelClient,
} from '../../agent-runtime/types.js';
import type { MemoryService } from '../../memory/memory.service.js';
import type { ModelRegistryService } from '../../model-registry/model-registry.service.js';
import type { SkillLoader } from '../skills/loader.js';
import { createMeetingBrainTools } from './tools.js';
import { MEETING_BRAIN_SYSTEM_PROMPT } from './prompts.js';

/* ------------------------------------------------------------------ */
/*  Return-value interfaces                                           */
/* ------------------------------------------------------------------ */

export interface MeetingSummary {
  topics: string[];
  keyPoints: string[];
  duration?: number;
}

export interface Participant {
  name: string;
  role?: string;
  speakingTime?: number;
}

export interface Decision {
  description: string;
  madeBy: string;
  context: string;
}

export interface ActionItem {
  description: string;
  assignee: string;
  deadline?: string;
  priority: string;
}

/* ------------------------------------------------------------------ */
/*  MeetingBrainAgent                                                 */
/* ------------------------------------------------------------------ */

/**
 * MeetingBrainAgent — Meeting Transcript Analysis Agent (Agent Loop pattern)
 *
 * Processes meeting transcripts in real-time, identifies participants/roles,
 * flags decisions/action items, and builds structured meeting summaries.
 *
 * Uses Gemini 2.0 Flash as the primary model (no reviewer).
 */
export class MeetingBrainAgent extends BaseConsultant {
  readonly agentType = 'meeting_brain' as const;

  constructor(
    modelClient: ModelClient,
    private prisma: any,
    private memoryService: MemoryService,
    modelRegistry?: ModelRegistryService,
    skillLoader?: SkillLoader,
  ) {
    super(modelClient, modelRegistry, {
      agentType: 'meeting_brain',
      rolePrompt: MEETING_BRAIN_SYSTEM_PROMPT,
      roleSkillTargets: ['all'],
      tools: createMeetingBrainTools({ prisma, memoryService }),
      maxSteps: 25,
      confidenceThreshold: 0.85,
      defaultModel: { provider: 'google', modelId: 'gemini-3.1-flash' },
    }, skillLoader);
  }

  /**
   * Process a meeting transcript and produce a structured summary.
   *
   * The agent will:
   * 1. Analyze the transcript text
   * 2. Identify participants and their roles
   * 3. Extract decisions made during the meeting
   * 4. Extract action items with assignees and deadlines
   * 5. Create a comprehensive meeting summary
   *
   * @param tenantId      - Tenant context
   * @param meetingId      - Source meeting
   * @param transcript     - Raw transcript text (optional — can read from DB)
   * @param engagementId   - Parent engagement (optional)
   */
  async processTranscript(
    tenantId: string,
    meetingId: string,
    transcript: string,
    engagementId?: string,
  ): Promise<AgentRunResult> {
    const task = [
      'Process the following meeting transcript and create a structured meeting summary.',
      '',
      'Follow the process defined in your instructions:',
      '1. Analyze the transcript to identify speakers and key topics',
      '2. Identify participants and infer their roles from context',
      '3. Extract all decisions made during the meeting',
      '4. Extract all action items with assignees, deadlines, and priorities',
      '5. Create a comprehensive meeting summary',
      '',
      'Be precise about speaker attribution and distinguish decisions from discussion points.',
      '',
      transcript ? `Transcript:\n${transcript}` : '(Read transcript from database using meetingId)',
    ].join('\n');

    return this.runLoop(task, {
      tenantId,
      engagementId: engagementId ?? '',
      agentType: this.agentType,
      traceId: `meeting-brain-${meetingId}-${Date.now()}`,
      memory: {
        meetingId,
        transcript,
      },
    });
  }
}
