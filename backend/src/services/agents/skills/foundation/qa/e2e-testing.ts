import type { FoundationSkill } from '../../types.js';

export const E2E_TESTING: FoundationSkill = {
  name: 'e2e-testing',
  version: '1.0.0',
  target: 'qa',
  content: `### E2E Testing Standards
- Use the Page Object Model pattern to encapsulate UI interactions; test files must not contain raw selectors or browser API calls
- Always wait for network responses or explicit UI state signals before making assertions; never use fixed sleep/delay waits
- Mark flaky tests explicitly and quarantine them immediately; a flaky test in CI is treated as a blocking defect, not a warning
- Configure automatic retries (up to 2) for transient failures in CI; log the retry count and reason in test output for investigation
- Capture screenshots and video artifacts on every test failure; store them as CI build artifacts for debugging
- Isolate each test's data by creating fresh fixtures at the start and cleaning up at the end; tests must not rely on data left by previous runs
- Run E2E tests in parallel where possible using sharding; keep total CI wall-clock time under 10 minutes for the critical path suite
- Tag tests by feature area and criticality; maintain a smoke suite that covers the top 10 user journeys and runs on every deployment`,
};
