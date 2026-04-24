---
title: Brief generation
description: How a transcript becomes a structured brief ready for exec approval.
---

## What a brief is

The Workforce0 `PRD` table is the "brief" — a structured record of:

- **Title, summary, goal** — what we're doing and why.
- **Target users** — who benefits.
- **Success metrics** — how we know it worked.
- **Scope & non-scope** — concrete boundaries.
- **Open questions** — what we don't know yet.
- **Status** — `draft | pending_approval | approved | rejected | superseded`.

## The generation flow

1. **Trigger** — manual click (**Generate brief**) or auto on
   `transcript.ready` event.
2. **Context assembly** — the transcript, the project's past briefs
   (last 3), the project graph's god-nodes.
3. **LLM call** — Council planner (see [AI Council](/features/ai-council/))
   writes a structured brief.
4. **Clarifying question check** — if the draft has high-confidence
   unknowns, a question goes to the comms channel before the brief
   is shown.
5. **Brief persisted** — status `pending_approval`.
6. **Comms notification** — Slack / Teams / WhatsApp gets the brief
   with three buttons.

## Prompt structure

System prompt: tone (exec-facing, terse), required output schema,
rules about inventing data vs surfacing "unknown."

User prompt:

```
## Transcript
<full transcript>

## Prior briefs in this project
- <title>: <one-line outcome>
- …

## Code landmarks (if project has a graph)
- BAAgentService
- TicketService
- QueueService
- …

## Output schema
{
  "title": "...",
  "summary": "...",
  "goal": "...",
  "targetUsers": "...",
  "successMetrics": "...",
  "scope": "...",
  "nonScope": "...",
  "openQuestions": ["..."]
}
```

## Question-asking behaviour

The chief-of-staff is prompt-tuned to surface at most **2** open
questions before drafting the brief. More than that and the brief
feels like a questionnaire.

Common well-formed questions:

- "I see references to 'the old rebranding doc'. Do you mean the
  2025 one or the 2024 one?"
- "Is the 3-screen limit a hard constraint or a preference?"
- "Who's the final approver on this — you or Alex?"

These post to the comms channel in the same thread as the upcoming
brief.

## Structured validation

The output is validated against a Zod schema. Invalid JSON gets one
silent retry, then a deterministic fallback brief ("Review this
transcript and decide next steps").

## Per-project customization

Teams with strong brief conventions can override the schema and the
prompt per project.

- **Settings → Projects → Brief template** — custom schema fields.
- **Settings → Projects → Brief guidance** — prompt addendum.

Addenda get appended to the system prompt as a "your team's
conventions:" block.

## Regeneration

A brief in `pending_approval` can be regenerated:

- **From the UI**: **Regenerate**. Uses the same transcript + current
  project context.
- **With a hint**: **Regenerate with hint** — provide a free-form
  note like "focus on the QA risk we discussed." The hint gets folded
  into the user prompt.

## Auto-brief

`FEATURE_AUTO_BRIEF=1` enables transcript → brief without a manual
click. Behaviour:

- On `transcript.ready`, enqueue a brief-draft ticket.
- The draft goes straight into `pending_approval`.
- The exec sees it in their comms channel within ~30s of the
  transcript landing.

Useful for high-volume captures (daily standups, customer call
streams). Disable if approval queues feel noisy.

## Data the brief doesn't reach

- Other tenants' data. RLS enforces.
- Other projects in the same tenant. Unless you set `CROSS_PROJECT_CONTEXT=1`
  (off by default).
- External systems (Jira, Drive). Read-only context only flows in
  via the integration-specific flows.

## Debugging bad briefs

1. Open the brief. Click **Show raw LLM output**.
2. Compare to the transcript. Is the model missing context or
   hallucinating?
3. Missing context → upgrade the model (`MODEL_PLANNER_<PROVIDER>`
   to a larger variant) OR add a custom brief template.
4. Hallucinating → reduce prompt temperature (`MODEL_TEMPERATURE`),
   or switch providers.

## What's NOT in scope

- A brief isn't a PRD in the full-fidelity PM sense. It's a
  one-pager. Extended specs are out-of-scope — chain Workforce0
  with your PRD tool of choice (Linear, Notion, Confluence).
- A brief isn't automatically shared outside the workspace.
- A brief isn't versioned after approval — a revision creates a new
  brief that supersedes the old one.
