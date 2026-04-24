---
title: Queue & BullMQ
description: How tickets move from backend writes to specialist agents.
---

## Stack

- **Redis ≥ 7** (single-shard; no Cluster).
- **BullMQ** — queue library + worker pool + repeatable-job scheduler.
- **Redlock-ish discipline** — one instance owns the cron scheduler.

## Queue topology

One queue per role:

| Queue name         | Consumer                        |
| ------------------ | ------------------------------- |
| `queue:chief_of_staff` | ChiefOfStaffService in-process |
| `queue:ba`         | BAAgentService in-process        |
| `queue:architect`  | ArchitectService in-process      |
| `queue:dev`        | Agent daemon (remote)            |
| `queue:qa`         | QAAgentService in-process or agent daemon |
| `queue:memory`     | MemoryOptimizerService in-process |
| `queue:webhook-outbound` | Outbound webhook retries       |
| `queue:digest`     | Daily / weekly digest cron        |

## Job shape

```ts
interface JobPayload {
  ticketId: string;
  tenantId: string;
  roleSlug: string;
  attempt: number;
  // role-specific extras
  skills?: string[];
  subagentSlug?: string | null;
}
```

Small payload — the worker fetches full ticket state from Postgres.
Keeps Redis small and lets payload version drift be non-breaking.

## Retry policy

BullMQ's `attempts: 3` with `backoff: { type: "exponential", delay: 5000 }`.
After 3 failed attempts, the job moves to `failed` and emits
`job.failed`, which the chief-of-staff subscribes to.

## Priorities

Priorities `1..10`, lower = higher priority:

- `1` — urgent (exec-triggered).
- `5` — normal (default).
- `10` — background (e.g. digest).

BullMQ's priority queueing cuts urgent jobs ahead of normal ones.

## Concurrency

Per-worker, via `BULLMQ_CONCURRENCY_<ROLE>`:

- `BULLMQ_CONCURRENCY_CHIEF_OF_STAFF=2` — planners are expensive.
- `BULLMQ_CONCURRENCY_BA=5`
- `BULLMQ_CONCURRENCY_DEV=3` — remote agents handle their own.
- Default: `5`.

## Idempotency

Each job carries a `ticketId`. The worker checks the ticket's status
before running — if it's already `done`, the job is a no-op. This
defends against at-least-once delivery.

## Repeatable / cron jobs

BullMQ's repeatable-job API schedules:

- **Daily digest** — `DIGEST_CRON_HOUR` local time.
- **Weekly digest** — Mondays 09:00.
- **Google Drive push-channel renewal** — 24 h before expiry.
- **Graph staleness check** — hourly, flags plans as stale when
  applicable.
- **Provider-health recovery probes** — every 60 s per degraded
  provider.

**Only one** instance should own the cron scheduler across a
horizontally-scaled backend. Controlled via
`WORKFORCE0_CRON_ENABLED=1` — set on exactly one replica.

## Stalled jobs

A worker crash mid-job leaves BullMQ with no heartbeat. After 30 s,
BullMQ moves the job back to `active` for another worker to pick up.
Configurable via `lockDuration`.

## Dead-letter queue

Jobs that fail all `attempts` move to `failed`. We don't move them
to a separate DLQ — the `failed` state in BullMQ is queryable and the
chief-of-staff's replan logic reads from it.

For post-mortem, the admin UI has a **Queue → Failed** view per role.

## Observability

Prometheus metrics:

- `wf0_queue_jobs_total{queue,status}` — counter per terminal state.
- `wf0_queue_wait_seconds` — histogram of queue lag.
- `wf0_queue_processing_seconds` — histogram of processing time.

Dashboards in `docs/observability/grafana-dashboard.json`.

## Redis health

Redis becomes a SPoF. Mitigations:

- Managed Redis (ElastiCache, Upstash, Memorystore) for production.
- Persistence (AOF) on for crash recovery.
- Regular backups if you use Redis for anything besides BullMQ.

## What we don't use

- **Sidekiq / Celery / Temporal.** Overkill. BullMQ is the minimum
  that works.
- **PostgreSQL as a queue.** `LISTEN/NOTIFY` tempting, but adds DB
  write pressure and lacks BullMQ's priority + concurrency + retry
  ergonomics.
- **SQS / Cloud Tasks.** Would commit us to a cloud. BullMQ is
  portable.
