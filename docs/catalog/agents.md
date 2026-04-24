# Agents Catalog

Every AI agent in Workforce0 — what it does, where it lives, what tools it calls, and how to extend it.

All agents follow the same runtime pattern: a typed loop in `backend/src/services/agent-runtime/agent-loop.ts` orchestrates **model ↔ tool-call ↔ model** cycles. Agents differ only in their **prompts**, **tool sets**, and **default model assignment**.

## The agent loop (shared by all agents)

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Build prompt  (system + user + retrieved memory + skills)   │
│         ↓                                                       │
│  2. ModelRegistryService.invoke(agentType, prompt, tools)       │
│         ↓                                                       │
│  3. Model returns { text OR tool_call }                         │
│         ↓                                                       │
│  4. If tool_call → execute tool (backend/src/services/…)        │
│         ↓       returns tool_result → go to step 2              │
│  5. If final text → return to caller                            │
└─────────────────────────────────────────────────────────────────┘
```

Key files in the runtime:
- `backend/src/services/agent-runtime/agent-loop.ts` — the loop itself
- `backend/src/services/agent-runtime/prompt-pipeline.ts` — prompt assembly + cache prep
- `backend/src/services/agent-runtime/review-panel.ts` — AI Council critique step
- `backend/src/services/agent-runtime/subagent-spawner.ts` — isolated child agents
- `backend/src/services/agents/skills/` — foundation skills injected by role

## Index

| Agent | Role | Primary model | Code |
|---|---|---|---|
| [Meeting Brain](#meeting-brain) | Extract structure from raw transcripts | Gemini 2.0 Flash | `backend/src/services/agents/meeting-brain/` |
| [BA Agent](#ba-agent-business-analyst) | Turn transcripts → structured product briefs | Gemini 2.0 Flash (thinking) | `backend/src/services/agents/ba/` + `backend/src/services/agent/ba-agent.service.ts` |
| [Architect](#architect) | Brief → implementation design | Gemini 2.0 Flash | `backend/src/services/agent/architect.service.ts` |
| [Dev Agent](#dev-agent) | Design → code + PR | Claude Sonnet 4 | `backend/src/services/agents/dev/` (backend) + `agent/` (local daemon) |
| [QA Agent](#qa-agent) | Verify tests + review output | Claude Sonnet 4 | `backend/src/services/agents/qa/` |
| [Supervisor](#supervisor) | Orchestrates multi-agent pipelines | Gemini 2.0 Flash | `backend/src/services/agents/supervisor/` |
| [Memory Optimizer](#memory-optimizer) | Curate tenant memory over time | Claude Haiku 4 | `backend/src/services/agents/memory-optimizer/` |

All agent types are defined in `backend/src/types/model-registry.types.ts` as the `AgentType` union.

---

## Meeting Brain

Reads raw transcripts and extracts: participants, speakers, timestamps, action items, decisions, sentiment, topics.

- **Prompts:** [`backend/src/services/agents/meeting-brain/prompts.ts`](../../backend/src/services/agents/meeting-brain/prompts.ts)
- **Tools:** [`backend/src/services/agents/meeting-brain/tools.ts`](../../backend/src/services/agents/meeting-brain/tools.ts) — transcript parsing, speaker labeling
- **Entry point:** `backend/src/services/meeting/insights.service.ts`
- **Default model:** `gemini-2.0-flash` — cheap, multimodal, fast

**Contribution entry points:** add a new insight (e.g. blocker detection). New prompt → new tool → new DB field in `MeetingInsight`.

## BA Agent (Business Analyst)

The flagship agent. Ingests a meeting transcript and produces a full product brief: objectives, requirements, acceptance criteria, risks, timeline, confidence score.

- **Prompts:** [`backend/src/services/agents/ba/prompts.ts`](../../backend/src/services/agents/ba/prompts.ts)
- **Tools:** [`backend/src/services/agents/ba/tools.ts`](../../backend/src/services/agents/ba/tools.ts)
  - `recall_tenant_context` — pulls past briefs/memories from MemoryService
  - `create_prd` — writes the structured PRD to Postgres
  - `ask_clarification` — routes a question to the right role via CommunicationRouter
  - `check_existing_backlog` — de-dupe against past briefs
- **Entry points:**
  - Modern: `backend/src/services/agents/ba/ba.agent.ts` — uses agent-runtime
  - Legacy: `backend/src/services/agent/ba-agent.service.ts` — older direct-invocation path, kept for compat
- **Default model:** `gemini-2.0-flash-thinking` (reasoning variant)
- **Optional reviewer:** GPT-4o (AI Council)

**Contribution entry points:** add a new section to the brief (e.g. competitive analysis). New prompt → new schema field on the PRD model → new tool for retrieval.

## Architect

Runs AFTER a brief is approved. Reads the PRD and produces an implementation-ready design: components, APIs, data model, risks, implementation order.

- **Service:** [`backend/src/services/agent/architect.service.ts`](../../backend/src/services/agent/architect.service.ts)
- **Route:** `POST /api/architect/:prdId/design` in [`backend/src/routes/architect.routes.ts`](../../backend/src/routes/architect.routes.ts)
- **Output schema:** `ArchitectureDesign` interface in `architect.service.ts`
- **Default model:** `gemini-2.0-flash` — the design task is JSON-structured, not reasoning-heavy
- **Stored on:** `PRD.architectureDesign` JSONB column

**Contribution entry points:** upgrade the design output (add deployment diagrams, sequence diagrams). Extend the `ArchitectureDesign` interface → update the prompt template → regenerate.

## Dev Agent

Takes an approved brief + its Architect design and **writes code** that solves it. Two flavors:

### Server-side Dev Agent
Used when the **local daemon is not installed**. The backend directly calls Claude to generate patches.

- **Prompts:** [`backend/src/services/agents/dev/prompts.ts`](../../backend/src/services/agents/dev/prompts.ts)
- **Tools:** [`backend/src/services/agents/dev/tools.ts`](../../backend/src/services/agents/dev/tools.ts)
  - `read_prd` — pulls brief + architecture from DB
  - `read_file`, `write_file`, `apply_patch` — file operations
  - `run_tests`, `run_linter` — verification
  - `open_pr` — pushes a branch and opens a GitHub PR
- **Default model:** Claude Sonnet 4

### Local daemon (preferred)
`agent/` folder — a Node WebSocket client that runs on **your machine** and uses **your Claude Code / Cursor / Codex CLI subscription**. Keeps code generation costs off the backend.

- **Entry:** [`agent/src/client.ts`](../../agent/src/client.ts)
- **Executor:** [`agent/src/executor.ts`](../../agent/src/executor.ts) — invokes `claude`/`cursor`/`codex` CLI
- Connects via WebSocket to `backend/src/services/agent-hub/agent-hub.service.ts`

**Contribution entry points:** add a new code-generation tool (e.g. `generate_migration`). Implement in Dev tools → add prompt instructions → add to Dev tool list in `ba/tools.ts`'s `create_prd` handoff.

## QA Agent

Runs AFTER the Dev Agent opens a PR. Validates the implementation: test coverage, security scan, quality gates.

- **Prompts:** [`backend/src/services/agents/qa/prompts.ts`](../../backend/src/services/agents/qa/prompts.ts)
- **Tools:** [`backend/src/services/agents/qa/tools.ts`](../../backend/src/services/agents/qa/tools.ts)
  - `run_tests`, `check_coverage`, `run_security_scan`
  - `report_issues` — appends review comments to the PR
- **Default model:** Claude Sonnet 4

**Contribution entry points:** add a new quality gate (performance? a11y?). New tool → new prompt instruction → new threshold.

## Supervisor

Orchestrates multi-agent flows. Decides which agent runs when, handles hand-offs, resolves conflicts between agents.

- **Agent:** [`backend/src/services/agents/supervisor/supervisor.agent.ts`](../../backend/src/services/agents/supervisor/supervisor.agent.ts)
- **Tools:** [`backend/src/services/agents/supervisor/tools.ts`](../../backend/src/services/agents/supervisor/tools.ts) — dispatch, status, retry
- **Default model:** `gemini-2.0-flash`

**Contribution entry points:** teach the supervisor a new hand-off pattern. New dispatch rule → new tool → new test.

## Memory Optimizer

Runs on a schedule (`backend/src/services/cron/cron-scheduler.service.ts`). Prunes stale memories, consolidates duplicates, updates embeddings.

- **Agent:** [`backend/src/services/agents/memory-optimizer/memory-optimizer.agent.ts`](../../backend/src/services/agents/memory-optimizer/memory-optimizer.agent.ts)
- **Tools:** [`backend/src/services/agents/memory-optimizer/tools.ts`](../../backend/src/services/agents/memory-optimizer/tools.ts)
- **Default model:** Claude Haiku 4 (cheap, runs often)

**Contribution entry points:** add a new consolidation strategy. New tool → new prompt → new cron schedule.

---

## Foundation skills (shared by all agents)

Agents don't have to reinvent common knowledge. Foundation skills are injected as trailing user messages (cache-friendly) based on the agent's role:

```
backend/src/services/agents/skills/foundation/
├── all/                     ← injected into every agent
│   ├── coding-standards.ts
│   ├── quality-gates.ts
│   └── security.ts
├── ba/
│   ├── api-design.ts
│   ├── database-migrations.ts
│   └── prd-patterns.ts
├── dev/
│   ├── backend-patterns.ts
│   ├── docker-patterns.ts
│   ├── security-review.ts
│   └── tdd-workflow.ts
└── qa/
    ├── e2e-testing.ts
    ├── security-scan.ts
    └── test-coverage.ts
