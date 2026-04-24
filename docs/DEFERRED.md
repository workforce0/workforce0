# Deferred Work

Work that's known-pending, scoped out of recent commits so the
landing commit stays coherent. Pick these up when you're next in
the relevant area.

## Project-graph follow-ups (PG.10+)

**Context:** `a1a834c feat(pg): project-graph service` landed the
native TS implementation inspired by [safishamsi/graphify](https://github.com/safishamsi/graphify)
— god nodes in the planner prompt, domain-aware Whisper, PRD↔code
cross-links.

Status after the second follow-up pass (2026-04-23):

- [x] **Python extractor.** Regex-based `py-extractor.ts` emits the
  same `FileExtraction` shape as `ts-extractor.ts`; dispatched per
  file extension in `project-graph.service.ts`. Nested classes /
  decorators deliberately out-of-scope.
- [x] **Auto graph refresh on GitHub push webhooks (PG.11).**
  `repoPath` cached on ProjectGraph at first build; push to the
  default branch triggers `refreshForRepo(repoFullName)` which
  rebuilds every matching row. Non-default branches are explicitly
  skipped to avoid thrashing.
- [x] **Frontend graph browser (PG.12).** `/graph` page shows
  summary tiles, god-nodes, symbol explorer (callers + community),
  path finder. Graphify credit rendered inline.
- [x] **Graph-staleness badge on plans (PG.13).** ExecutionPlan now
  stamps `graphContentHash` when landmarks feed the prompt; library
  routes annotate each plan with `graphStale: true | false | null`
  by comparing to the current ProjectGraph row; library page
  renders an amber "stale graph" / emerald "fresh graph" chip.
- [x] **Metric validation harness (PG.14).** `metric-harness.ts`
  aggregates paired (control, treatment) RunResult rows into
  mean/median/pass-rate/revise-rate deltas + a qualitative verdict.
  CLI at `backend/scripts/pg-metric-harness.ts`. **Real validation
  is still required**: the harness MATH is verified; the claim that
  landmarks improve critique scores still needs a corpus of ≥50
  code-touching tickets run through both arms against a live model.
- [ ] **Go / Rust / Java extractors.** Still missing. Each can
  follow the Python pattern — one file per language emitting the
  shared `FileExtraction` shape. For precision over regex we'd
  bring back `web-tree-sitter` + per-language WASM grammars.

## N6 follow-ups — full AgentTask retirement

**Status (2026-04-22):** writer cutover is done at all five primary
entry points. `TicketService.createAsNewWork()` writes Ticket as
the canonical row and reverse-mirrors an AgentTask for legacy
readers. `TaskRepository.createTask` is `@deprecated` with a runtime
warning log — silence in production = safe to drop.

**Chain-blocked on production evidence, cannot be compressed in a
single coding session:**

- [ ] **Production soak.** Watch the deprecation warning on
  `TaskRepository.createTask()` in production logs for a full release
  cycle. Any remaining caller is a bug in the cutover. Cannot be
  accelerated by more code — the signal comes from real traffic.
- [ ] **Rewrite BAAgentService internal state transitions.** 1,614
  lines of state-machine logic still keyed on `taskId`. Each
  transition needs to update the Ticket directly with AgentTask
  sync via the existing mirror. Estimate: ~1 day of focused work
  once we have an integration test that exercises the full
  transcript → brief → dispatch loop (no such test exists today —
  that's the real prerequisite).
- [ ] **Flip `BAAgentProcessJobData.ticketId` optional → required.**
  Delete the legacy `taskId` path + the `taskId: ''` fallback
  inside `BAAgentService.processMeetingTranscript` around line 390.
  Same for Dev/QA job types. Blocked on the rewrite above.
- [ ] **Drop `agent_tasks` table.** Only after the soak shows zero
  deprecation warnings AND the BAAgentService rewrite lands.
  Sequence:
  1. verify no rows produced for the last release cycle (`SELECT max(createdAt) FROM agent_tasks`)
  2. migration: `ALTER TABLE agent_tasks RENAME TO agent_tasks_archived` — safety net for one more cycle
  3. watch logs — any `relation "agent_tasks" does not exist` error points at a caller the rewrite missed
  4. migration: `DROP TABLE agent_tasks_archived`
  Do NOT collapse steps 2 and 4 into one migration. The rename is
  the fuse-length we give ourselves to catch stray readers.

## P1 follow-ups — project isolation hardening

All items shipped in `490af40`:

- [x] Project-scoped `/analytics` page — useProjectScope + backend projectId filter
- [x] Integration tests for `/api/projects` — 18-test suite
- [x] URL-based project scope — `?project=slug` overrides localStorage
- [x] End-to-end Playwright smoke — `frontend/e2e/project-switcher.spec.ts`

## RLS middleware — audit remaining tenant-scoped models

The Prisma RLS extension covers 28 models after `fff5c7b`. Models
with a `tenantId` column that are NOT yet in the extension
(service-layer filtering is the only guard):

**Added since last DEFERRED update:**

- `ProjectGraph` (PG.1)
- `PRDSymbolLink` (PG.8)
- `ExecutionPlan` (M7.2 — tenantId field present, not RLS-gated)

**Still missing (pre-existing):**

- `SkillPackage` / `SubagentDefinition` — both have nullable
  tenantId for global rows; see "nullable-tenantId" note below

Each addition needs: (1) verify no code passes `tenantId: undefined`
in a `where` clause on that model, (2) add to `TENANT_SCOPED_MODELS`
set, (3) add the `$allOperations` extension entry, (4) add a test
in `src/lib/__tests__/tenant-prisma.test.ts`.

Nullable-tenantId models (shared globals) deserve special handling:
`AgentRole`, `PRDTemplate`, `LearnedSkill`, `SkillPackage`,
`SubagentDefinition`. The simplest route is a per-model opt-in
where the RLS filter becomes
`{ OR: [{ tenantId }, { tenantId: null }] }` on reads.

## M7 follow-ups — chief-of-staff orchestration

- [x] **Thread `libraryService` + prisma into BA/Dev/QA subclasses.**
  Done in `cfc8022` — BAAgent, DevAgent, QAAgent all take optional
  trailing `libraryService?: LibraryService` param and forward
  `prisma` so the BaseConsultant skill-injection hook activates in
  production.

## Zero-cost inference paths (what to support, what NOT to support)

**Killed: subscription-routing via local daemon.** The original M7
sketch included a "run the planner against the user's Claude Pro or
ChatGPT Plus subscription via a local daemon that wraps the CLI /
desktop app." This is a **ToS violation** with both Anthropic and
OpenAI:

- Claude Pro / claude.ai is explicitly personal-use. Serving
  programmatic workloads through it — even your own — is outside
  scope. Claude Code is a partial exception (it's designed for dev
  automation), but running tenant traffic through one developer's
  Pro subscription is "sharing credentials" territory.
- ChatGPT Plus ToS: "No automating, integrating, or otherwise
  accessing the Service through any method other than the OpenAI
  API." A local daemon wrapping the CLI is exactly the pattern
  they call out.

Marketing this as a feature in the README would put the ToS
violation on our own docs, which is the part that ends badly. Do
not ship it, do not suggest it.

**Legit zero-cost paths shipped:**

- [x] **Local models via `provider: 'custom' + baseUrl`.** Ollama
  / llama.cpp / LM Studio / vLLM all work through the
  OpenAI-compatible path. `docs/byok.md` now has the walkthrough +
  "what runs where" matrix (planner = frontier; specialists = local
  OK). Shipped in `490af40`.
- [x] **Free-tier Gemini API surfaced in setup wizard.** 15 req/min
  · 1,500 req/day · explicitly permitted for automated use. Shipped
  in `490af40`.
- [x] **Hard spend caps on the planner via ModelRegistry.**
  `monthlyBudgetTokens` on AgentRole is now a gate in LLMPlanner —
  when the cap is hit, ChiefOfStaff runs the deterministic fallback
  instead of calling the LLM. Fixed-cost BYOK in practice.
  Shipped in `490af40`.
