# Workforce0 - AI Agent Development Rules

> Portable rules for ALL AI dev harnesses (Claude Code, Codex, Cursor, OpenCode).
> Adapted from Everything Claude Code (ECC) patterns for our Fastify+Next.js+Prisma stack.

## Product Context

Workforce0 is an **open-source, self-hosted** AI workforce platform. Meetings go in → briefs, tickets, and pull requests come out. AI agents (BA, Dev, QA) do the work. Humans approve.

Multi-model consensus across Anthropic, OpenAI, and Google — all optional, BYOK. Roles and models are user-configurable via `AgentConfig` + env overrides; there is **no hardcoded provider→role mapping**.

**Target users are non-technical executives, NOT developers.** Every UI decision must prioritize non-technical users even though the repo is open source. Pattern we're chasing: Cal.com / Plausible / n8n (OSS repo, polished non-dev UX).

**No billing, no SaaS tiers, no platform-managed inference.** Users run it on their own infra with their own AI keys.

## Architecture Rules

### Multi-Model Independence (CRITICAL)

Mirrors CLAUDE.md § "AI Council Architecture". The product supports **3 AI providers** (Anthropic, Google, OpenAI) in its AI Council. Each is optional.

- NEVER couple product code to a single AI provider.
- All model calls go through `ModelRegistryService` — never import provider SDKs directly in routes/services.
- Fallback chains: anthropic → google → openai (and reverse). **No** hardcoded "GPT critiques" / "Claude codes" role split — the code is provider-agnostic.
- Model selection is configurable per agent via the `AgentConfig` table (`primaryModelId`, `reviewerModelIds`, `confidenceThreshold`) plus `MODEL_<ROLE>_<PROVIDER>` env overrides.
- If a provider has no key configured, skip it and use others — never throw.
- Canonical long-form description: `docs-site/src/content/docs/features/ai-council.md`.

### Service Layer Pattern

```
routes/ → services/ → repositories/ → prisma
```

- Routes: HTTP handling, request validation (Zod), response formatting
- Services: Business logic, model orchestration, external API calls
- Repositories: Data access only, Prisma queries
- Never skip layers (no Prisma in routes, no HTTP in services)

### Graceful Degradation

All optional services disable cleanly when not configured:
- Check env vars at startup, log warning, set `disabled = true`
- Methods return safe defaults when disabled (null, empty array, false)
- Never throw on missing optional config
- UI must show "Not connected" status and surface the setup wizard — not an error

### Prompt Caching Must Not Break (CRITICAL)

Adopted from [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) `AGENTS.md`.
Anthropic's prompt cache pays for itself across multi-turn conversations only if
the **cached prefix stays bit-identical** between turns. Any mutation invalidates
the hash and the whole cache chain misses. The cost difference is 10×.

Rules:

1. **Never mutate past messages.** Once a user/assistant message is in the
   conversation history, its `content` is frozen. No trimming, no reformatting,
   no "oh we'll add a system note at position 2." If you need to inject
   context, put it as a NEW trailing message.
2. **System prompt stable across a session.** Build it once per session and
   treat it as read-only. Feature toggles that change the system prompt
   mid-conversation require starting a new session.
3. **Tool schemas stable across a session.** Adding/removing/reordering tools
   mid-conversation breaks the cache. If toolset must change, start a new session.
