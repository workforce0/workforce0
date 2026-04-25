import type { AgentType, ProviderName } from '../../types/model-registry.types.js';

export interface DefaultModelAssignment {
  agentType: AgentType;
  primaryProvider: ProviderName;
  primaryModelId: string;
  reviewers: Array<{ provider: ProviderName; modelId: string }>;
  fallbackChain?: Array<{ provider: ProviderName; modelId: string }>;
  confidenceThreshold: number;
  maxSteps: number;
  maxReviewRounds?: number;
  reviewerMode?: 'parallel' | 'sequential';
}

export const DEFAULT_MODEL_ASSIGNMENTS: DefaultModelAssignment[] = [
  {
    agentType: 'meeting_brain',
    primaryProvider: 'anthropic', primaryModelId: 'claude-haiku-4-5',
    reviewers: [],
    fallbackChain: [
      { provider: 'google', modelId: 'gemini-3.1-flash' },
      { provider: 'openai', modelId: 'gpt-5-nano' },
      { provider: 'ollama', modelId: 'qwen3.5:8b' },
    ],
    confidenceThreshold: 0.8, maxSteps: 15, maxReviewRounds: 0, reviewerMode: 'parallel',
  },
  {
    agentType: 'ba_agent',
    primaryProvider: 'anthropic', primaryModelId: 'claude-opus-4-7',
    reviewers: [
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'openai', modelId: 'gpt-5.5' },
    ],
    fallbackChain: [
      { provider: 'openai', modelId: 'gpt-5.5' },
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'ollama', modelId: 'qwen3.5:32b' },
    ],
    confidenceThreshold: 0.85, maxSteps: 25, maxReviewRounds: 2, reviewerMode: 'parallel',
  },
  {
    agentType: 'dev_agent',
    primaryProvider: 'anthropic', primaryModelId: 'claude-sonnet-4-6',
    reviewers: [],
    fallbackChain: [
      { provider: 'openai', modelId: 'gpt-5.4' },
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'ollama', modelId: 'qwen3.5-coder:32b' },
    ],
    confidenceThreshold: 0.9, maxSteps: 50, maxReviewRounds: 0, reviewerMode: 'parallel',
  },
  {
    agentType: 'qa_agent',
    primaryProvider: 'anthropic', primaryModelId: 'claude-opus-4-7',
    reviewers: [
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'openai', modelId: 'o3' },
    ],
    fallbackChain: [
      { provider: 'openai', modelId: 'gpt-5.5' },
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'ollama', modelId: 'qwen3.5:32b' },
    ],
    confidenceThreshold: 0.9, maxSteps: 30, maxReviewRounds: 2, reviewerMode: 'parallel',
  },
  {
    agentType: 'memory_optimizer',
    primaryProvider: 'anthropic', primaryModelId: 'claude-haiku-4-5',
    reviewers: [],
    fallbackChain: [
      { provider: 'google', modelId: 'gemini-3.1-flash' },
      { provider: 'openai', modelId: 'gpt-5-nano' },
      { provider: 'ollama', modelId: 'qwen3.5:8b' },
    ],
    confidenceThreshold: 0.7, maxSteps: 10, maxReviewRounds: 0, reviewerMode: 'parallel',
  },
  {
    agentType: 'supervisor',
    primaryProvider: 'anthropic', primaryModelId: 'claude-opus-4-7',
    reviewers: [
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'openai', modelId: 'gpt-5.5' },
    ],
    fallbackChain: [
      { provider: 'openai', modelId: 'gpt-5.5' },
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'ollama', modelId: 'mistral-small-3:24b' },
    ],
    confidenceThreshold: 0.85, maxSteps: 20, maxReviewRounds: 1, reviewerMode: 'parallel',
  },
  {
    agentType: 'chief_of_staff',
    primaryProvider: 'anthropic', primaryModelId: 'claude-haiku-4-5',
    reviewers: [],
    fallbackChain: [
      { provider: 'google', modelId: 'gemini-3.1-flash' },
      { provider: 'openai', modelId: 'gpt-5-nano' },
      { provider: 'ollama', modelId: 'qwen3.5:8b' },
    ],
    confidenceThreshold: 0.7, maxSteps: 1, maxReviewRounds: 0, reviewerMode: 'parallel',
  },
];

// Legacy provider-keyed fallback map. Kept for callers that haven't
// migrated to per-agent fallbackChain yet. Will be removed in Step 1.
export const FALLBACK_CHAINS: Record<string, Array<{ provider: ProviderName; modelId: string }>> = {
  anthropic: [
    { provider: 'google', modelId: 'gemini-3.1-pro' },
    { provider: 'openai', modelId: 'gpt-5.5' },
    { provider: 'ollama', modelId: 'qwen3.5:32b' },
  ],
  google: [
    { provider: 'anthropic', modelId: 'claude-opus-4-7' },
    { provider: 'openai', modelId: 'gpt-5.5' },
    { provider: 'ollama', modelId: 'qwen3.5:32b' },
  ],
  openai: [
    { provider: 'anthropic', modelId: 'claude-opus-4-7' },
    { provider: 'google', modelId: 'gemini-3.1-pro' },
    { provider: 'ollama', modelId: 'qwen3.5:32b' },
  ],
};
