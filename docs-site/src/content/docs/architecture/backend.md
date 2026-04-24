---
title: Backend — Fastify + Prisma
description: The orchestration runtime. Routes, services, queues, middleware.
---

## Stack

- **Fastify** — HTTP server. Chose over Express / Hono for schema
  validation + speed + plugin ergonomics.
- **Zod** — schema validation at every route boundary.
- **Prisma 7** — ORM over PostgreSQL 16+. Adapter pattern
  (`@prisma/adapter-pg`) for the 7.x runtime.
- **BullMQ** — queue on Redis.
- **TypeScript strict mode** — no `any` unless the surface is
  genuinely dynamic (usually LLM output pre-validation).
- **Vitest** — unit + integration tests. 1,700+ tests at time of
  writing.

## Layout

```
backend/
├── prisma/              # schema.prisma, migrations, generated client
├── scripts/             # dev / smoke / seed scripts
└── src/
    ├── config/          # env schema, feature flags
    ├── lib/             # DI container, logger, RLS middleware, utils
    ├── repositories/    # thin Prisma wrappers (data access)
    ├── routes/          # HTTP endpoints
    │   └── webhooks/    # inbound from external systems
    ├── services/        # business logic
    │   ├── agents/      # BA/Architect/Dev/QA role services
    │   ├── chief-of-staff/
    │   ├── model-registry/
    │   ├── project-graph/
    │   └── …
    ├── queues/          # BullMQ queue registration
    ├── types/           # shared TS types
    └── voice/           # Gemini Live + Twilio integration
```

## Request pipeline

```
Fastify route
  ├─ rate-limit
  ├─ auth (JWT cookie or Bearer)
  ├─ RLS tenant scope bind
  ├─ project scope bind (X-Project-Id header)
  ├─ Zod body validation
  ├─ handler → service → repository → Prisma
  └─ response envelope (JSON API)
```

Every step is a Fastify hook or plugin; nothing is ad hoc.

## Services

Business logic lives in services. Routes are thin — parse input,
delegate to a service, wrap the output. Services never touch the
request object.

Cardinal services:

- `ChiefOfStaffService` — brief drafting, plan decomposition,
  dispatch, replan.
- `TicketService` — canonical CRUD for tickets, with queue integration.
- `MeetingService` — meeting + transcript lifecycle.
- `ModelRegistryService` — pick a model for a role + provider;
  handles AI Council routing.
- `ProjectGraphService` — AST extraction, Louvain community, query
  helpers.
- `IntegrationConnectionService` — per-integration credential vault
  + test-connection flows.

Services are instantiated once per process via the DI container
(`lib/di-container.ts`).

## DI container

Single entry point `buildContainer()` wires:

- Prisma client (with the RLS middleware extension).
- Redis client.
- Logger.
- Every service (in dependency order).
- Every queue and consumer.

Tests replace individual slots via a `DeepPartial<Container>` override
so unit tests can mock Prisma / LLM clients without spinning up the
whole app.

## Config

`src/config/env.ts` parses `process.env` once at startup through a
Zod schema. Invalid env → crash on boot. Feature flags, optional
secrets, integer bounds — all enforced there.

## Middleware

- **`rls-prisma.ts`** — adds a `$allOperations` hook to every
  tenant-scoped model; populates `where.tenantId` from
  `Request.tenantId`. Prevents cross-tenant data leaks at the Prisma
  layer.
- **`auth.ts`** — JWT cookie first, then Bearer header. Sets
  `request.user` and `request.tenantId`.
- **`project-scope.ts`** — reads `X-Project-Id` and filters list
  endpoints.
- **`rate-limit.ts`** — different buckets per route class; strictest
  on auth.
- **`request-id.ts`** — stable id propagated into logs + LLM calls +
  downstream HTTP.

## Errors

Custom `HttpError` class with shape:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable"
  }
}
```

No stack traces to clients in production. Errors are logged with
full traces on the backend.

## Testing

- Unit tests — colocated under `__tests__/`. Prisma mocked with
  partial stubs.
- Integration tests — use `workforce0-test-redis` + a throwaway
  Postgres schema. Real Redis, real Postgres, mocked LLM.
- Smoke tests (`scripts/smoke-test.ts`) — end-to-end against a real
  deployment. Used in CI against deploy previews.

## Observability

- Structured JSON logs (`pino`-based).
- Prometheus metrics endpoint at `/metrics`.
- OTLP tracing when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

See [Observability](/self-hosting/observability/).

## Key design choices

- **Schema-first routes.** Every route defines Zod schemas for body,
  params, and response. Mismatches fail loudly.
- **Prisma over raw SQL.** Some power ceiling (no window functions
  without raw), but the middleware leverage on every query is worth
  it.
- **Services as classes, not modules.** Makes DI + testing
  ergonomic.
- **Async/await everywhere.** No callbacks. No unmanaged promises.
- **No global state** except logger + config.
