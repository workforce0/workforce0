---
title: Glossary
description: Terms of art used throughout the docs.
---

## A

**Agent daemon** — Local process on an operator's machine that
connects to the backend via WebSocket and runs dev / QA tickets
using the operator's Claude Code / Cursor CLI. See
[Agent daemon](/architecture/agent-daemon/).

**AI Council** — The multi-model consensus system. Planner calls run
through ≥2 providers; disagreement surfaces as metrics. See
[AI Council](/features/ai-council/).

**Approval** — A human decision on a brief or plan. Attributed,
logged, and irreversible (without an explicit revision flow).

## B

**BA / BA agent** — Business analyst role. Does user research,
requirement refinement. One of the specialist roles.

**Brief** — The one-pager that describes what should be built. Stored
in the `PRD` table. See [Brief generation](/features/brief-generation/).

**BYOK** — "Bring your own keys." The cost model. You pay providers
directly; we don't resell tokens.

## C

**Chief of staff** — The planner agent. Drafts briefs from meetings,
decomposes approved briefs into plans, dispatches, replans on
failure. See [Chief of Staff](/features/chief-of-staff/).

**Council mode** — `strict-quorum | majority | best-available`. How
the AI Council handles member responses.

**Critique-revise** — The M8.1 quality loop. After a plan is
drafted, a critique scores it 0–25; below threshold triggers a
single revision.

## D

**Dev agent** — Specialist role that runs code-gen via the agent
daemon.

## E

**Exec (consumer)** — The non-technical user the product serves.
Lives in Slack / Teams / WhatsApp; rarely opens the web UI.

**ExecutionPlan** — A plan of 1–6 steps. New rows created on replan
(attempts 2, 3); older plans marked `superseded`.

## F

**Frontier model** — Anthropic Claude / OpenAI GPT-4 / Google Gemini.
The class of models the chief-of-staff prefers for planning.

## G

**God-node** — A node in the project graph with many edges. "Central
symbols" in the codebase. Used as landmarks in planner prompts.

**Graph staleness** — A plan's recorded graph hash no longer matches
the current project graph. Plans may reference renamed / removed
symbols.

## I

**Installer (persona)** — The technical operator. Runs
`docker compose up`, paste BYOK keys, wires integrations. The repo
speaks to them.

## M

**Memory optimizer** — Role that summarises long ticket histories to
keep planner context under the model window.

## P

**Plan** — Short for `ExecutionPlan`.

**PRD** — The schema table for briefs. Called "brief" in exec-facing
UI; "PRD" in the code and schema.

**Prompt caching** — Anthropic's (and others') ability to cache
stable system prompts across calls. Saves ~80% of input-token cost
for repeated prompts.

## Q

**QA agent** — Specialist role. Acceptance tests, manual QA plans.

## R

**Replan** — A new `ExecutionPlan` generated after a child ticket
failed. Attempts 2 and 3 only; attempt 4+ escalates to the exec.

**Role** — A queue consumer: `chief_of_staff`, `ba_agent`,
`architect`, `dev_agent`, `qa_agent`, `memory_optimizer`.

**RLS** — Row-level security. Our Prisma middleware forces `tenantId`
filters on every read / write.

## S

**Self-consistency (M8.2)** — Planner drafts N (default 3) plans in
parallel; the most structurally-consistent one wins. Absorbs
prompt-level instability.

**Skill** — A vendored prompt-pack with a slug. The planner includes
relevant skills in specialist agents' contexts.

**Subagent** — A vendored role-specialization. A plan step may name
a subagent to use a specialist system prompt instead of the role's
default.

## T

**Tenant** — The top-level organisation boundary. Most installs have
a single tenant. RLS enforces scope across all tenant-scoped tables.

**Ticket** — A unit of work. Either a chief-of-staff parent
(planner-owned) or a specialist child (executor-owned).

**Transcript** — Text produced by Whisper / Gemini Live from a
Meeting.

## V

**Vendored** — Checked into the repo under `vendor/`. Source of truth
for skills + subagents.

## W

**Whisper** — OpenAI's (or self-hosted) speech-to-text. Used for
uploaded recordings.