```

Loader: [`backend/src/services/agents/skills/loader.ts`](../../backend/src/services/agents/skills/loader.ts).

**How to add a skill:** create a new `.ts` file in the right role subfolder that exports a `SkillDefinition`. The loader picks it up automatically.

## User-defined skills (`/slug` markdown playbooks)

In addition to the hard-coded foundation skills, end users can upload **markdown playbooks** invoked as `/slug` from any meeting. These live in the `Skill` Prisma model and get injected the same way.

- **Admin UI:** `/skills` (see Settings → Skills)
- **Service:** [`backend/src/services/skills/skills.service.ts`](../../backend/src/services/skills/skills.service.ts)
- **Route:** `backend/src/routes/skills.routes.ts`

---

## How to add a new agent

Rare but supported. Copy the `ba/` folder layout and:

### 1. Define the agent type

Add to `backend/src/types/model-registry.types.ts`:
```ts
type AgentType = 'ba_agent' | 'dev_agent' | 'qa_agent' | … | 'my_agent';
```

### 2. Add default model

`backend/src/services/model-registry/default-models.ts`:
```ts
{
  agentType: 'my_agent',
  primaryProvider: 'google',
  primaryModelId: 'gemini-2.0-flash',
  reviewers: [],
  confidenceThreshold: 0.8,
  maxSteps: 15,
},
```

### 3. Create the agent folder

```
backend/src/services/agents/my-agent/
├── my-agent.agent.ts    ← agent class, wraps agent-runtime
├── prompts.ts           ← system + tool-use prompts
├── tools.ts             ← tool definitions + handlers
└── __tests__/
    └── my-agent.agent.test.ts
```

### 4. Wire an entry point

Either:
- **Route-driven:** a new POST route that calls `myAgent.run(input)`
- **Queue-driven:** a new job type in `backend/src/services/queue/processors.ts`
- **Schedule-driven:** a new cron entry in `backend/src/services/cron/cron-scheduler.service.ts`

### 5. Register foundation skills if relevant

If the agent should inherit BA/Dev/QA skills, pass its role in the skill loader config so the right trailing user messages get injected.

### 6. Add to this catalog

Append a new row to the index and a new section below. PRs without a catalog entry will be held until documented.
