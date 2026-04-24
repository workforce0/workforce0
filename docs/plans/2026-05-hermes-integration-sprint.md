# Hermes Integration Sprint

| Field | Value |
|---|---|
| **Duration** | 2–3 weeks (52–66h total per scout estimates) |
| **Proposed start** | 2026-05-05 (Monday after Wave 2 stabilizes) |
| **Owner** | TBD |
| **License source** | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT) |
| **Port specs** | [`2026-05-hermes-scout.md`](./2026-05-hermes-scout.md) — module-by-module algorithm + data shapes + TS sketches |

---

## Why this sprint

[hermes-agent](https://github.com/NousResearch/hermes-agent) is Nous Research's open-source self-improving agent — the successor to OpenClaw, 99k GitHub stars, MIT license. It is already the reference implementation for the OSS-agent-that-grows-with-you pattern Workforce0 is chasing.

Wholesale code adoption is not possible — Hermes is Python, Workforce0 is TypeScript. Instead, this sprint ports **five specific concepts** from Hermes into our stack, each with clear ROI (scope set by the scout doc):

1. **Prompt caching architecture** (P0, 3–4h) — direct $ savings on every Claude-routed call
2. **AGENTS.md rules** (P0, 3–4h) — the "prompt caching must not break" rule + registry/command patterns, adopted into our own `AGENTS.md`
3. **Skill-as-user-message pattern** (P1, 12–16h) — closes the "agent that grows with you" loop; new `Skill` Prisma model, new `SkillsService`, agent-loop integration
4. **Memory Manager + Builtin provider + Postgres FTS** (P1, 20–24h) — multi-session agent coherence, fenced `<memory-context>` injection, `onPreCompress` insight-extraction hook
5. **One-line install script + `workforce0 setup` wizard** (P2, 14–18h) — raises non-dev adoption ceiling

Deferred out of this sprint (still on the Hermes roadmap): registry-driven tool discovery (absorbed into AGENTS.md rule work + the Wave 2 `IntegrationConnection` service), Honcho external memory provider, cron scheduler, MCP protocol adoption.

The positioning: **"Workforce0 is the team-oriented, approval-gated sibling of hermes-agent."** We ride hermes-agent's 99k-star momentum by being the complementary project, not a competitor.

---

## Goals

- Measurable cost reduction on Claude-routed AI Council calls (target: >40% via cache hits)
- First working skill-injection loop — AI uses a prior lesson without being asked
- Single self-registering tool registry serving CLI, API, and future MCP endpoints
- `curl | bash` install path documented on README alongside current git-clone flow
- No regressions to existing Wave 2 surface (setup wizard, integration wizards, approval queue still work)

## Non-goals

- Porting Hermes code line-by-line. We port the *patterns* only.
- Replacing our Node agent daemon with hermes-agent (their agent is single-user/personal; ours is team+approval-gated)
- Adopting Hermes's CLI/TUI, Telegram/WhatsApp/Signal adapters — exec audience doesn't need them
- Supporting Python alongside TypeScript — no polyglot stack

---

## Scope

Per the scout's module-by-module spec in [`2026-05-hermes-scout.md`](./2026-05-hermes-scout.md):

### Module 1 — Prompt caching (3–4h, P0)

- New `mvp/src/services/model-registry/prompt-caching.ts` implementing `applyAnthropicCacheControl(msgs, ttl, nativeAnthropic)` with the "system + last-3 non-system" breakpoint strategy
- Hook into `ModelRegistryService` right before `@anthropic-ai/sdk` send (Anthropic-only; Gemini/OpenAI bypass)
- Surface `usage.cache_read_input_tokens` / `cache_creation_input_tokens` in `UsageService`
- 4 unit tests covering: no-system, string content, array content, tool message

### Module 2 — AGENTS.md rules adoption (3–4h, P0)

- Add "Prompt Caching Must Not Break" section to our `AGENTS.md` — verbatim from Hermes AGENTS.md lines 404-412
- Formalize our service auto-registration pattern and name the agent loop in `mvp/src/services/agent-runtime/`
- Adapt Hermes's "profile isolation" rules into our multi-tenant RLS terms (never hardcode `tenantId = 'global'`)

### Module 3 — Skills (12–16h, P1)

- New Prisma `Skill` model (scout spec) + migration
- New `mvp/src/services/skills/` — service, repo, `gray-matter` frontmatter parser
- New `mvp/src/routes/skills.routes.ts` — CRUD so execs upload skills via UI (no CLI, no FS)
- Agent-loop integration: detect leading `/slug`, call `skillsService.invoke()`, push activation message as user turn
- Frontend: basic skill editor + gallery page
- 8 unit tests + 1 E2E (upload skill, invoke in a brief)

### Module 4 — Memory Manager + Builtin + Postgres FTS (20–24h, P1)

- New `mvp/src/services/memory/memory-provider.ts` abstract interface
- New `MemoryManager` orchestrator enforcing "builtin always, one external max"
- Refactor existing `mvp/src/services/memory/memory.service.ts` → delegates to manager with `BuiltinMemoryProvider` (Postgres-backed MEMORY/USER rows)
- Add Prisma models: `MemoryProvider`, `MemoryEntry`, `SessionMemoryIndex` (with Postgres `tsvector`)
- Agent-loop integration: `prefetchAll()` before each LLM call → wrap with `<memory-context>` fence → inject as user message; `syncAll()` after completion
- `onPreCompress` hook to preserve insights across compression boundary
- 12 tests covering: fence wrapping, sanitize, second-external rejection, prefetch failure isolation, compression insight survival

### Module 5 — One-line install + `workforce0 setup` wizard (14–18h, P2)

- New `scripts/install.sh` at repo root — shell port of Hermes's install pattern: platform detect (macOS/Linux/WSL2), Docker check, Node check via `fnm`, clone + `docker compose up -d`, `setup_path` multi-shell PATH edit, `/dev/tty` wizard redirect for `curl | bash` usage
- New `mvp/src/cli/` — `workforce0 setup`, `update`, `start`, `stop` (Commander-based)
- Setup wizard TS: prompts for DB URL, Redis URL, `JWT_SECRET`, provider keys; validation + connection-test-on-input + secret masking; writes `~/.workforce0/.env`

---

## Timeline

Two concrete orderings — pick one at kickoff.

### Option A — 2 weeks, memory deferred to v1.2

| Week | Days | Modules |
|---|---|---|
| 1 | Mon–Tue | M1 Prompt caching (4h) + M2 AGENTS.md rules (4h) |
| 1 | Wed–Fri | M3 Skills (12–16h) |
| 2 | Mon–Wed | M5 Install + setup wizard (14–18h) |
| 2 | Thu | Integration test pass, metrics dashboard (cache hit rate) |
| 2 | Fri | Ship v1.1 release; open tracking issue for M4 Memory → v1.2 |

Ships 4 of 5 modules. Lowest risk.

### Option B — 3 weeks, all 5 modules

| Week | Days | Modules |
|---|---|---|
| 1 | Mon–Tue | M1 Prompt caching + M2 AGENTS.md rules |
| 1 | Wed–Fri | M3 Skills |
| 2 | Mon–Fri | M4 Memory Manager + Postgres FTS |
| 3 | Mon–Wed | M5 Install + setup wizard |
| 3 | Thu | E2E on fresh VM; verify cache hit + skill reuse + memory prefetch |
| 3 | Fri | Ship v1.1 release |

Ships everything. Higher ambition.

### P0/P1 ordering rule

The scout flags one dependency: **Module 1 (prompt caching) is a blocker for everything else** — the "do not mutate cached prefix" rule constrains how Modules 3 and 4 design their message injection. Module 1 must land (and its tests must be green) before anyone starts M3 or M4.

---

## Success metrics

- **Cost:** Average Claude-routed Council call cost drops >40% week-over-week post-Module-1 landing
- **Quality:** First "skill-reused" audit log entry appears within 72 hours of Module 2 landing on a real workload
- **Adoption:** First `curl | bash` install reported via an issue/discussion within 2 weeks of ship
- **OSS health:** Zero regressions in CI; `feat/hermes-sprint` branch merges cleanly to main

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Hermes's Python patterns don't translate 1:1 to TS (async, typing) | Scout covers translation caveats; Module 1 is the riskiest so we tackle it first |
| Skill injection breaks prompt caching from Module 1 | Treat skills as a named layer in the cached-prefix hierarchy; Module 2's spec must address this explicitly |
| Install script fragility across OSes | Scope MVP to Linux/macOS; WSL2 as bonus; flag Windows native as a follow-up |
| Scope creep into Honcho user modeling, cron scheduler, MCP adoption | Explicitly deferred — see "Deferred" section below |

---

## Status — Hermes I (this sprint): 5/5 shipped

| M | Status | Commit |
|---|---|---|
| M1 Prompt caching | ✅ Shipped | `f38fad3` |
| M2 AGENTS.md rules | ✅ Shipped | `f38fad3` |
| M3 Skills | ✅ Shipped (service + tests + routes + Prisma model) | `ff63715` |
| M4 Memory Manager | ✅ Interface + orchestrator | `123e071` |
| M5 Install script | ✅ Shipped | `0033a95` |

## Status — Hermes II (bonus sprint): 8 items shipped

Continued porting value from Hermes while the main sprint was fresh:

| Item | Status | Effort | Notes |
|---|---|---|---|
| Redaction (`redact.ts`) | ✅ Shipped | ~1d | 12 tests; PII/secrets/keys/PGP/JWTs scrubbed before leaving the server |
| Credential pool | ✅ Shipped | ~1d | 8 tests; round-robin + cooldown + exponential backoff |
| Rate-limit tracker | ✅ Shipped | ~1d | 14 tests; state machine healthy→throttled→circuit_open |
| Smart model routing | ✅ Shipped | ~2d | 10 tests; 8-model catalog + task-based pickModel |
| Title generator | ✅ Shipped | ~4h | 10 tests; pluggable summarizer callback |
| Trajectory capture | ✅ Shipped | ~2d | Service layer; storage on AuditLog |
| Context compression | ✅ Shipped | ~3d | 7 tests; preserves system + tail for cache warmth |
| BuiltinMemoryProvider | ✅ Shipped (Postgres, no FTS) | ~1d | Completes the M4 always-on half |

## Still deferred (Hermes III and beyond)

Ordered by expected payoff:

1. **Agent-loop integration** — wire Skills invocation + Memory prefetch + Context compression into the actual request path. Shipped as services but not yet invoked. ~3d.
2. **Postgres FTS on memory entries** — replaces the ILIKE recall in BuiltinMemoryProvider with real `to_tsvector`. ~3d including migration.
3. **Honcho integration** — external MemoryProvider plugin for cross-session user modeling. Turns "agent remembers" into "agent models Priya." ~1 week.
4. **Cron scheduler** — "every Monday 9am digest to Slack" — natural fit once scheduling is wired through CommunicationRouter. ~1 week.
5. **Subagent spawning** — parallel child agents for fan-out work. Needs Memory + Trajectory fully wired first (isolation story only matters when parent context is big enough to benefit). Reclassified from "skip" to here. ~1–2 weeks. Triggers for pulling in: user reports multi-action briefs taking > 2 min, or first parallelizable Dev Agent use case lands.
6. **Honcho user modeling** — see #3; the actual "grows with you" story.

### Skip / not for us

- **ACP adoption** — Agent Communication Protocol, too early to bet on the standard
- **Skins / theming engine** — exec-first product; out of scope
- **Daytona / Singularity / Modal deploy backends** — our Docker + one-click story covers the target audience
- **Google Code Assist integration** — IDE-specific, not in our request path
- **Termux install path** — exec audience doesn't ship from phones

---

## Dependencies

- Wave 2 must be merged to `main` before sprint starts (currently shipped on `feat/oss-pivot`)
- Docker publish workflow from Wave 1 must be green (we use it to ship v1.1 images)
- README's `docs/assets/*.png` should be populated from Stitch before v1.1 ships (not a hard blocker, but the `curl | bash` landing experience is weaker with placeholder screenshots)

---

## Appendix — scout output

Full module-by-module port specs (algorithms, data shapes, TypeScript sketches, effort estimates, caveats) live in [`2026-05-hermes-scout.md`](./2026-05-hermes-scout.md). Any ambiguity in this plan is resolved in favor of the scout doc.

---

## Ship checklist

- [ ] M1 Prompt caching landed with cache-hit metric dashboard
- [ ] M2 AGENTS.md rules merged; agent-loop documented
- [ ] M3 Skills landed with a successful skill-reuse audit entry
- [ ] M4 Memory (if Option B): prefetch visible in logs, `<memory-context>` fences present on outgoing prompts
- [ ] M5 Install script: `curl | bash` tested on fresh macOS + Linux VM
- [ ] CHANGELOG entry under v1.1.0
- [ ] `npm test` + typecheck green on `main`
- [ ] One new E2E test per shipped module
- [ ] Positioning blurb in README: "team-oriented sibling of hermes-agent"
