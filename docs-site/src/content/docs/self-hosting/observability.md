---
title: Observability
description: Logs, metrics, traces. What's exposed out-of-the-box and how to hook it into your existing stack.
---

## Logs

### Format

- `LOG_FORMAT=pretty` (dev): coloured, human-readable.
- `LOG_FORMAT=json` (prod): structured JSON, one object per line.

Each line includes:

```json
{
  "level": "info",
  "time": "2026-04-23T14:22:03.842Z",
  "pid": 1,
  "hostname": "backend-abc12",
  "module": "chief-of-staff",
  "requestId": "req_01J5…",
  "tenantId": "tn_…",
  "msg": "Plan created",
  "ticketId": "tk_…",
  "planId": "pl_…",
  "steps": 4,
  "attempt": 1
}
```

### Shipping to your aggregator

- **Loki / Grafana** — pipe container stdout via `docker log driver`
  or a sidecar (Promtail / Fluent Bit).
- **Datadog / Axiom / Better Stack** — their Docker log driver or
  agents. `json` format drops in directly.
- **CloudWatch / GCP Cloud Logging** — awslogs / gcplogs driver.

## Metrics

The backend exposes Prometheus metrics at `/metrics` on the backend
service port. Gated behind `METRICS_ENABLED=1` (off by default —
don't expose this publicly).

### Key metrics

| Metric                                 | Type      | What it tracks |
| -------------------------------------- | --------- | -------------- |
| `wf0_http_requests_total`              | counter   | All HTTP requests by route + status. |
| `wf0_http_request_duration_seconds`    | histogram | Latency by route. |
| `wf0_queue_jobs_total{queue,status}`   | counter   | Queue throughput. |
| `wf0_queue_wait_seconds`               | histogram | Queue lag. |
| `wf0_ai_call_total{provider,model}`    | counter   | AI provider calls. |
| `wf0_ai_tokens_total{provider,direction}` | counter | Token usage (input/output). |
| `wf0_ai_call_duration_seconds`         | histogram | LLM call latency. |
| `wf0_plan_steps_total`                 | histogram | Plan step counts — distribution over time. |
| `wf0_critique_score`                   | histogram | M8.1 critique scores. |
| `wf0_project_graph_build_duration_seconds` | histogram | Project graph rebuild times. |

### Dashboards

A reference Grafana dashboard lives at
`docs/observability/grafana-dashboard.json`. Import as-is or adapt.

Key panels:

- **AI spend by provider / model** — tokens × unit cost.
- **Queue lag by queue** — depth + 95th-percentile wait.
- **Critique-score distribution** — histogram to watch planner quality.
- **Top endpoints by latency** — spot regressions.

## Traces

OpenTelemetry, OTLP-gRPC export.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.your-collector:4317
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20...
TRACE_SAMPLE_RATE=0.1
```

Spans exist for:

- HTTP requests (incoming + outgoing).
- Queue job lifecycles.
- AI provider calls (with token counts as attributes).
- Database queries (Prisma auto-instrumentation).

Use **Tempo / Honeycomb / Datadog APM** to query. Trace IDs link to
log lines via `requestId`.

## Alerts that actually matter

Sprinkle these on top of whatever monitoring stack you use:

| Alert                              | Threshold        | Why |
| ---------------------------------- | ---------------- | --- |
| Backend 5xx rate                   | > 1% for 5 min   | Deployment regression. |
| Queue lag (any)                    | > 5 min          | Worker backed up — check backend logs. |
| AI call failure rate               | > 10% for 10 min | Provider outage or key revoked. |
| BYOK token spend                   | > 2× weekly avg  | Possible runaway plan loop. |
| Critique score mean                | < 12 for 24 hr   | Planner quality regression. |
| Postgres connection errors         | any              | Connection pool exhausted / network. |

## Health endpoints

- `GET /api/health` — dep checks (postgres, redis, each configured
  provider).
- `GET /api/health/live` — process liveness (always 200 unless
  event-loop is blocked).
- `GET /api/health/ready` — readiness (false during migrations or
  first-boot seed).

Reserve `/api/health/ready` for load-balancer readiness probes; use
`/api/health/live` for liveness.

## Structured audit log

Separate from operational logs. Written to `audit_log` table; queryable
from the web UI's **Activity** page.

Every write captures:

- `actor` (user email or `system:<component>`)
- `action` (`brief.approved`, `plan.replanned`, etc.)
- `target` (entity type + id)
- `diff` (before / after JSON)
- `metadata` (origin IP, user-agent, API key fingerprint)

## Cost observability

Two cost sources:

1. **Infrastructure** — Docker / VM / managed services. Whatever
   your platform bills you. Out-of-scope here.
2. **BYOK AI spend** — tracked in `api_usage` table + Prometheus.

The admin dashboard's **Analytics** page shows monthly AI spend
rollup by provider and project. Cron hook for daily digest includes
spend delta vs last week.

## What we don't ship

- **APM / error tracking** — Sentry, Rollbar, etc. Bring your own;
  wire via middleware.
- **SIEM / security log forwarder** — nothing native. JSON logs are
  SIEM-friendly; configure your agent.
- **Custom BI** — the `audit_log` + `api_usage` tables are plain
  Postgres. Point Metabase / Superset at them.
