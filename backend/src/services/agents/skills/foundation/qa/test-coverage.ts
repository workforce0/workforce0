import type { FoundationSkill } from '../../types.js';

export const TEST_COVERAGE: FoundationSkill = {
  name: 'test-coverage',
  version: '1.0.0',
  target: 'qa',
  content: `### Test Coverage Standards
- Maintain a minimum of 80% line and branch coverage across all service and repository code; coverage below this threshold blocks a merge
- Prioritize testing boundary conditions (empty inputs, max values, off-by-one), error paths (network failure, invalid data, unauthorized access), and happy paths — in that order
- Cover every explicit business rule with at least one test; if a requirement is written, a test for it must exist
- Do not test trivial getters, setters, framework boilerplate, or auto-generated code; these inflate coverage without adding value
- Each test must assert a specific, observable outcome — avoid tests that only verify no exception was thrown
- Review coverage reports as a map of untested behavior, not a score to maximize; use it to identify risky untested paths
- Require integration tests for every external service boundary (database, cache, third-party API) in addition to unit tests that mock those boundaries
- Track coverage trends over time; a drop of more than 2% in a single PR should require justification`,
};
