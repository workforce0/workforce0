---
title: Specialist agents
description: BA, architect, dev, QA, memory optimizer. Who does what and why.
---

## The roster

| Role              | Pulls tickets typed | What it does                                          | Model surface |
| ----------------- | ------------------- | ----------------------------------------------------- | ------------- |
| `chief_of_staff`  | planner tickets     | Decompose briefs, dispatch, replan                    | Frontier-only |
| `ba_agent`        | ba tickets          | Research, user interviews, requirement refinement     | Frontier or local |
| `architect`       | architect tickets   | Technical design spikes, tradeoff memos               | Frontier |
| `dev_agent`       | dev tickets         | Implementation (code-gen via AgentHub daemon)         | Local CLI subscription |
| `qa_agent`        | qa tickets          | Test plans, manual QA checklists, bug triage          | Local or frontier |
| `memory_optimizer` | memory tickets     | Summarise long histories, manage context budgets      | Frontier |

Each role has:

- A **system prompt** (tenant-editable via **Settings → Roles**).
- A **skills** list (vendored; which skills this role can reach).
- A **subagents** list (specialists this role can delegate to).
- A **budget cap** (`monthlyBudgetTokens` on the `AgentRole` row).

## `ba_agent`

User research, discovery, requirements.

- Reads the brief, the meeting transcript, and any attached
  documents.
- Produces a structured output: user segments, pain points, open
  research questions.
- Can spawn a sub-ticket for follow-up user interviews (marked as
  needing human involvement).

Prompt tuning: terse, no hedging. Research is about finding
specifics, not summarising generalities.

## `architect`

Design spikes and tradeoff memos.

- Reads the brief plus the project graph's god-nodes.
- Produces: candidate approaches, tradeoff table, recommended
  direction, risks.
- Typical output: 3 approaches compared on 4 axes, a recommendation
  paragraph, a list of "what we don't know yet."

Prompt tuning: explicit about uncertainty. "We don't know yet"
is a valid answer; "recommended approach" requires justification.

## `dev_agent`

Code synthesis via the AgentHub daemon on your local machine. This
is where Workforce0 differs from most AI products: we DON'T call
Anthropic's API for code-gen. We call your Claude Code / Cursor /
local CLI on your laptop.

Flow:

1. `dev_agent` ticket enqueued.
2. Agent daemon on your machine picks it up via WebSocket.
3. Daemon runs `claude` (or equivalent) with the ticket's prompt +
   your local repo context.
4. Output (diff, test results, notes) POSTs back to the backend.
5. Ticket transitions to `done` or `failed`.

See [Agent daemon](/architecture/agent-daemon/) for the full flow.

### Why not the API?

- **Subscription vs per-token.** Your Claude Code subscription is
  paid. Double-paying via the API is dumb.
- **Source-code locality.** Production code never leaves your
  machine. No transit to a third party beyond the CLI's own call.
- **Existing trust stack.** You already trust Claude Code with your
  repo. Extending that trust to Workforce0 is additive.

### When no agent daemon is running

Tickets stay in the `dev` queue and re-dispatch when an agent comes
online. A warning banner in the UI alerts the installer.

## `qa_agent`

Acceptance tests, manual QA, bug triage.

- Reads the brief plus the `dev_agent`'s output.
- Produces: a test plan, an acceptance criteria checklist, notes on
  untested edge cases.
- Can spawn sub-tickets for specific bug fixes.

Often runs on a local model (Ollama / vLLM) — QA output is less
quality-sensitive than planner output.

## `memory_optimizer`

Context-budget management. Summarises long ticket histories, rolls
up comment threads, keeps the planner's context under the model
window limit.

Rarely runs on demand — usually triggered by a size threshold on the
ticket's accumulated state.

## Adding a new role

Contributors, see [Adding an agent role](/contributing/adding-agent/).
The general recipe:

1. Add a row to the `agent_roles` table (via seed or UI).
2. Register a queue name in `backend/src/queues/`.
3. Optionally write a BaseConsultant subclass in
   `backend/src/services/agents/`. (Purely-LLM-driven roles don't
   need a subclass.)
4. Add a Prisma migration if the role needs tenant-scoped config.
5. Ship.

## Routing tickets to roles

The chief-of-staff writes `roleSlug` on each step. The backend
enqueues into the matching queue. A ticket with an unknown role
stays `pending` forever (and logs a warning).

## Role vs subagent

- **Roles** pull tickets. They're queue consumers.
- **Subagents** are specialists loaded into a role's context. A
  `dev_agent` ticket might include the `code-reviewer` subagent as
  extra context for the code-gen prompt.

See [Skills & subagents](/features/skills-subagents/).
