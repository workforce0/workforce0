---
title: Audit & approvals
description: Every decision attributed. Every LLM call receipted. Row-level security on every read.
---

## Why this matters

AI products are hard to audit when decisions blur between "the model
did it" and "the user did it." Workforce0's position: every
consequential decision has a clear actor, a timestamp, and a diff.

## The audit log

Single `audit_log` table. Every mutation writes a row:

```json
{
  "id": "al_...",
  "tenantId": "tn_...",
  "actor": "user:alice@example.com",
  "action": "brief.approved",
  "target": "prd:pr_...",
  "diff": { "before": { "status": "pending" }, "after": { "status": "approved" } },
  "metadata": { "ip": "...", "userAgent": "..." },
  "timestamp": "2026-04-23T14:22:03.842Z"
}
```

Actors are either `user:<email>` or `system:<component>` (for
auto-actions like replan).

### Actions instrumented

- `brief.created`, `brief.edited`, `brief.approved`, `brief.rejected`.
- `plan.created`, `plan.revised`, `plan.replanned`, `plan.superseded`.
- `ticket.created`, `ticket.claimed`, `ticket.transitioned`,
  `ticket.failed`.
- `integration.connected`, `integration.disconnected`.
- `user.invited`, `user.role_changed`, `user.removed`.
- `ai_provider.added`, `ai_provider.rotated`, `ai_provider.removed`.

## The Activity page

**Activity** in the sidebar is the human-readable view on
`audit_log`. Filters:

- By actor.
- By action type.
- By target (e.g. one brief's lifecycle).
- By date range.

Exports to CSV.

## Approvals — attribution

Every approval records:

- The approver (user id + email).
- The channel (web UI / Slack / Teams / WhatsApp).
- The message link (for Slack / Teams).
- The decision timestamp.
- The diff at decision time.

Exports suitable for SOX / SOC2 / ISO 27001 evidence requests.

## Row-level security (RLS)

Every tenant-scoped table has a `tenantId` column. A Prisma middleware
enforces `tenantId` on every read and write, sourced from the
request's auth context.

Covered models (at time of writing): 28 tables, including `Project`,
`Meeting`, `Transcript`, `PRD`, `Ticket`, `ExecutionPlan`, `ProjectGraph`,
`AuditLog`, `Integration`, and more.

Not yet covered (service-layer filtering only): a few nullable-tenantId
globals like `SkillPackage`, `SubagentDefinition`. See
[DEFERRED.md](https://github.com/workforce0/workforce0/blob/main/docs/DEFERRED.md).

## Graph-staleness badge

Plans that were built against an older version of the project graph
are flagged `graphStale: true`. Because the graph informs planner
prompts, a stale graph may reference renamed or removed symbols.

In the Library UI:

- 🟡 **stale graph** — plan's graph hash no longer matches current.
- 🟢 **fresh graph** — plan matches current graph.
- (no badge) — no graph snapshot captured at plan time.

## Graph-backed validation of decisions

Decisions that mention specific code symbols ("we'll change
`TaskRepository`") get cross-linked to `PRDSymbolLink`. The UI can
then jump from the brief text to the symbol's file + line. Useful in
audits — "show me every decision that affected module X."

## Retention

Audit log retention is indefinite by default. Truncate only after
confirming your team's compliance requirements allow it.

```sql
DELETE FROM audit_log WHERE timestamp < NOW() - INTERVAL '2 years';
```

## Integration with SIEMs

Two paths:

1. **Tail the JSON logs.** The backend logs every audit event to
   stdout at `info` level with `audit: true`. Ship to Splunk / Datadog
   / whatever.
2. **Poll the API.** `GET /api/audit?since=<iso>` is paginated.

## What audit CANNOT cover

- **Model-internal reasoning.** We log the prompt and the response,
  not the model's thought process.
- **Conversations in Slack outside button clicks.** If someone
  approves in a DM conversation without using the button, that's
  invisible to us. (We log the button click, so we log the
  approval.)
- **Out-of-band actions.** If an admin `psql`s the DB and updates a
  row manually, the audit log misses it. DB-level auditing is the
  right tool for that.

## Security-sensitive info

Audit logs may include:

- Integration hostnames (Jira base URL).
- Email addresses of actors.
- Brief titles (may be commercially sensitive).

They do NOT include:

- API keys (never).
- Full prompt contents for LLM calls — those go to a separate
  `api_usage` table, retained separately with its own access
  controls.
- Meeting transcripts (those are in the `Transcript` table).

Treat `audit_log` with the same access control as user data.
