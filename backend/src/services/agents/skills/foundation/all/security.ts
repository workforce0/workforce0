import type { FoundationSkill } from '../../types.js';

export const SECURITY: FoundationSkill = {
  name: 'security',
  version: '1.0.0',
  target: 'all',
  content: `### Security Standards
- Follow OWASP Top 10 — treat every external input as untrusted until validated and sanitized
- Always use parameterized queries or ORM-level abstractions; never concatenate user input into SQL or NoSQL queries
- Validate and sanitize all inputs at the service boundary: type, length, format, allowed-value checks before any processing
- Store secrets exclusively in environment variables or a secrets manager; never hardcode credentials, API keys, or tokens in source code or config files
- Prevent XSS by escaping all user-generated content before rendering; use Content-Security-Policy headers in all HTTP responses
- Verify webhook signatures (HMAC-SHA256 or equivalent) before processing any inbound event payload
- Scope every data query to the authenticated tenant's tenantId; never allow cross-tenant data leakage through missing WHERE clauses
- Apply rate limiting on all public and authenticated endpoints to prevent brute-force and DDoS attacks
- Enforce HTTPS everywhere; reject plaintext HTTP connections in production
- Rotate and audit credentials regularly; log all authentication events and access-control failures for incident response`,
};
