---
title: Docker Compose
description: The reference self-hosting path. Five containers, one docker-compose.prod.yml, one .env.
---

## Overview

`docker-compose.prod.yml` is the canonical production profile. It
defines five services:

| Service     | Image                          | Purpose                          |
| ----------- | ------------------------------ | -------------------------------- |
| `postgres`  | `postgres:16-alpine`           | Primary database                 |
| `redis`     | `redis:7-alpine`               | Queue, cache, pub/sub            |
| `backend`   | built from `backend/Dockerfile` | Fastify API + worker runtime    |
| `frontend`  | built from `frontend/Dockerfile` | Next.js audit UI (static)     |
| `agent`     | built from `agent/Dockerfile`   | Local user-side daemon (optional) |

## Minimum viable `.env`

```bash
# Database
DATABASE_URL=postgresql://postgres:<password>@postgres:5432/workforce0
POSTGRES_PASSWORD=<generate>

# Redis
REDIS_URL=redis://redis:6379

# Auth
JWT_SECRET=<32+ chars; `openssl rand -hex 32`>

# At least one AI provider (BYOK)
GEMINI_API_KEY=              # free tier is fine for start
ANTHROPIC_API_KEY=           # any subset of these is fine
OPENAI_API_KEY=
```

Everything else is optional and defaults sensibly.

## First boot

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f backend
```

Watch for:

```
[backend] Prisma migrations applied (N)
[backend] Seeded N skills and N subagents
[backend] Listening on :3000
[backend] Ready
```

~45 seconds on warm hardware, ~3 minutes on a cold VM.

## Day-two operations

### Updating

```bash
git pull
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
# Migrations auto-apply on backend start. Zero-downtime for minor
# schema changes; breaking changes are gated via the audit-2026-04-18
# upgrade note (see docs/ repo).
```

### Restarting one service

```bash
docker compose -f docker-compose.prod.yml restart backend
```

Queue state (BullMQ) and DB state survive restarts. In-flight LLM
calls do NOT — the queue retries them with fresh prompts.

### Logs

```bash
# Live tail, per service
docker compose -f docker-compose.prod.yml logs -f backend

# Full history
docker compose -f docker-compose.prod.yml logs --tail=2000 backend > backend.log
```

Log lines include `requestId` and `tenantId` — grep on these for
request-scoped triage.

### Health checks

All services have native health checks. The `depends_on` chains boot
Postgres first, then Redis, then backend + frontend. If a service
repeatedly restarts, something's unhealthy — check that service's
logs first, Postgres / Redis logs next.

## Scaling

### Vertical

Give `backend` more CPU. One `backend` container handles ~25 concurrent
AI calls cleanly; beyond that the Redis BullMQ pool becomes the
bottleneck.

### Horizontal

Run multiple `backend` replicas:

```yaml
backend:
  deploy:
    replicas: 3
```

`backend` is stateless. Postgres and Redis stay single-instance (use
managed services for real scale).

Note: only one replica should claim the **cron scheduler** role. Set
`WORKFORCE0_CRON_ENABLED=1` on exactly one; others get `=0`. A
distributed lock would be nicer; it's on the roadmap.

### Agent daemon

The `agent` container runs the local code-gen daemon — this is the
thing that uses your CLI subscription (Claude Code, Cursor) for dev /
QA tickets. Run one instance per operator machine that wants to own
code-gen.

Alternatively: don't run it in Docker at all; run `npm run agent:dev`
on your developer laptop. See [Agent daemon](/architecture/agent-daemon/).

## File layout on the host

```
~/.local/share/workforce0/          # default data volume root
├── postgres/                       # DB files
├── redis/                          # AOF
├── uploads/                        # meeting audio (ephemeral by default)
└── logs/                           # rotated
```

Configurable via `VOLUMES_ROOT=/custom/path` in the compose file.

## Reverse proxy in front

Never expose the containers directly. Always run behind a TLS
terminator.

### Caddy (simplest)

```caddy
workforce0.example.com {
  reverse_proxy localhost:3001       # frontend
  handle /api/* {
    reverse_proxy localhost:3000     # backend
  }
}
```

### Traefik / nginx / Cloudflare Tunnel

Work identically. The only constraint: both `/api/*` and `/` must
land on the same origin, or you need to set `CORS_ORIGINS` on the
backend to the frontend's origin.

## Uninstall

```bash
docker compose -f docker-compose.prod.yml down -v
rm -rf ~/.local/share/workforce0
```

`down -v` drops volumes — you lose all meetings, briefs, tickets.
Back up first if there's anything to keep.

## Backups

See [Backups & restore](/self-hosting/backups/) for the full recipe.
TL;DR:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -Fc -U postgres workforce0 > workforce0-$(date +%F).dump
```

Cron this nightly. Test a restore quarterly.
