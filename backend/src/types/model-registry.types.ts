// mvp/src/types/model-registry.types.ts

export type ProviderName = 'anthropic' | 'google' | 'openai' | 'meta' | 'custom';

export type AgentType =
  | 'meeting_brain'
  | 'ba_agent'
  | 'dev_agent'
  | 'qa_agent'
  | 'supervisor'
  | 'memory_optimizer'
  | 'chief_of_staff';

export type ModelPreset = 'recommended' | 'budget' | 'premium' | 'custom';

export type ModelCapability = 'code' | 'reasoning' | 'analysis' | 'fast' | 'vision' | 'tools';

export interface ModelSelection {
  primaryModelId: string;
  reviewerModelIds: string[];
  confidenceThreshold: number;
  maxSteps: number;
}

export interface ProviderCredentials {
  name: ProviderName;
  apiKey: string;
  baseUrl?: string;
}
