import type { FoundationSkill } from '../../types.js';

export const QUALITY_GATES: FoundationSkill = {
  name: 'quality-gates',
  version: '1.0.0',
  target: 'all',
  content: `### Quality Gates
- Confidence threshold for auto-approval is 0.9 or above; output at this level can be delivered without human review
- Confidence between 0.7 and 0.89 requires a human review step before the output is acted upon
- Confidence below 0.7 is blocked; the agent must request clarification or additional context before proceeding
- Limit revision loops to a maximum of 2 iterations; if quality is not achieved after 2 passes, escalate to a human
- Always explain your reasoning explicitly — state what you did, why you chose it, and what alternatives were considered
- Attach a confidence score to every deliverable along with a brief justification for that score
- Flag any assumptions made during the task; do not silently fill in gaps with guesses
- When output quality is uncertain due to ambiguous requirements, surface the ambiguity rather than picking an arbitrary interpretation
- Track and report which skills and versions were applied to produce each output for auditability`,
};
