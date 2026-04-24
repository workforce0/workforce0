// =============================================================================
// ENGAGEMENT LIFECYCLE TYPES
// =============================================================================
//
// Defines the 8-phase state machine for engagement lifecycle:
// listen → understand → analyze_ask → approve → build → test → ship → learn
//
// Each phase maps to an agent (or null for human-driven phases).

export type EngagementPhase =
  | 'listen'
  | 'understand'
  | 'analyze_ask'
  | 'approve'
  | 'build'
  | 'test'
  | 'ship'
  | 'learn';

export type EngagementStatus = 'active' | 'paused' | 'completed' | 'failed';

export const PHASE_ORDER: EngagementPhase[] = [
  'listen', 'understand', 'analyze_ask', 'approve', 'build', 'test', 'ship', 'learn',
];

export const PHASE_AGENT_MAP: Record<EngagementPhase, string | null> = {
  listen: 'meeting_brain',
  understand: 'meeting_brain',
  analyze_ask: 'ba_agent',
  approve: null,           // Human approval — no agent
  build: 'dev_agent',
  test: 'qa_agent',
  ship: null,              // Human-triggered in beta
  learn: 'memory_optimizer',
};

export interface PhaseTransition {
  from: EngagementPhase;
  to: EngagementPhase;
  condition: 'confidence_met' | 'human_approved' | 'agent_complete' | 'tests_passed' | 'human_triggered';
}

export const VALID_TRANSITIONS: PhaseTransition[] = [
  { from: 'listen', to: 'understand', condition: 'agent_complete' },
  { from: 'understand', to: 'analyze_ask', condition: 'agent_complete' },
  { from: 'analyze_ask', to: 'approve', condition: 'confidence_met' },
  { from: 'approve', to: 'build', condition: 'human_approved' },
  { from: 'build', to: 'test', condition: 'agent_complete' },
  { from: 'test', to: 'ship', condition: 'tests_passed' },
  { from: 'ship', to: 'learn', condition: 'human_triggered' },
  { from: 'learn', to: 'listen', condition: 'agent_complete' },
];