4. **Memory blocks are a trailing user message, not a system-prompt rewrite.**
   Recalled memory / skill activations are injected as user messages (fenced
   so the model knows they're background context), keeping the system prompt
   and prior history untouched. See `skill_commands.py` pattern in the Hermes
   scout (`docs/plans/2026-05-hermes-scout.md`).
5. **`applyAnthropicCacheControl` is the only place that writes `cache_control`.**
   `backend/src/services/model-registry/prompt-caching.ts` owns the strategy
   (system + last-3 non-system). Don't set `cache_control` manually elsewhere.
6. **Log `cache_read_input_tokens` / `cache_creation_input_tokens`.** Every
   Anthropic response's `usage` block tells you if the cache hit. If hit
   rate is < 30% on a multi-turn workload, something is mutating the prefix —
   investigate before shipping.

If you break any rule above, you MUST add a unit test covering the scenario
that exposed the break. Regressions are easy here — the build still passes,
the API call still works, you just lose 10× cost efficiency silently.

### Skills as User-Message Injection

When the agent loop injects a learned skill into a conversation (see
`services/skills/`), the skill body goes in as a **user message with an
activation note**, never as a system-prompt mutation:

```
[SYSTEM: The user has invoked the "X" skill, indicating they want you
to follow its instructions. The full skill content is loaded below.]

<skill body>
```

This keeps the system prompt stable and the cache warm while still giving
the model clear framing that the skill is the current focus.

### Memory Context as a Fenced User-Message Block

Cross-session memory recall (`services/memory/`) is injected the same way:
a trailing user message wrapped in `<memory-context>...</memory-context>`
with a `[System note: informational background, NOT new user input]`
marker. The memory block is **computed fresh per turn**; it is never
persisted into the conversation history. See the scout doc for the
algorithm.

### Service Auto-Registration Pattern

Services that expose user-facing capabilities (integrations, tools, skills)
should self-register at module load rather than require a manual switch
somewhere central:

- Integration wizards: each `services/integrations/<name>.service.ts`
  registers its `testConnection` with `IntegrationConnectionService`.
- Skills: dropping a file in `services/skills/builtin/` auto-registers it.
- Tool definitions: exported under a consistent `tools` symbol that the
  agent loop aggregates at startup.

This keeps additions to a single file, not three. Review PRs that add a
new integration/tool/skill by only a single file change.

### Workspace (tenant) Isolation Rule

Adapted from Hermes's profile-isolation rules. Every query MUST scope by
`tenantId` / (future) `workspaceId`. Never hardcode `{ tenantId: 'global' }`
or similar. Enforced by:
- `prisma` clients created via `createRlsPrismaClient` set the row-level
  security variable per-request
- Tests must not write to the real DB — use the test container or
  `pg-mem`, and assert that tenant isolation holds across queries.

## Coding Standards (from ECC)

### Immutability

ALWAYS create new objects, NEVER mutate:
```typescript
// WRONG
user.role = 'admin';

// RIGHT
const updatedUser = { ...user, role: 'admin' };
```

### File Organization

- 200-400 lines typical, 800 max
- Organize by feature/domain (services/meeting/, services/ai/)
- One export per file when possible

### Error Handling

- Validate all input at route level with Zod schemas
- Services throw typed errors, routes catch and format
- Never expose stack traces in production
- Log detailed context server-side (Pino with module tags)
- User-facing errors must be human-readable — never JSON blobs or stack frames

### Security Checklist (Before Every Commit)

- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated (Zod schemas)
- [ ] SQL injection prevented (Prisma parameterized queries)
- [ ] XSS prevented (React auto-escape, httpOnly cookies)
- [ ] CSRF protection (sameSite cookies)
- [ ] Workspace isolation verified (JWT workspaceId on every query)
- [ ] Rate limiting on auth/public endpoints
- [ ] Error messages don't leak sensitive data
- [ ] Webhook signatures verified (HMAC-SHA256 + timingSafeEqual)

### Testing Requirements

- 80%+ coverage target
- TDD workflow: RED (write failing test) → GREEN (minimal implementation) → REFACTOR
- Unit tests for services, integration tests for routes, E2E for critical flows
- Never fix tests to match broken code — fix the code

### Git Conventions

```
<type>: <description>
```
Types: feat, fix, refactor, docs, test, chore, perf, ci

### TypeScript Conventions

- `import { Redis } from 'ioredis'` (named, not default)
- Optional deps: `@ts-expect-error` for dynamic imports
- `useSearchParams()` always wrapped in `<Suspense>` in Next.js

## Database Rules (PostgreSQL + Prisma)

- Queries scoped by `workspaceId` (single-workspace by default for self-host)
- Use cursor pagination for lists (not offset)
- Migrations must be backward-compatible (zero-downtime deploys)
- Index foreign keys and frequently filtered columns
- Use `prisma migrate deploy` in production (never `db push`)

## AI Council Rules

There are **two distinct quality gates** in the code; they use different scales. Do
not conflate them:

1. **PRD Council** (`backend/src/services/ai/ai-council.ts`) — primary model
   generates, critique model reviews, consensus decides.
   - Confidence scale: 0-1. Thresholds (from `DEFAULT_CONFIG`):
     - `autoApproveThreshold = 0.9` → auto-approve.
     - `humanReviewThreshold = 0.7` → between 0.7 and 0.9 requires human review.
     - Below 0.7 → blocked.
   - `maxCritiqueIterations = 2` before escalating.
2. **Plan critique** (`backend/src/services/chief-of-staff/planner-llm.ts`) — the
   chief-of-staff decomposition loop.
   - Score scale: 0-25. Below `CRITIQUE_REVISE_THRESHOLD` (default 20) triggers
     exactly one revision round.
   - `PLAN_ATTEMPT_CAP = 3` (initial + 2 replans) before escalating the parent
     brief to a human.
3. **BA agent revision** (`backend/src/services/agent/ba-agent.service.ts`) —
   `maxRevisionIterations` (default 2) before publishing in `review` status.

Cross-cutting rules:

- Roles are configurable — **no hardcoded "this model critiques, that one codes"**.
- Log every model output for audit (written to `api_usage` + `audit_log` tables).
- Respect BYOK — never fall back to a hard-coded provider key.

## OSS Contribution Rules

- Every new integration needs a corresponding in-app wizard (not just env vars)
- Every user-visible string should be translatable (i18n-ready)
- Breaking changes require a migration note in CHANGELOG.md
- New optional deps must degrade cleanly when absent

## Dev Environment

```bash
cd backend && npm run dev      # Backend (Fastify, port 3000)
cd frontend && npm run dev     # Frontend (Next.js, port 3001)
npm run db:generate            # Regenerate Prisma client
npm run db:migrate             # Run migrations (dev)
npm run db:deploy              # Run migrations (production)
```
