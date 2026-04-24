// mvp/src/services/agents/skills/types.ts

export type SkillTarget = 'all' | 'ba' | 'dev' | 'qa' | 'meeting_brain' | 'supervisor';
export type SkillScope = 'foundation' | 'learned';
export type LearnedSkillStatus = 'candidate' | 'active' | 'demoted';

export interface FoundationSkill {
  name: string;
  version: string;
  target: SkillTarget;
  content: string;
}

export interface LearnedSkill {
  id: string;
  name: string;
  content: string;
  target: SkillTarget;
  confidence: number;
  sourceOutcomes: number;
  positiveRate: number | null;
  negativeRate: number | null;
  status: LearnedSkillStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedSkill {
  name: string;
  version: string;
  scope: SkillScope;
  content: string;
}

export interface ConsultantConfig {
  agentType: string;
  rolePrompt: string;
  roleSkillTargets: SkillTarget[];
  tools: import('../../agent-runtime/types.js').AgentTool[];
  maxSteps: number;
  confidenceThreshold: number;
  defaultModel: {
    provider: string;
    modelId: string;
  };
}
