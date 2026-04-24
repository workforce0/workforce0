import type { FoundationSkill } from '../../types.js';

export const SECURITY_REVIEW: FoundationSkill = {
  name: 'security-review',
  version: '1.0.0',
  target: 'dev',
  content: `### Security Review Checklist for Code
- Verify every endpoint has explicit authentication (JWT validation, API key check) and authorization (tenantId scope, role check) — no endpoint is implicitly protected
- Check all database queries for parameterization; reject any string concatenation of user input into query strings
- Review for injection vulnerabilities beyond SQL: NoSQL injection, command injection, template injection, and LDAP injection patterns
- Ensure no secrets, credentials, or PII are logged at any log level; scrub sensitive fields before writing to logs
- Prohibit dynamic code execution (eval, shell exec, spawning subprocesses) with user-controlled input; flag any such patterns for immediate removal
- Validate that file upload handlers restrict MIME types, file sizes, and destination paths; prevent path traversal attacks
- Confirm error responses never expose internal stack traces, database errors, or system information to the client
- Check dependency versions against known CVE databases; flag packages with high-severity vulnerabilities for immediate update
- Verify CORS policy is restrictive (explicit allowed origins) and not set to wildcard (*) in production configurations`,
};
