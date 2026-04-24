import type { FoundationSkill } from '../../types.js';

export const PRD_PATTERNS: FoundationSkill = {
  name: 'prd-patterns',
  version: '1.0.0',
  target: 'ba',
  content: `### PRD Structure Patterns
- Every feature requirement must state the user problem it solves before describing the solution; avoid solution-first writing
- Each user story must include explicit, testable acceptance criteria in the Given/When/Then format
- Include a dedicated edge cases section for every feature; enumerate failure modes, boundary conditions, and unexpected inputs
- Define non-functional requirements (performance targets, SLA, concurrency limits, data retention) as first-class requirements, not afterthoughts
- Identify and list all external dependencies (third-party APIs, internal services, data sources) with their owners and known limitations
- Separate must-have requirements from nice-to-have enhancements using MoSCoW prioritization (Must, Should, Could, Won't)
- Include a rollback or feature-flag strategy for every significant feature so it can be disabled without a code deploy
- Specify the data model changes required alongside the feature, not in a separate document
- Define success metrics and how they will be measured before development begins, not after launch`,
};
