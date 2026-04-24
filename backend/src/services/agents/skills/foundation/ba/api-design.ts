import type { FoundationSkill } from '../../types.js';

export const API_DESIGN: FoundationSkill = {
  name: 'api-design',
  version: '1.0.0',
  target: 'ba',
  content: `### API Design Standards
- Use REST conventions with noun-based resource paths (e.g., /engagements/:id/tasks, not /getEngagementTasks)
- Map HTTP methods to intent: GET for retrieval, POST for creation, PUT/PATCH for update, DELETE for removal; never use GET for mutations
- Return consistent HTTP status codes: 200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 422 Unprocessable Entity, 500 Internal Server Error
- Use cursor-based pagination for all list endpoints; avoid offset pagination beyond a few thousand records due to performance and consistency issues
- Standardize error response shape: { error: { code: string, message: string, details?: unknown } } — never expose raw stack traces
- Version APIs via URL prefix (/v1/, /v2/) when introducing breaking changes; maintain the previous version for a documented deprecation window
- Keep request and response bodies strongly typed and documented; avoid polymorphic payloads that change shape based on undocumented conditions
- Validate and document all query parameters; reject unknown parameters with a 400 rather than silently ignoring them
- Design idempotent endpoints wherever possible; POST creation endpoints should support an idempotency key header
- Specify rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After) on all responses`,
};
