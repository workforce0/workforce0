// mvp/src/services/model-registry/default-models.ts
import type { AgentType, ProviderName } from '../../types/model-registry.types.js';

export interface DefaultModelAssignment {
  agentType: AgentType;
  primaryProvider: ProviderName;
  primaryModelId: string;
  reviewers: Array<{ provider: ProviderName; modelId: string }>;
  confidenceThreshold: number;
  maxSteps: number;
}

export const DEFAULT_MODEL_ASSIGNMENTS: DefaultModelAssignment[] = [
  {
    agentType: 'meeting_brain',
    primaryProvider: 'google',
    primaryModelId: 'gemini-2.0-flash',
    reviewers: [],
    confidenceThreshold: 0.8,
    maxSteps: 15,
  },
  {
    agentType: 'ba_agent',
    primaryProvider: 'google',
    primaryModelId: 'gemini-2.0-flash-thinking',
    reviewers: [{ provider: 'openai', modelId: 'o1' }],
    confidenceThreshold: 0.85,
    maxSteps: 25,
  },
  {
    agentType: 'dev_agent',
    primaryProvider: 'anthropic',
    primaryModelId: 'claude-sonnet-4',
    reviewers: [
      { provider: 'google', modelId: 'gemini-2.0-flash-thinking' },
      { provider: 'openai', modelId: 'o1' },
    ],
    confidenceThreshold: 0.9,
    maxSteps: 50,
  },
  {
    agentType: 'qa_agent',
    primaryProvider: 'anthropic',
    primaryModelId: 'claude-sonnet-4',
    reviewers: [
      { provider: 'google', modelId: 'gemini-2.0-flash-thinking' },
      { provider: 'openai', modelId: 'o1' },
    ],
    confidenceThreshold: 0.9,
    maxSteps: 30,
  },
  {
    agentType: 'memory_optimizer',
    primaryProvider: 'anthropic',
    primaryModelId: 'claude-haiku-4',
    reviewers: [],
    confidenceThreshold: 0.7,
    maxSteps: 10,
  },
  {
    agentType: 'supervisor',
    primaryProvider: 'google',
    primaryModelId: 'gemini-2.0-flash',
    reviewers: [],
    confidenceThreshold: 0.8,
    maxSteps: 20,
  },
  {
    // M7.4: chief_of_staff is the planner. Planning is structured JSON
    // output with short context — the cheapest fast model is fine.
    agentType: 'chief_of_staff',
    primaryProvider: 'google',
    primaryModelId: 'gemini-2.0-flash',
    reviewers: [],
    confidenceThreshold: 0.7,
    maxSteps: 1,
  },
];

export const FALLBACK_CHAINS: Record<string, Array<{ provider: ProviderName; modelId: string }>> = {
  anthropic: [
    { provider: 'google', modelId: 'gemini-2.0-flash-thinking' },
    { provider: 'openai', modelId: 'gpt-4o' },
  ],
  google: [
    { provider: 'anthropic', modelId: 'claude-sonnet-4' },
    { provider: 'openai', modelId: 'gpt-4o' },
  ],
  openai: [
    { provider: 'anthropic', modelId: 'claude-sonnet-4' },
    { provider: 'google', modelId: 'gemini-2.0-flash-thinking' },
  ],
};
