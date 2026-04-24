# Workforce0 - Project Intelligence

> Shared rules in AGENTS.md (works with Claude Code, Codex, Cursor, OpenCode).
> This file adds Claude Code-specific enhancements.

## Project Direction (2026-04, reframed 2026-04-21)

Workforce0 is **open-source, self-hosted software**. Users `git clone`, bring their own AI keys (BYOK), and run it on their own infrastructure. There is no billing, no SaaS tiers, no platform-managed inference costs.

**Two personas, both load-bearing:**

1. **The installer (technical operator)** — founding engineer, platform team, or tech co-founder. They run `docker compose up`, paste BYOK keys into the wizard, wire integrations. **This is who the repo speaks to — READMEs, CLI tooling, error messages, setup docs.** Expect them to be comfortable with Docker and API keys.

2. **The consumer (non-technical exec)** — VP, CPO, operator the product is actually *for*. They receive Slack/WhatsApp/Teams updates from the chief-of-staff agent, approve briefs by replying, rarely visit the web UI except to audit. **This is who the product experience serves — Slack copy, approval prompts, audit receipts.**

Do NOT mix these two. Install-time concerns → speak to the technical operator. Day-to-day workflows → speak to the exec consumer. An earlier version of this file claimed the installer was an exec directly; that was the contradiction the strategy critique landed on.

Cal.com / Plausible / PostHog / n8n pattern: self-hosted = devs install; non-devs use the product. A hosted tier eventually serves exec-installers — not pursuing it yet.

Non-dev users reach Workforce0 through:

1. **One-click deploy buttons** (Railway, Render, Fly, DigitalOcean) — reduces friction for the technical operator; the exec consumer still doesn't run this step themselves in practice.
2. **In-app setup wizards** — technical operator completes these once; exec consumer inherits a working install.
3. **Comms-first UX after setup** — every orchestration event (new brief, approval needed, task failed) posts to Slack/WhatsApp/Teams. The web UI is an audit receipt, not a daily driver.

## AI Council Architecture (DO NOT BREAK)

This product uses **multi-model consensus** across Anthropic, OpenAI, and Google — all optional, BYOK.

- All model calls go through `ModelRegistryService` — never import provider SDKs directly.
- Never couple product code to a single AI provider. Specific model IDs belong in the `AgentConfig` table or `MODEL_<ROLE>_<PROVIDER>` env overrides, not in service code.
- Users BYOK: any provider is optional. Services degrade gracefully when keys are absent — never throw.
- There is **no hardcoded "Gemini generates, GPT critiques, Claude codes" role split.** The agent daemon's local CLI (Claude Code / Cursor) is separate from the product-runtime AI Council.

Canonical long-form description: [`docs-site/src/content/docs/features/ai-council.md`](./docs-site/src/content/docs/features/ai-council.md). AGENTS.md § "Multi-Model Independence" restates these same rules in harness-portable form.

## CRITICAL PRODUCT DIRECTION

### Split-audience UX

Day-to-day product experience is designed for **non-technical product
leaders** — VPs, CPOs, operators. The repo and install tooling are
designed for the **technical operator** who sets it up. Never blur.

**Day-to-day (exec) principles:**
1. **Comms-first** — chief_of_staff posts to Slack/WhatsApp/Teams; the
   exec approves/pauses/cancels via reply. Web UI is audit-only.
2. **Self-service integrations** — the installer wires these up once;
   the exec sees the result ("✓ Jira connected") in status indicators.
3. **Plain language** — no raw JSON, no technical errors surfaced to
   the exec. Agents frame everything as decisions needing a human call.
4. **Instant value** — exec should see their first brief approved via
   Slack within a day of first meeting upload.

**Install-time (technical operator) principles:**
1. **Docker-first** — `docker compose up` is the primary onboarding path.
2. **Setup wizard fills in the rest** — BYOK keys, integrations,
   org-chart defaults. No config files to edit.
3. **Logs are readable** — install failures point at the specific
   missing env var or integration.

### Integration UX Requirements (exec-facing)

Each integration (Jira, Google Chat, etc.) needs:
- [ ] Visual connection wizard (not a form dump)
- [ ] "Get API Key" button that opens the right page in the service
- [ ] Step-by-step guide with screenshots
- [ ] Connection test with clear success/failure feedback
- [ ] "Disconnect" option that's easy to find
- [ ] Status indicator showing connected/disconnected

### Target User Personas

