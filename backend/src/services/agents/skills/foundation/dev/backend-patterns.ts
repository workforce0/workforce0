import type { FoundationSkill } from '../../types.js';

export const BACKEND_PATTERNS: FoundationSkill = {
  name: 'backend-patterns',
  version: '1.0.0',
  target: 'dev',
  content: `### Backend Architecture Patterns
- Separate concerns into three layers: routes handle HTTP (validation, serialization), services contain business logic, repositories handle data access — never mix layers
- Use the repository pattern for all data access; business logic must not contain raw query strings or ORM calls directly
- Apply dependency injection by passing services and repositories as constructor arguments; avoid module-level singletons that complicate testing
- Implement typed error classes for distinct failure modes (NotFoundError, ValidationError, UnauthorizedError) instead of throwing generic Error objects
- Cache aggressively at two levels: Redis for shared state across instances (TTL-based), HTTP cache headers for public or user-specific responses
- Design services for graceful degradation: when an optional dependency (third-party API, cache) is unavailable, the core flow must continue with reduced functionality
- Use database transactions for any operation that writes to multiple tables; never leave data partially committed on error
- Emit structured log events (JSON with traceId, tenantId, duration, outcome) at service boundaries for observability
- Apply the circuit-breaker pattern for calls to external services; fail fast and return a cached or default response rather than timing out`,
};
