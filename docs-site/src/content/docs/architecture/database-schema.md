---
title: Database schema
description: High-level map of the Postgres schema. For full field-level detail, read prisma/schema.prisma.
---

## The authoritative source

`backend/prisma/schema.prisma`. ~1,400 lines. Read it. This page is
a map, not a reference.

## Tables by concern

### Tenancy + auth

- `Tenant` — the top-level organisation.
- `User` — one per person; tenant-scoped.
- `Invitation` — pending invites.
- `GoogleOAuthToken` — Google integration tokens.
- `AgentToken` — tokens issued to agent daemons.

### Product scope

- `Project` — the primary organisational container.
- `Goal` — outcomes tied to projects.

### Capture + briefs

- `Meeting` — a meeting session.
- `Transcript` — versioned transcript per meeting.
- `PRD` — the "brief" table.
- `PRDSymbolLink` — code-symbol references from approved briefs.

### Orchestration

- `ExecutionPlan` — the chief-of-staff's plans.
- `Ticket` — specialist work items; children of a chief-of-staff
  ticket.
- `AgentTask` — legacy, being retired; see
  [DEFERRED.md](https://github.com/workforce0/workforce0/blob/main/docs/DEFERRED.md).
- `AgentJob` — BullMQ-adjacent log of agent-daemon jobs.
- `Approval` — attributed approval decisions.

### Knowledge base

- `Skill` — tenant-scoped legacy skills (user-invokable).
- `SkillPackage` — vendored global skills (nullable-tenantId).
- `SubagentDefinition` — vendored subagents.

### Integrations

- `IntegrationConnection` — credentials + status per integration.
- `ChannelRoute` — per-project comms-channel overrides.

### Project graph

- `ProjectGraph` — one row per project. Stores the serialized graph
  + metadata.

### Observability

- `AuditLog` — structured audit trail.
- `ApiUsage` — per-call AI provider usage for cost tracking.
- `Notification`, `NotificationSubscription` — notification
  preferences + delivery log.

### Voice

- `WhisperTranscription` — Whisper job metadata for uploaded
  recordings.

### Scheduling

- `ScheduledJob` — cron-style jobs (digests, health probes).

### Credential vault (encrypted-at-rest)

- `CredentialVault` — any tenant-scoped encrypted blob.

## Naming conventions

- snake_case table names via `@@map("my_table")`.
- camelCase field names.
- `id` is always `cuid`.
- `createdAt` / `updatedAt` on every mutable table.
- `tenantId` on every tenant-scoped table.
- Explicit indexes on `(tenantId, projectId)`, `(tenantId, userId)`,
  etc.

## Key constraints

- **`ProjectGraph.projectId` is unique.** One graph per project. A
  re-build upserts on the same row.
- **`ExecutionPlan.parentTicketId, attempt` composite index.** Fast
  lookup of "all plans for this ticket, newest first."
- **`Ticket.parentTicketId` nullable.** Top-level tickets (the
  `chief_of_staff` row) have no parent. Child tickets always do.

## Soft delete

Not used. Rows are deleted (respecting FK cascades). Audit log
retains the delete event for compliance.

## Migrations

Timestamped Prisma migrations under `backend/prisma/migrations/`.
Every schema change lands a migration file:

```
20260423044620_pg_execution_plan_graph_hash/
  migration.sql
```

- Migrations are checked in and reviewed in the PR that introduces
  them.
- Forward-only; no down-migrations. To revert, write a new forward
  migration that reverses the change.
- Breaking migrations (renaming columns, dropping tables) come with
  a changelog note + a "you must stop traffic" warning.

## Entity relationship sketch (simplified)

```
Tenant 1─N Project 1─N Goal
                   │
                   ├──N Meeting 1─N Transcript
                   │              │
                   │              └─ WhisperTranscription
                   │
                   ├──N PRD (brief) ─N ExecutionPlan ─N Ticket
                   │                                    │
                   │                                    └─N AgentJob
                   │
                   └──1 ProjectGraph ─ N GraphNode / GraphEdge
                                         (serialized in graphJson)

Tenant 1─N User 1─N Approval
               │
               ├─ IntegrationConnection
               ├─ AgentToken
               └─ ApiUsage
```

## Query-time hot paths

Optimised indexes for:

- "Activity feed for this project" — `(tenantId, projectId, createdAt)`
  on `Ticket`.
- "Who's approved what" — `(tenantId, actor, createdAt)` on
  `AuditLog`.
- "Latest graph for project" — unique index on
  `ProjectGraph.projectId`.
- "Webhook refresh lookup" — `(repoLabel)` on `ProjectGraph`.

## Data growth reality

Rough growth per brief:

- 1 `PRD` row.
- 1–3 `ExecutionPlan` rows (inc. replans).
- 2–6 `Ticket` rows per plan.
- 5–15 `AuditLog` rows.
- 5–20 `ApiUsage` rows (one per LLM call).

~50 rows / brief + transcript. A team doing 10 briefs / day produces
~5 MB / day in the DB. Comfortable for years on a $15/mo managed
Postgres.

## When to denormalize

We already do — `ProjectGraph.nodeCount` / `edgeCount` / `languages`
are denormalised for dashboard reads. Reach for denorm when a read is
in a hot path and the join cost shows up in traces.
