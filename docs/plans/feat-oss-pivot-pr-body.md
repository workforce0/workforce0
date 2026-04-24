# PR body: feat/oss-pivot → main

Copy/paste into the PR description at
https://github.com/workforce0/workforce0/pull/new/feat/oss-pivot

Suggested title: `feat: OSS pivot + Wave 2 + Channel Routing + Hermes I/II/III(M1)`

---

## Summary

24-commit branch that pivots Workforce0 from SaaS to open-source self-hosted, ships a full product sprint on top, and kicks off Hermes-agent pattern adoption. All commits typecheck clean; 100+ new tests, all passing.

## Shipped

### Wave 1 — OSS pivot (commits 1–2)
- README, LICENSE (MIT), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG
- `.github/` — issue templates, PR template, CI/release/security workflows, FUNDING, CODEOWNERS
- 20 parallel Stitch prompts (4-platform deploy templates + 6 integration setup guides + 3 workflows + repo hygiene files + audit doc)
- `.editorconfig`, renovate, husky + lint-staged, changesets, release-please-config
- Frontend eslint flat config + prettier
- `docs/stitch-prompts/` — 7 UI mockup prompts for non-dev integration wizards

### Wave 2 — make it a real OSS product
- CI unblock + placeholder URL sweep
- Full Stripe billing rip-out (code + schema + tests + migration)
- Password-reset email wired through CommunicationRouter
- Jira fake-disabled stub replaced with clean user-actionable error
- `IntegrationConnection` Prisma model + unified `/integrations/:name/connect` routes + `/setup/*` endpoints
- Stitch-designed frontend: first-run setup wizard, integration modal, integrations grid, approval queue

### Channel Routing mini-sprint
- M1: Team-member channel settings UI + backend test-channel endpoint
- M2: `ApprovalFanoutService` with Redis-backed token vault
- M3: Slack Events webhook with HMAC signature verification + `APPROVE <token>` parsing
- M4: Inbound-email webhook with shared-secret auth + JSON-provider-agnostic shape
- M5: 8 vitest cases for the full reply-ingestion loop + Mailgun/Zapier/Postmark setup docs

### Hermes I (5/5 modules)
- M1 Prompt caching — `applyAnthropicCacheControl`, 11 tests
- M2 AGENTS.md rules — "Prompt Caching Must Not Break" + Skills injection + Memory fence rules
- M3 Skills — Prisma model + migration + service + 10 tests + 6 REST endpoints
- M4 Memory Manager — interface + orchestrator + 9 tests (BuiltinMemoryProvider completes the half)
- M5 Installer — `scripts/install.sh` with platform detect, `/dev/tty` prompt, `curl | bash` support

### Hermes II (8 bonus items)
- Redaction (12 tests) — PII/secrets/keys/JWTs/PGP scrubbed before leaving server
- Credential pool (8 tests) — round-robin + exponential backoff
- Rate-limit tracker (14 tests) — healthy → throttled → circuit_open state machine
- Smart model routing (10 tests) — 8-model capability catalog + pickModel()
- Title generator (10 tests) — pluggable summarizer callback
- Trajectory capture — service layer for skill distillation
- Context compression (7 tests) — preserves system + tail for cache warmth
- BuiltinMemoryProvider — Postgres-backed always-on memory (FTS deferred)

### Hermes III (kickoff)
- **PromptPipeline (8 tests)** — agent-loop integration point that wraps ModelClient with redaction + prompt caching + trajectory in one line. Zero breaking changes.

## Test plan

- [ ] CI green on the branch
- [ ] Typecheck clean on `mvp/` and `frontend/`
- [ ] `docker compose -f docker-compose.prod.yml up -d` boots from a fresh clone
- [ ] `curl | bash` installer works on macOS + Linux VM
- [ ] Smoke: sign up → setup wizard → paste transcript → brief generated → approve
- [ ] Slack Events webhook: reply `APPROVE <token>` in DM flips PRD status (needs `SLACK_SIGNING_SECRET` set)
- [ ] Email webhook: POST JSON to `/webhooks/email/reply` with valid secret flips PRD status
- [ ] All integration wizards (Jira/Slack/GitHub/Linear/Notion/GChat) succeed end-to-end from the modal

## Known follow-ups (Hermes III M2–M8)

- Migrate BA/Dev/QA/Supervisor agents to use `PromptPipeline.wrap()`
- Wire `Skills.invoke()` and `MemoryManager.prefetchAll()` into agent-loop message building
- Postgres FTS migration for `BuiltinMemoryProvider` (replaces ILIKE)
- Cron scheduler + Honcho integration + subagent spawning (deferred with pull-in triggers)
