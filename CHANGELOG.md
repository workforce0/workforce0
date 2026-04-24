# Changelog

All notable changes to Workforce0 are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
