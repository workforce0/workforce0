<div align="center">

<img src="docs/assets/logo.png" alt="Workforce0" width="160" height="160" />

# Workforce0

**Meetings go in. Pull requests come out — for your team to review and merge.**

Open-source, self-hosted AI workforce for product teams. Capture a
conversation, get a structured brief, approve what gets worked on,
and have draft pull requests opened on your own repos by agents
running under your AI keys. Your team reviews and merges — nothing
deploys by itself.

[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1.svg)](./LICENSE)
[![Node 20+](https://img.shields.io/badge/Node-20%2B-43853d.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000.svg)](https://nextjs.org)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000.svg)](https://fastify.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[What it does](#what-it-does) · [Screenshots](#screenshots) · [Quick start](#quick-start) · [Development](#development) · [Architecture](#architecture) · [BYOK](#bring-your-own-keys-byok) · [Contributing](#contributing)

![Dashboard](docs/assets/screenshots/03-dashboard.png)

</div>

---

## What it does

Workforce0 is **AI that fits the way your product team already works** — meetings, briefs, approvals, tickets — with the repetitive in-between work automated.

You capture a conversation (or paste a written brief, drop in a Linear ticket, or record a Loom with notes). Workforce0 turns it into a structured brief with objectives, requirements, acceptance criteria, risks, and an architectural design. You review and approve. Approved briefs auto-generate Jira tickets (or Linear, or Notion pages). An optional local agent drafts pull requests on your GitHub repos, running under your AI keys.

Every step has a human approval gate. **Pull requests are drafts your team reviews and merges — nothing deploys by itself.**

### What honestly works today vs what's still research

- ✅ **Structured inputs** (written briefs, Linear tickets, Loom + notes) produce reliable briefs + tickets + PR drafts. Use these as the daily driver.
- 🧪 **Meeting-transcript ingestion** is the marketing hook and does work for focused meetings with clear decisions. Unstructured freeform exec meetings ("we'll figure it out," "depends on Q3") still confuse the decomposer. Use with approval gates engaged; don't expect raw transcripts to produce merge-ready code on day one.
- ❌ **Autoshipping.** We don't do it. Every PR is a draft awaiting your team's review.

### The end-to-end loop

```
┌─────────────┐     ┌──────────┐     ┌──────────────┐     ┌────────────┐     ┌──────────────┐     ┌─────────┐
│   Meeting   │────▶│    AI    │────▶│    Human     │────▶│ Jira/Linear│────▶│ Local agent  │────▶│   PR    │
│             │     │  brief   │     │   approval   │     │   ticket   │     │  (BYO CLI)   │     │         │
│ upload/meet │     │  ~20 s   │     │              │     │            │     │              │     │         │
│ /phone/vtt  │     │          │     │              │     │            │     │              │     │         │
└─────────────┘     └──────────┘     └──────────────┘     └────────────┘     └──────────────┘     └─────────┘
```

### Who it's for

Two personas, and this matters:

- **Who installs it:** a **technical operator** — your founding engineer, platform team member, or the tech co-founder. They run `docker compose up`, paste BYOK keys into the setup wizard, and wire up integrations. That's you if you're reading this README.
- **Who uses it day-to-day:** the **product leader** (VP, CPO, operator) it's actually built for. They receive Slack / WhatsApp / Teams updates from the chief-of-staff agent, approve briefs by replying, and rarely visit the web UI except to audit what happened.

This split is load-bearing. Self-hosted + BYOK + docker = tech install; exec UX happens via comms channel. Same pattern as Cal.com / Plausible / PostHog: self-hosted edition serves devs who install it; non-devs use the product.

### Why self-host

- **Your data, your machines.** Meeting transcripts never leave your infrastructure.
- **Your AI keys, your costs.** Bring your own Anthropic / Gemini / OpenAI keys — no per-token markup, no per-seat SaaS.
- **Your integrations, your rules.** Jira, Slack, GitHub, Google Drive, Teams — all wired to your own accounts.
- **No vendor lock-in.** MIT-licensed. Fork it, extend it, ship it.

---

## Screenshots

### Sign-in

<img src="docs/assets/screenshots/01-login.png" alt="Login" width="900" />

Cinematic sign-in shell with mesh gradient + display typography. Passwordless SSO optional.

### Dashboard

<img src="docs/assets/screenshots/03-dashboard.png" alt="Dashboard" width="900" />

Hero banner with live AI-workforce impact panel, four tabular stat cards, sample preview for new users, recent activity feed.

### Four-step setup wizard

<img src="docs/assets/screenshots/04-setup-wizard.png" alt="Setup wizard" width="900" />

From fresh install to your first brief in under five minutes — workspace name, AI key, one integration, done.

### Approvals queue

<img src="docs/assets/screenshots/05-approvals.png" alt="Approvals queue" width="900" />

Linear-inspired two-pane inbox for triaging briefs, tickets, and PRs. `J/K` to navigate, `A` to approve, `R` to reject.

### Integrations grid

<img src="docs/assets/screenshots/07-integrations.png" alt="Integrations" width="900" />

Jira, Slack, GitHub, Linear, Notion, Google Chat, Google Drive, Docs, Twilio. All via in-app wizards — no `.env` editing.

### AI providers (BYOK)

<img src="docs/assets/screenshots/08-ai-providers.png" alt="AI providers" width="900" />

Paste keys for Claude, Gemini, or OpenAI. Stored AES-256-GCM encrypted. Test-connection button per provider.

### Model presets

<img src="docs/assets/screenshots/09-models.png" alt="Model presets" width="900" />

Pick Recommended / Budget / Premium presets or wire a custom model to every agent (BA, Dev, QA, Supervisor, Memory, Meeting Brain).

<details>
<summary>More screens</summary>

| | |
|---|---|
| **Signup** | **Meetings** |
| <img src="docs/assets/screenshots/02-signup.png" width="450" /> | <img src="docs/assets/screenshots/06-meetings.png" width="450" /> |
| **Briefs list** | **Analytics** |
| <img src="docs/assets/screenshots/15-briefs.png" width="450" /> | <img src="docs/assets/screenshots/13-analytics.png" width="450" /> |
| **Engagements** | **Team roster** |
| <img src="docs/assets/screenshots/10-engagements.png" width="450" /> | <img src="docs/assets/screenshots/14-team.png" width="450" /> |
| **Skills** | **Schedules** |
| <img src="docs/assets/screenshots/11-skills.png" width="450" /> | <img src="docs/assets/screenshots/12-schedules.png" width="450" /> |

</details>

### Approvals on the phone

The approval queue is responsive — two-pane on the desktop, single-pane + fixed bottom action bar on mobile. And for the truly mobile workflow: reply `APPROVE <token>` or `REJECT <token>` to the Workforce0 WhatsApp/SMS/Slack message and the decision lands server-side without opening the app.

<img src="docs/assets/screenshots/16-approvals-mobile-empty.png" alt="Mobile approvals" width="360" />

---

## Quick start

### Requirements

- **Docker** 20+ (or Node 20 + Postgres 15 + Redis 7 locally)
- **4 GB RAM** minimum
- **A Gemini API key** — [free tier works](https://aistudio.google.com/apikey)

### One command (Docker Compose)

```bash
git clone https://github.com/workforce0/workforce0.git workforce0
cd workforce0
cp .env.example .env
# open .env and paste your GEMINI_API_KEY + a 32-char JWT_SECRET
docker compose -f docker-compose.prod.yml up -d
```

The backend container applies pending Prisma migrations on boot, so
there's no manual `db migrate` step — bring up the stack, wait ~30s for
health checks, then open **<http://localhost:3001>** and create your
account. The in-app setup wizard handles the rest.

**From clone to first brief: under five minutes.**

### One-click deploy

| Platform | Deploy | Free tier |
|---|---|---|
| Railway | [Template →](https://railway.app/template/workforce0) | ✅ |
| Render | [Blueprint →](https://render.com/deploy) | ✅ |
| Fly.io | [`docs/one-click-deploy.md`](./docs/one-click-deploy.md#flyio) | ✅ |
| DigitalOcean | [Marketplace →](./docs/one-click-deploy.md#digitalocean) | 💰 |

---

## Development

For contributors and anyone who wants to run it outside Docker.

### 1. Clone and install

```bash
git clone https://github.com/workforce0/workforce0.git workforce0
cd workforce0

# Install backend deps
cd backend && npm install && cd ..

# Install frontend deps
cd frontend && npm install && cd ..
```

### 2. Start infrastructure

```bash
# Starts postgres:5432 + redis:6379
docker compose up -d postgres redis
```

Or use your own Postgres/Redis and set connection strings in `backend/.env`.

### 3. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set at minimum:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/workforce0
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=<a-32-character-or-longer-secret>
GEMINI_API_KEY=<your-key>   # or configure via the UI later
```

### 4. Set up the database

```bash
cd backend
npx prisma db push       # sync schema
npx prisma generate      # generate client
```

### 5. Start both dev servers

In two terminals:

```bash
# Terminal 1 — backend (http://localhost:3000)
cd backend
npm run dev

# Terminal 2 — frontend (http://localhost:3001)
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev
```

Open **<http://localhost:3001>** and sign up.

### Useful scripts

| Command | What it does |
|---|---|
| `cd backend && npm run dev` | Backend with tsx watch, hot reload |
| `cd backend && npm test` | 1,400+ unit + integration tests (vitest) |
| `cd backend && npm run db:studio` | Prisma Studio — inspect the database |
| `cd backend && npm run db:migrate` | Create + apply a migration |
| `cd frontend && npm run dev` | Next.js dev server (port 3001) |
| `cd frontend && npm run typecheck` | TypeScript strict check |
| `cd frontend && npm run test:e2e` | Playwright E2E smoke tests |
| `cd agent && npm run dev` | Local agent daemon (opens PRs via your CLI) |

### Running on different ports

```bash
# Backend
cd backend && PORT=7777 npm run dev

# Frontend (points at backend)
cd frontend && NEXT_PUBLIC_API_URL=http://localhost:7777 \
  npx next dev --port 7778
```

---

## Architecture

```mermaid
flowchart TB
  subgraph "Browser (exec-friendly UI)"
    FE[Next.js 16 + Radix + Tailwind v4]
  end

  subgraph "Backend API (Fastify)"
    API[REST + SSE + webhooks]
    MREG[ModelRegistry<br/>single point for AI calls]
    BA[BA Agent — brief generation]
    ARCH[Architect — design from brief]
    DEV[Dev tools — read/write PRD, code tools]
    QA[QA Agent — test + review]
    MEM[Honcho memory — grows with you]
  end

  subgraph "Infra"
    PG[(Postgres — tenant data<br/>BYOK encrypted AES-256-GCM)]
    RE[(Redis — sessions, queues, STT buffer)]
  end

  subgraph "Your AI providers (BYOK)"
    GEM[Gemini]
    ANT[Claude]
    OAI[OpenAI]
  end

  subgraph "Your integrations"
    JIRA[Jira / Linear / Notion]
    COMM[Slack / Google Chat / Teams]
    VCS[GitHub]
    TWIL[Twilio — dial-in voice]
    GMEET[Google Meet — auto-ingest]
  end

  subgraph "Your machine"
    AGENT[Local agent daemon<br/>uses YOUR Claude Code / Cursor subscription]
  end

  FE <--> API
  API <--> PG
  API <--> RE
  API --> BA --> MREG
  API --> ARCH --> MREG
  API --> QA --> MREG
  MREG --> GEM
  MREG --> ANT
  MREG --> OAI
  BA <--> MEM
  API --> JIRA
  API --> COMM
  API --> GMEET
  API <-. WebSocket .-> AGENT
  AGENT --> VCS
  TWIL --> API
```

### Key design choices

- **Executive-first UI, not dev-first.** The polished Next.js frontend is the primary surface. The CLI is optional after initial deploy.
- **All AI calls go through `ModelRegistryService`.** Product code never imports provider SDKs directly. Swap Gemini for Claude for GPT without touching any agent.
- **Graceful degradation.** Any integration you haven't configured disables cleanly. No crashes, no angry errors.
- **Single-org by default.** Row-level `tenantId` exists but defaults to a single workspace for self-hosted installs. Multi-tenant SaaS is possible but not the focus.
- **AI Council (optional).** Multi-model consensus: Multi-model consensus across Anthropic, OpenAI, Google. Off by default (faster, cheaper). Enable with `AI_COUNCIL_ENABLED=true`.

---

## Bring your own keys (BYOK)

Workforce0 never holds AI credentials or bills you for inference. You provide keys for the providers you already pay for:

| Provider | Purpose | How to get a key |
|---|---|---|
| **Google Gemini** | Planner, brief generation, transcription | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier: 15 req/min · 1,500/day, no credit card |
| **Anthropic Claude** | Critique, long-context reasoning | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **OpenAI** | OpenAI critique | [platform.openai.com](https://platform.openai.com/api-keys) |

Keys are stored **AES-256-GCM encrypted at rest** and used only by your instance. Configure them via **Settings → AI Providers** or set them once in `backend/.env`:

```bash
GEMINI_API_KEY=AIza...          # required
ANTHROPIC_API_KEY=sk-ant-...    # optional
OPENAI_API_KEY=sk-...           # optional
```

### What runs where (cost + quality)

Not every role needs a frontier model. Put your API dollars into the **planner** and the **BA agent**; run the specialists locally.

| Role | Needs frontier? | Good local option |
|---|---|---|
| `chief_of_staff` (planner) | ✅ **Yes** — open-ended decomposition | Not recommended; degrades sharply on ambiguous inputs |
| `ba_agent` (brief generator) | ⚠️ Strong preference | 70B+ local models are acceptable for structured transcripts |
| `dev_agent` | ❌ Scoped specialist | Qwen 2.5 Coder, DeepSeek Coder via Ollama |
| `qa_agent` | ❌ Scoped specialist | Same as dev_agent |
| `memory_optimizer` | ❌ Summarization | Any 8B+ local model |

> **Not supported.** Running the planner or any LLM workload through your personal **Claude Pro** or **ChatGPT Plus** subscription via a scripted wrapper violates both providers' Terms of Service. BYOK API keys are the path; local models (Ollama / LM Studio / vLLM) are the path; subscription scraping isn't.

**Zero-cost path:** local models for specialists + free-tier Gemini for the planner. See [`docs/byok.md`](./docs/byok.md) for the Ollama quickstart.

Full provider list and setup walkthroughs: [`docs/byok.md`](./docs/byok.md).

---

## Features

### Meetings
- **Upload.** `.vtt`, `.srt`, `.mp4`, `.m4a` — any transcript or recording.
- **Paste.** Drop a Google Meet, Zoom, or Teams transcript directly.
- **Google Meet auto-ingest.** Connect your Google account, drop new recordings in a watched folder, they become briefs automatically.
- **Voice dial-in.** Call a Twilio number, talk to your AI product manager live via Gemini Live API.

### Agents
- **Chief of Staff** — the voice the exec hears on Slack/WhatsApp/Teams. Decomposes new work into a short ordered plan (max 6 steps), posts the plan + progress updates + escalations to the tenant's preferred channel. Runs a plan→critique→revise loop + N=3 self-consistency vote so plans are cross-checked before execution.
- **BA Agent** — generates structured product briefs from transcripts. Runs optional AI Council for multi-model consensus.
- **Architect** — produces implementation-ready design from an approved brief: components, APIs, data model, risks, implementation order.
- **Dev Agent** — (optional local daemon) opens PRs from approved briefs using YOUR Claude Code / Cursor / Codex CLI.
- **QA Agent** — verifies tests pass before merge.
- **Memory Optimizer** — maintains Honcho-style persistent memory that grows with each interaction.

### Skill + subagent library

A catalog the chief-of-staff planner composes from, **not** a persistent deployment. Plans cap at 6 steps; in practice each plan uses 2–4.

- **17 skills** (vendored from `anthropics/skills`, Apache 2.0) — reusable prompt packs like "pr-review," "brand-guidelines," "mcp-builder" that get injected into the executor's system prompt when selected.
- **144 subagent templates** (vendored from `VoltAgent/awesome-claude-code-subagents`) — role-specific personas like "code-reviewer," "api-designer," "security-auditor" the planner can pick for a single step.
- Tool-compatibility gating: the planner filters skills whose required tools aren't available in the current executor's stack.
- Browseable at `/library`; new imports (community / user-authored) land as `pending_approval` status and require a `YES / NO` reply via the comms channel before they're live.

Think of it as a toolbox, not a team — the planner reaches into it for the right tool for the step at hand.

### Project graph (code context for agents)

Every project can be scanned into an AST-derived knowledge graph so agents have structural understanding of the codebase they're working on — not just grep output.

- **Native TS implementation** using the TypeScript compiler API + [graphology](https://graphology.github.io). No Python runtime, no external CLI, no LLM calls for the extraction pass itself.
- **God nodes, call graphs, community clusters** surfaced via `GET /api/project-graph/:id/god-nodes` (+ callers, path, community endpoints). Used automatically by the chief-of-staff planner — the top 5 god nodes ride along in every prompt for a ticket that targets a project with a built graph.
- **Domain-aware Whisper** — transcription prompts get enriched with the tenant's top god nodes + active skills + recent PRD titles so Whisper gets product jargon right on the first pass.
- **PRD ↔ code links** — after a BA agent finalizes a brief, one structured LLM call asks "which project-graph symbols does this brief reference?" Linked symbols show up in the PRD's audit trail.
- Refresh via `POST /api/project-graph/:id/build` (SHA256-cached — re-runs against an unchanged tree are a no-op).

Credit: [safishamsi/graphify](https://github.com/safishamsi/graphify) is the upstream this feature is inspired by. See [Credits](#credits) below.

### Integrations (in-app wizards, no config files)
Jira · Slack · GitHub · Linear · Notion · Google Chat · Google Drive · Google Docs · Google Meet · Microsoft Teams · Twilio · SendGrid · WorkOS SSO

### Approvals
- Linear-inspired keyboard-driven queue (`J/K` navigate, `A` approve, `R` reject)
- Responsive: two-pane on desktop, single-pane + fixed bottom bar on mobile (thumb-reachable, safe-area-aware)
- Sticky action bar on brief detail pages
- Confidence bars, risk callouts, council reasoning inline
- Reply-to-approve via **email**, **Slack**, **WhatsApp**, and **SMS** — reply `APPROVE <token>` or `REJECT <token> <optional reason>` to a Workforce0 message and it's done

### Ask-an-agent from chat
- `@ba status` / `@dev jobs` / `@qa status` / `@architect <id>` / `@supervisor` / `@help` from any **WhatsApp**, **SMS**, or **Slack channel**
- Zero-LLM-cost tier-1 responses (direct DB queries), tenant-scoped via `TeamMember.channelIds`
- Tier-3 vision (fully autonomous multi-agent group chat) scoped in [`docs/plans/tier-3-autonomous-multi-agent-chat.md`](./docs/plans/tier-3-autonomous-multi-agent-chat.md)

### Infrastructure
- OpenTelemetry tracing (optional)
- Row-level tenant isolation via Prisma extensions
- Rate limiting + audit log + webhooks API
- Prometheus metrics endpoint
- Docker, Docker Compose, Railway, Render, Fly.io, DigitalOcean templates

---

## Tech stack

| Layer | Tech |
|---|---|
| **Frontend** | Next.js 16 (App Router, Turbopack) · Tailwind v4 · Radix UI · Aperture design system |
| **Backend** | Fastify 5 · TypeScript 5.6 · Prisma 7 · PostgreSQL 15 · Redis 7 · BullMQ |
| **AI** | Gemini 2.0 Flash · Claude Sonnet 4.6 · GPT-4o — routed through `ModelRegistryService` |
| **Voice** | Gemini Live API · Twilio Media Stream |
| **Local agent** | Node daemon · WebSocket to backend · invokes your Claude Code CLI |
| **Auth** | JWT + httpOnly cookies · WorkOS SSO · scoped-per-tenant localStorage |
| **Testing** | Vitest (1,460+ tests) · Playwright (E2E smoke) |
| **Observability** | OpenTelemetry · structured JSON logs via pino |

---

## Roadmap

- [x] Meeting ingestion (upload, paste, Google Meet, voice dial-in)
- [x] Multi-model AI Council
- [x] Jira, Slack, GitHub, Google Chat / Drive / Docs / Meet, Twilio, SendGrid, Teams, WorkOS SSO integrations
- [x] **Linear** and **Notion** integrations — both GA
- [x] In-app integration wizards (zero `.env` editing after initial keys)
- [x] First-run setup wizard
- [x] BYOK UI for Claude / Gemini / OpenAI
- [x] Local agent for PR generation via your CLI subscription
- [x] Aperture design system — Impact pass (saturated indigo, bolder type, deeper contrast)
- [x] **Mobile-friendly approval queue** — single-pane on phones, thumb-sized CTAs
- [x] **Reply-to-approve via WhatsApp + SMS** (same token pool as email)
- [x] **Slack Events API bidirectional** — approvals + `@mention` agent dispatch in channels
- [x] **WhatsApp `@mention` agent dispatch** — ask `@ba status`, `@dev jobs`, etc. from your phone
- [x] One-click Docker deploy
- [ ] Tier-3 autonomous multi-agent chat (agents drive the conversation, not just respond) — [design doc](./docs/plans/tier-3-autonomous-multi-agent-chat.md)
- [ ] Auto skill distillation (successful trajectories → proposed skills → admin review)
- [ ] Outcome-based skill ranking (feed OutcomeObserver results back into skill priority)
- [ ] Railway / Render / Fly.io one-click templates — configs shipped, not platform-verified yet
- [ ] Asana / Salesforce connectors
- [ ] Telegram per-agent bot (inline Approve/Reject buttons)
- [ ] Hosted demo on `demo.workforce0.com`

See [issues](https://github.com/workforce0/workforce0/issues) and [discussions](https://github.com/workforce0/workforce0/discussions) for what's in flight.

---

## Contributing

We would love your help. Good first issues are tagged `good-first-issue`; integration PRs are always welcome.

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — setup, coding standards, PR process
- **Catalogs** — the contributor's index for every pluggable piece of the app:
  - [`docs/catalog/integrations.md`](./docs/catalog/integrations.md) — all 16 connectors + add-a-new walkthrough
  - [`docs/catalog/ai-providers.md`](./docs/catalog/ai-providers.md) — Gemini/Claude/OpenAI + add-a-new walkthrough
  - [`docs/catalog/agents.md`](./docs/catalog/agents.md) — BA, Architect, Dev, QA, Supervisor, Memory Optimizer + extend-an-agent walkthrough
- [`AGENTS.md`](./AGENTS.md) — if you work with Claude Code, Cursor, or Codex on this repo
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — be excellent to each other
- [`SECURITY.md`](./SECURITY.md) — report a vulnerability privately

### Repo layout

```
workforce0/
├── frontend/             Next.js 16 app (the UI you see in screenshots)
│   └── src/app/          App Router — (dashboard), (onboarding), login, signup, …
├── backend/              Fastify backend + Prisma + all agent services
│   ├── src/config/       Environment schema (zod)
│   ├── src/routes/       REST endpoints (auth, meetings, agents, settings, …)
│   ├── src/services/     BA agent, Architect, ModelRegistry, integrations, memory
│   ├── src/middleware/   Tenant isolation, rate limiting, auth
│   └── prisma/           Schema + migrations
├── agent/                Local daemon — runs on the user's machine, opens PRs
├── docs/                 Product + self-hosting guides, design system, BYOK
│   └── assets/           Logo, screenshots, diagrams
├── docker-compose.prod.yml   Full-stack deploy
└── .env.example          Root env for docker-compose.prod.yml
```

---

## Security

- All user input validated with Zod at every route boundary
- Prisma parameterized queries prevent SQL injection
- React auto-escapes output; cookies are httpOnly + sameSite
- AES-256-GCM encryption for integration secrets and AI keys at rest
- Per-tenant row-level isolation via Prisma `$extends` middleware
- Agent daemon prompts for approval on every job; one `y` keystroke approves exactly one job (not N — serialized by design)
- See [`SECURITY.md`](./SECURITY.md) to report vulnerabilities privately

---

## Credits

Two upstream projects shaped specific parts of this codebase — we reimplemented the ideas natively in TypeScript (so no Python runtime, no subscription-routing ToS concerns) but the debt is real and worth naming:

- **[safishamsi/graphify](https://github.com/safishamsi/graphify)** — the project-graph feature in `backend/src/services/project-graph/` is a native TS reimplementation of graphify's core ideas: AST-first extraction, EXTRACTED-vs-INFERRED edge tagging, god-node detection, community detection via graph topology (not embeddings), and the corpus-derived domain-aware Whisper prompt. Used in production by our chief-of-staff planner (injects top-5 god nodes as "project landmarks") and the PRD-to-code linker. Huge thanks to [@safishamsi](https://github.com/safishamsi).
- **[anthropics/skills](https://github.com/anthropics/skills)** — vendored directly into `vendor/skills/` as the seed library for the chief-of-staff planner's skill picks. Apache 2.0. See `vendor/README.md`.
- **[VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)** — vendored into `vendor/subagents/` as the seed library of role-specific subagent personas. See `vendor/README.md`.

---

## License

[MIT](./LICENSE) — free for personal and commercial use. Fork it, ship it, make it yours.

---

<div align="center">

**Built for teams who would rather make decisions than take notes.**

⭐ If this is useful, leave a star. It helps non-technical execs discover the project.

</div>
