---
title: Chief of Staff
description: The planner agent that turns approved briefs into dispatched tickets. Your hands on the steering wheel.
---

## The role

The chief-of-staff is the single agent that:

1. Drafts briefs from meeting transcripts.
2. Decomposes approved briefs into plans.
3. Dispatches child tickets to specialists.
4. Watches ticket outcomes and replans on failure.
5. Posts status updates to the comms channel.

Everything else in the system either feeds the chief-of-staff
(transcription, project graph) or is dispatched by it (BA,
architect, dev, QA).

## The prompt

Kept short on purpose. The chief-of-staff is "a busy exec's thoughtful
assistant, not a novelist." The baseline system prompt is ~40 lines
(see `backend/src/services/chief-of-staff/planner-llm.ts`, function
`buildSystemPrompt`).

The user prompt enriches with:

- The parent ticket (title + description).
- Available roles (`ba_agent`, `architect`, `dev_agent`, `qa_agent`,
  `memory_optimizer`).
- Available skills (vendored from `vendor/skills/`).
- Available subagents (vendored specialists like `code-reviewer`).
- **Project landmarks** — top-5 god-nodes from the project graph,
  when the ticket has a `projectId` (see [Project Graph](/features/project-graph/)).
- **Replan reason** (on attempts 2 and 3).
- **Past critique score** (on revise rounds).

## Plan shape

Output is valid JSON:

```json
{
  "summary": "one-line exec-facing description",
  "steps": [
    {
      "title": "short imperative action",
      "description": "what done looks like",
      "roleSlug": "dev_agent",
      "subagentSlug": "code-reviewer",
      "skills": ["skill-slug"],
      "dependsOn": [0, 1]
    }
  ]
}
```

The backend validates against a Zod schema before persisting. Bad
JSON from the LLM gets one silent retry, then falls back to a
single-step "review and decide" plan.

## Plan attempt cap

`PLAN_ATTEMPT_CAP=3` by default. That's:

- Attempt 1: first plan.
- Attempt 2: replan after a child ticket failure.
- Attempt 3: last replan. If it fails too, the chief-of-staff
  escalates to the exec with all three plans for manual intervention.

Tune via env var if needed.

## Decomposition heuristics

The chief-of-staff is prompt-tuned to prefer:

- Fewer steps over more (≤ 6 hard limit; 1–3 common).
- Explicit dependencies between steps.
- Concrete acceptance criteria per step.
- Roles matched to the nature of the work, not defaulted.

It's prompt-tuned AGAINST:

- Vague step descriptions ("set up the thing").
- Circular dependencies.
- Roles that don't exist in this tenant.

The critique step scores plans against these axes; revise rounds
fix them.

## Dispatch mechanics

When a plan is approved:

1. For each step, a child `Ticket` is created (see
   [Database schema](/architecture/database-schema/)).
2. Step dependencies become `blockedBy` relationships.
3. Each ticket is enqueued into BullMQ with the specialist role's
   queue.
4. Specialists pull from their queue and claim tickets.
5. Completion events trigger dependent tickets to enqueue.

## Replan behaviour

When a child ticket transitions to `failed`:

1. The chief-of-staff subscribes to `ticket.failed` events.
2. If this is the first failure on the plan, a single replan is
   attempted with the failure message as `replanReason`.
3. If the SAME error signature repeats twice, the chief-of-staff
   escalates (Slack DM to exec) instead of trying a third time.

## Broadcast

On every plan event (created, approved, failed, replanned, completed)
the chief-of-staff posts a message. Routing:

- Default comms channel for the workspace.
- Optionally per-project channel if configured.
- Never DMs unless for escalations.

## Model choice

By default the chief-of-staff uses the **planner slot** of whichever
provider is live. Override per-role via `MODEL_PLANNER_<PROVIDER>`:

```bash
MODEL_PLANNER_ANTHROPIC=claude-sonnet-4-6
MODEL_PLANNER_OPENAI=gpt-4o
MODEL_PLANNER_GOOGLE=gemini-2.0-flash-exp
```

Via AI Council, multiple of these run in parallel. See
[AI Council](/features/ai-council/).

## Budget gate

If `PLANNER_MONTHLY_BUDGET_TOKENS` is set and exceeded, the
chief-of-staff stops calling LLMs and falls back to a **deterministic
single-step plan**:

```
Step 1: Review this brief and decide next steps.
  Role: chief_of_staff
  Description: <brief body>
```

The exec sees this plan with a **Budget exceeded** badge. Approves or
redirects manually.

## What's NOT in scope

- The chief-of-staff doesn't **do** the work. It plans and dispatches.
- It doesn't touch external systems directly (Jira writes happen via
  the specialist agents).
- It doesn't learn from feedback. Each plan is stateless; prompt
  context is the only memory.

Memory is deferred — see [Memory optimizer](/features/specialist-agents/)
for the role that could own it.

## Debugging a bad plan

1. Find the `ExecutionPlan` row in the **Activity** page.
2. Inspect its `metrics`: `critiqueScore`, `revised`, `candidateCount`,
   `graphContentHash`.
3. If `critiqueScore` is low despite `revised: true`: the model
   struggles with this brief shape. Try a different
   `MODEL_PLANNER_<PROVIDER>`, or add context via skills.
4. If `candidateCount` is 1 despite `SELF_CONSISTENCY_N=3`: the other
   2 drafts failed JSON validation. Inspect raw model output in the
   logs (debug level).
5. If god-nodes in the prompt look wrong: rebuild the project graph.
