# Changelog

All notable changes to Workforce0 are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (2026-04-25)


### Features

* end-to-end WhatsApp approval loop + brand rollout + OOTB pipeline fixes ([#31](https://github.com/workforce0/workforce0/issues/31)) ([d874d71](https://github.com/workforce0/workforce0/commit/d874d71438f49da18f1a95de798e3244b81aef92))
* initial public release ([5897aa5](https://github.com/workforce0/workforce0/commit/5897aa520c52f393c0c4da77f334a7d441ffe81b))
* **landing:** bolder hero + integration row + acknowledgements ([58d8b90](https://github.com/workforce0/workforce0/commit/58d8b90616b125b7648c34d26854d2f3a527bae7))
* **landing:** hosted-mode static-export deploy to Cloudflare Pages ([7d9c799](https://github.com/workforce0/workforce0/commit/7d9c799b83c2422b0d2f53f35e3f2e4432e57c2f))
* Step 0 — local-everything bundle (Ollama + Whisper + provider abstractions) ([#38](https://github.com/workforce0/workforce0/issues/38)) ([6dbca0e](https://github.com/workforce0/workforce0/commit/6dbca0ed838a83c6a79107a981aa8fa786005874))


### Bug Fixes

* **landing:** contrast + honest integration claims ([cb4ce35](https://github.com/workforce0/workforce0/commit/cb4ce35d697f4c2f50e5f22b011c027c07ade990))
* **landing:** scrub all overclaims from gap analysis ([48bc3b8](https://github.com/workforce0/workforce0/commit/48bc3b85cfabf6f5880304e727cd77cc9a6a00ce))


### Documentation

* per-role local-model routing guide (byok/local-ollama) ([f32ad85](https://github.com/workforce0/workforce0/commit/f32ad855aae709ac546c69e5db065c6f6d7c6540))
* workforce0.dev → workforce0.com (domain swap) ([62a28e6](https://github.com/workforce0/workforce0/commit/62a28e6204b600dac79f18a4bd890ea89d1e1ea2))


### Code Refactoring

* **backend:** zod 4 forward-compat fixes ([705ca8c](https://github.com/workforce0/workforce0/commit/705ca8c54fb553320c89720c061d51e51dd4c602))

## [Unreleased] — feat/oss-pivot branch

### Changed
- **Pivoted to open-source self-hosted model.** Removed billing, SaaS tiers, and platform-managed inference costs. Users now run Workforce0 on their own infrastructure with their own AI keys (BYOK).
- Reframed documentation around self-hosting, one-click deploys, and BYOK.
- Added MIT license, contributor guide, code of conduct, security policy.

### Added

**Deployment**
- One-click deploy templates: `railway.json`, `render.yaml`, `fly.toml`, `.do/app.yaml`, `docs/deploy-vercel.md`
- `scripts/install.sh` — one-liner `curl | bash` installer with platform detection (macOS/Linux/WSL2), `/dev/tty` wizard pattern, auto-secret generation
- `.github/workflows/` — CI, docker-publish, release-please, security scans
- Full repo hygiene: CODEOWNERS, `.editorconfig`, renovate, husky + lint-staged, changesets, release-please-config

**Wave 2 — real OSS product surface**
- `IntegrationConnection` Prisma model — generic AES-256-GCM-encrypted BYOK credential vault
- Unified `/api/integrations/:name/connect` endpoint with pluggable tester registry
- `/api/setup/status` + `/api/setup/complete` for first-run wizard
- Stitch-designed frontend screens: first-run setup wizard (`/onboarding/setup`), integration wizard modal, integrations grid, approval queue

**Channel Routing — meet approvers on their channel**
- Team-member channel settings UI with per-channel addresses + "Send test" button
- `ApprovalFanoutService` — Redis-backed token vault, fans out approval requests via `CommunicationRouter`
- Slack Events webhook with HMAC signature verification + `APPROVE <token>` / `REJECT <token>` parsing
- Inbound email webhook with shared-secret auth + JSON-provider-agnostic shape (Mailgun / Zapier / Postmark)

**Hermes I — foundational patterns from NousResearch/hermes-agent**
- Prompt caching utility (`applyAnthropicCacheControl`) with "system + last-3 non-system" breakpoint strategy
- `AGENTS.md` updated with "Prompt Caching Must Not Break" + Skills injection + Memory fence rules
- `Skill` Prisma model + `SkillsService` + `/api/skills` routes — markdown playbook invocation as user-message prefix
- `MemoryManager` + `MemoryProvider` interface with builtin-first + one-external-max rule
- Shell installer (`scripts/install.sh`) with `/dev/tty` prompt pattern

**Hermes II — bonus resilience + quality layer**
- `redact.ts` — PII/secrets/JWTs/credit cards scrubbed before leaving the server
- `CredentialPool` — round-robin rotation across multiple keys per provider with exponential-backoff cooldown
- `RateLimitTracker` — state machine healthy → throttled → circuit_open
- Model catalog + `pickModel()` — 8-model capability-based router
- `TitleGenerator` — LLM-based session titling with pluggable generator
- `TrajectoryService` — per-turn telemetry for skill distillation + replay
- `ContextCompressor` — swaps long middle of conversation for summary while preserving cache warmth
- `BuiltinMemoryProvider` — Postgres-backed always-on memory provider

**Hermes III — agent-loop integration**
- `PromptPipeline` — wraps `ModelClient` with redaction + prompt caching + trajectory in one line
- `createModelClient` accepts `pipeline` option — factory-level opt-in
- DI exposes `promptPipeline` + `trajectoryService` singletons
- Agent construction sites (MemoryOptimizerAgent) migrated to pipeline
- `AgentLoop.run()` integrates Skills + MemoryManager:
  - Detects `/slug` task prefix → invokes skill → injects activation as user-message prefix
  - Prefetches memory against effective task → wraps in fenced `<memory-context>` → injects as user-message prefix
- Postgres FTS migration (`to_tsvector` + GIN index) — replaces ILIKE recall in `BuiltinMemoryProvider`
- Cron scheduler: `ScheduledJob` Prisma model + `CronSchedulerService` + `/api/cron` routes + frontend `/schedules` page
- `HonchoMemoryProvider` — external user-modeling service plugin (enabled with `HONCHO_API_KEY` + `HONCHO_APP_ID`)
- Frontend: `/skills` and `/schedules` admin pages

### Removed
- All SaaS-era planning docs (`docs/plans/`, revenue model, launch-readiness reviews, roundtable reviews).
- Billing routes and Stripe scaffolding (fully excised: code, schema, tests, migrations).
- `proposal_website/` (SaaS sales proposal, no longer relevant).
- `TheAICompany*.docx` (pre-pivot sales deck).

### Metrics
- 1,255 backend tests passing (across 81 files)
- Typecheck clean on both `mvp/` and `frontend/`