**Installer (technical operator):**
- Comfortable with Docker and API keys
- Works once, hands off to the consumer
- Reads README, reference docs, setup.md; uses the CLI; troubleshoots logs

**Consumer (non-technical exec — VP/CPO/operator):**
- Busy, time-poor, not technical
- Interacts via Slack/WhatsApp/Teams — rarely opens the web UI
- Approves briefs, answers clarifications, escalations — all via reply
- Comes to the web UI once a week to audit; never reads logs

### Anti-patterns to Avoid (exec-facing)

- Exposing raw JSON or technical errors to the exec
- Requiring the exec to edit config files after initial setup
- Technical jargon in Slack messages
- Forms with 10+ fields
- "Documentation" links in exec-facing copy (inline guidance only)
- Assuming the exec can read logs or run `docker compose` commands

### Anti-patterns to Avoid (install-time)

- Oversimplifying setup docs to the point of lying about what it does
- Claiming the exec will install it themselves — they won't
- Hiding the BYOK requirement behind marketing language

---

## Project Structure

```
workforce0/
├── backend/                # Backend API (Fastify + TypeScript) — was `mvp/` before 2026-04
│   ├── src/
│   │   ├── config/         # Environment configuration
│   │   ├── lib/            # Shared utilities
│   │   ├── repositories/   # Data access layer
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   ├── types/          # TypeScript types
│   │   └── voice/          # Gemini Live API (real-time voice)
│   ├── prisma/             # Database schema & migrations
│   └── docs/               # Technical setup guides (Jira, GChat, etc.)
├── frontend/               # Next.js UI (executive-friendly)
├── agent/                  # Local user-side daemon (BYO CLI subscription)
└── docs/                   # Product docs, self-hosting, BYOK, Stitch prompts
```

## Tech Stack

- **Backend:** Node.js, Fastify, TypeScript, Prisma 7, PostgreSQL, Redis
- **AI:** Multi-model (Anthropic, OpenAI, Google) via AI Council — all optional, BYOK. Specific model IDs are configurable per role via `AgentConfig` + `MODEL_<ROLE>_<PROVIDER>` env overrides.
- **Voice:** Gemini Live API + Twilio Media Stream
- **Integrations:** Jira, Google Chat, Google Drive, GitHub, Twilio
- **Frontend:** Next.js 16, Radix UI, Tailwind v4
- **Agent:** Local Node daemon, WebSocket-connected to backend

## Development Commands

```bash
cd backend
npm run dev          # Start dev server
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Run migrations
npm run db:studio    # Open database UI
```

## Environment Setup

Required in `.env` (root, consumed by docker-compose.prod.yml):
- `DATABASE_URL` / `POSTGRES_PASSWORD` - PostgreSQL
- `REDIS_URL` - Redis
- `GEMINI_API_KEY` - user-provided (BYOK)
- `JWT_SECRET` - 32+ character secret

Optional (integrations disable cleanly without these):
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` - extra Council models
- `JIRA_*` - Jira integration
- `GCHAT_WEBHOOK_URL` - Google Chat notifications
- `TWILIO_*` - voice dial-in

## Architecture Notes

- Services gracefully disable when not configured (no crashes)
- Prisma 7 uses adapter pattern with `@prisma/adapter-pg`
- All optional env vars accept empty strings (treated as undefined)
- Single-org by default; the `tenantId` column exists but defaults to a single workspace for self-hosted installs

## Production Deployment

Deploy with Docker Compose:
```bash
docker compose -f docker-compose.prod.yml up -d
```

Or use a one-click deploy template (see `docs/one-click-deploy.md`).

### Security Checklist (applies to self-hosted prod)

Before exposing your instance to the internet:
- [ ] No hardcoded secrets in source (API keys, passwords, tokens)
- [ ] All user inputs validated (Zod schemas on every route)
- [ ] SQL injection prevention (Prisma parameterized queries)
- [ ] XSS prevention (React auto-escapes, httpOnly cookies)
- [ ] CSRF protection (sameSite cookies, origin checking)
- [ ] Rate limiting on auth endpoints
- [ ] Error messages don't leak sensitive data (no stack traces in production)
- [ ] Non-root container user (`appuser:1001`)
- [ ] Health checks configured on all services
- [ ] `NODE_ENV=production` set in environment
- [ ] HTTPS terminator in front (Caddy, Traefik, Cloudflare Tunnel)

### ioredis Import Convention

Always use named import: `import { Redis } from 'ioredis'` (NOT `import Redis from 'ioredis'`).
The default export causes TS2709/TS2351 namespace errors when used as a type.
