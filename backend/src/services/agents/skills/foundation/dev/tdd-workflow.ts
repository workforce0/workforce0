import type { FoundationSkill } from '../../types.js';

export const TDD_WORKFLOW: FoundationSkill = {
  name: 'tdd-workflow',
  version: '1.0.0',
  target: 'dev',
  content: `### TDD Workflow Standards
- Follow RED-GREEN-REFACTOR strictly: write a failing test first, write the minimum code to make it pass, then refactor without changing behavior
- Maintain 80% or higher code coverage as a floor, not a target; prioritize meaningful tests over coverage metrics
- Structure tests in three layers: unit tests for pure logic, integration tests for service interactions, E2E tests for critical user journeys
- Never modify a test to make it pass by loosening assertions; if a test is wrong, understand why before changing it
- Test behavior and outcomes, not implementation details — tests must not break when internal code is refactored without changing observable behavior
- Each test must be independent and idempotent; tests must not share state or depend on execution order
- Use descriptive test names that read as specifications: "should return 404 when engagement does not exist" not "test404"
- Mock only at architectural boundaries (external APIs, databases in unit tests); avoid over-mocking that makes tests meaningless
- Run the full test suite before every commit; a failing test suite blocks a merge`,
};
