---
title: Ticket orchestration
description: How approved plans become ordered work in a queue, and how roles pull from it.
---

## The ticket lifecycle

```
pending → in_progress → done
                       ↘
                         failed → (retry | replan | escalate)
```

Every plan step materialises as a `Ticket` row. Tickets transition
via the `TicketService` — a single abstraction that handles queue
writes, RLS scope, audit logging, and event broadcasting.

## Ticket shape

- `id` — stable.
- `tenantId`, `projectId`, `goalId` — scope.
- `roleSlug` — which queue consumer owns this.
- `title`, `description` — what to do.
- `status` — one of `pending | in_progress | done | failed`.
- `parentTicketId` — up-link to the chief-of-staff ticket.
- `dependsOn` — upstream tickets that must finish first.
- `payload` — role-specific input (skills, subagent slug, plan id).
- `claimedBy` — the consumer currently working on it.
- `result` — role-specific output (diff, review text, test plan).
- `error` — populated on `failed`.

## The queue

BullMQ (Redis-backed). One queue per `roleSlug`:

- `queue:chief_of_staff`
- `queue:ba`
- `queue:architect`
- `queue:dev`
- `queue:qa`
- `queue:memory`

Consumers are specialist agents — either server-side for roles that
talk to the LLM directly, or the **AgentHub daemon** for `dev` /
`qa` that code-gen locally.

## Dispatching

When a plan is approved:

1. `ChiefOfStaffService.planTicket()` writes N child ticket rows.
2. Each ticket's `dependsOn` list is set from the plan's
   `step.dependsOn` field.
3. Tickets with empty `dependsOn` are enqueued immediately. The
   rest stay `pending` with `dependsOn` populated.
4. As upstream tickets transition to `done`, their downstream
   dependents get enqueued.

## Retry vs replan vs escalate

On `ticket.failed`:

- **Retry** — if the failure looks transient (network, 5xx from
  provider), the queue's BullMQ retry policy handles it (3 attempts,
  exponential backoff). Status stays `in_progress` across retries.
- **Replan** — if the failure is structural (bad prompt, missing
  context), the chief-of-staff subscribes to the event and creates a
  new plan (attempt 2 or 3). Old plan + tickets transition to
  `superseded`.
- **Escalate** — same failure signature repeating → DM the exec
  with details. No further automatic action.

## Parallelism

Tickets in the same plan without `dependsOn` relationships run in
parallel. Max concurrency per role is set via queue concurrency
(`BULLMQ_CONCURRENCY_<ROLE>=N`, default 5).

## Audit hooks

Every transition writes to `audit_log`:

- `ticket.created`
- `ticket.claimed`
- `ticket.transitioned` (with before/after status)
- `ticket.failed` (with error signature)
- `ticket.replanned`

Queryable from **Activity** page.

## Legacy `AgentTask` table

Earlier versions had a separate `AgentTask` table that's gradually
being retired (see
[DEFERRED.md](https://github.com/workforce0/workforce0/blob/main/docs/DEFERRED.md)).
Tickets are the canonical rows; AgentTask mirrors are reverse-mirrored
for back-compat until BAAgentService is rewritten.

Do NOT introduce new callers that write AgentTask directly.

## Priorities

Tickets can be given a priority (low / normal / high / urgent).
BullMQ's priority queueing ensures urgent tickets cut the line.
Rarely used; most work is priority `normal`.

## Timeouts

Per-role timeouts via `TICKET_TIMEOUT_<ROLE>_SECONDS`:

- `chief_of_staff`: 120 s (planner calls).
- `ba`, `architect`: 300 s (LLM-bound).
- `dev`, `qa`: 1800 s (30 min; AgentHub daemon does real work).
- `memory`: 60 s.

Timed-out tickets transition to `failed` with `error = "timeout"` and
are subject to the normal retry / replan path.

## Querying

```bash
# Tickets for this brief
GET /api/tickets?parentTicketId=tk_…

# Tickets for this role, pending
GET /api/tickets?roleSlug=dev_agent&status=pending

# Activity feed (all ticket transitions)
GET /api/activity?limit=50
```

RLS scopes everything to the calling user's tenant and active project.

## Debugging a stuck ticket

1. **Activity** → filter by this ticket's `parentTicketId`.
2. Check `status`. `pending` with no `dependsOn` → queue consumer
   hasn't claimed it. Is the consumer alive?
3. `in_progress` with old `claimedAt` → consumer crashed mid-flight.
   BullMQ's stalled-job recovery puts it back on the queue after
   30 s; if it doesn't, the ticket is truly orphaned — manually set
   to `pending` to re-dispatch.
4. `failed` with an error → read the error; usually obvious.
