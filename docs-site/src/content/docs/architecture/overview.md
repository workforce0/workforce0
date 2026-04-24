---
title: System overview
description: The moving parts, the data flow, where the trust boundary is.
---

## Components

```
             ┌─────────────────────────────────────────────┐
             │  BROWSER (audit UI) — Next.js / React 19    │
             └────────────┬────────────────────────────────┘
                          │ HTTPS
                          ▼
     ┌─────────────────────────────────────────────────────┐
     │  BACKEND — Fastify + TypeScript                     │
     │                                                     │
     │   Routes / Middleware (RLS, auth, rate-limit)       │
     │   Services (ChiefOfStaff, TicketService, AI...)     │
     │   Queue (BullMQ on Redis)                           │
     │   Prisma → Postgres                                 │
     │                                                     │
     └───┬──────────┬───────────────────┬──────────────────┘
         │          │                   │
         │          │                   │
         ▼          ▼                   ▼
   ┌─────────┐  ┌─────────┐        ┌──────────────┐
   │Postgres │  │ Redis   │        │ LLM providers │
   │         │  │         │        │ (BYOK)        │
   └─────────┘  └─────────┘        └──────────────┘
                                        │
                                        ▼
                                   ┌─────────────┐
                                   │Anthropic /  │
                                   │OpenAI /     │
                                   │Google /     │
                                   │Ollama       │
                                   └─────────────┘
         │
         ▼ Webhooks (Slack, Jira, Twilio, GitHub)
   ┌─────────────────────┐
   │ External systems    │
   └─────────────────────┘

                                   ┌──────────────────────┐
                                   │ AGENT DAEMON (local)  │
                                   │ on operator's machine │
                                   │                       │
                                   │  connects via WS to   │
                                   │  backend; claims dev/QA│
                                   │  tickets; runs Claude  │
                                   │  Code / Cursor CLI     │
                                   │  locally               │
                                   └──────────────────────┘
```

## Trust boundaries

Four distinct trust boundaries:

1. **Browser ↔ backend** — standard HTTPS + cookie auth.
2. **Backend ↔ LLM providers** — outbound TLS to Anthropic / OpenAI /
   Google; BYOK keys in the backend's encrypted vault.
3. **Backend ↔ external integrations** — signed webhooks both
   directions (Slack HMAC, Twilio auth, GitHub webhook secret).
4. **Backend ↔ agent daemon** — WebSocket with pre-shared token; the
   agent runs on a different machine than the backend (usually a
   developer laptop).

Production source code never leaves the operator's machine — it
lives behind boundary 4. The backend only sees the agent's HTTP
responses (ticket results), never the codebase.

## Data flow: brief lifecycle

```
Meeting uploaded / voice call / transcript pasted
   │
   ▼  (transcription if needed)
Transcript
   │
   ▼  (ChiefOfStaffService.draftBrief)
Brief (PRD.status = pending_approval)
   │
   ▼  (comms broadcast — Slack / Teams)
Brief posted to exec
   │
   ▼  (exec taps Approve)
Brief.status = approved
   │
   ▼  (ChiefOfStaffService.planTicket)
ExecutionPlan + N child Tickets enqueued
   │
   ▼  (Specialist agents claim)
Child Tickets transition through pending → in_progress → done/failed
   │
   ▼  (on failed, ChiefOfStaff.replan)
New ExecutionPlan (attempt 2); supersedes old
   │
   ▼  (all tickets done)
Brief.status = completed
```

## Key design choices

### Single database, multi-tenant

One Postgres; every tenant-scoped row has a `tenantId` column; RLS
middleware enforces scope on every read. No DB-per-tenant. Simpler
ops, slightly harder to isolate "noisy neighbours" — unimportant
for a self-hosted single-org deployment.

### Queue on Redis

BullMQ on a single-shard Redis. No Redis Cluster. Acceptable for
<100 concurrent tickets; beyond that consider sharding by tenant.

### Stateless backend

Each backend instance is stateless. Scale horizontally. One instance
must own the cron scheduler (see
[Docker Compose](/self-hosting/docker-compose/)).

### BYOK throughout

Never resold tokens. Never cached prompts on our servers for other
tenants. Model calls always use tenant-owned keys. Encryption at
rest for the keys (AES-256-GCM, key derived from `JWT_SECRET`).

### Agent daemon out-of-process

Code-gen runs on the operator's laptop. Benefits: local subscription
vs API cost; production code never transits. Downside: the operator
has to keep the daemon alive.

### No in-cluster ML

We don't ship or train models. Everything is called over HTTP —
OpenAI / Anthropic / Gemini APIs or an OpenAI-compatible local
endpoint.

## Hotspots

- **`planner-llm.ts`** — the chief-of-staff prompt assembly, self-
  consistency, critique-and-revise. Most product value, most
  prompt-tuning tension.
- **`project-graph/`** — AST extraction and graph service. Feeds the
  planner; drives the Code Graph UI.
- **`queues/`** — BullMQ setup, one queue per role.
- **`routes/webhooks/`** — inbound from every external system. Must
  verify signatures.
- **`lib/rls-prisma.ts`** — the Prisma middleware that enforces
  tenant scope. Don't bypass.

## Deployment profiles

- **Single host (hobbyist)**: all five containers on one VM. Simple.
- **Compute-split**: backend + frontend on VMs; Postgres + Redis on
  managed services. Most teams.
- **Cluster**: multiple backend replicas on k8s + external
  Postgres / Redis. Needed at scale.

See [Docker Compose](/self-hosting/docker-compose/),
[Kubernetes](/self-hosting/kubernetes/),
[Cloud platforms](/self-hosting/cloud-platforms/).
