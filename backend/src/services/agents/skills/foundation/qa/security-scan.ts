import type { FoundationSkill } from '../../types.js';

export const SECURITY_SCAN: FoundationSkill = {
  name: 'security-scan',
  version: '1.0.0',
  target: 'qa',
  content: `### Security Scan Checklist
- Run npm audit or equivalent on every build; fail the pipeline on high-severity or critical vulnerability findings
- Scan source code for accidentally committed secrets (API keys, tokens, passwords) using a secrets-detection tool (e.g., truffleHog, gitleaks) on every PR
- Verify CORS configuration in integration tests: assert that requests from unauthorized origins are rejected with 403
- Test that Content-Security-Policy headers are present and correctly scoped on all HTML responses; reject wildcard unsafe-inline policies
- Attempt common authentication bypass patterns in security regression tests: missing Authorization header, expired tokens, tokens for a different tenant
- Validate that all rate-limit controls are active by sending bursts of requests in tests and asserting 429 responses are returned
- Check that no stack traces, SQL errors, or internal service names appear in any 4xx or 5xx API response body
- Verify dependency licenses in CI; flag copyleft licenses (GPL, AGPL) that are incompatible with the project's commercial license`,
};
