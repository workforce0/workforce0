# Workforce0 — Backend

Fastify + TypeScript + Prisma 7 + PostgreSQL 15 + Redis 7 + BullMQ.

**For install, screenshots, architecture, and BYOK instructions see the
[root README](../README.md).** This file is for contributors who want to
run the backend directly instead of via Docker Compose.

---

## Run it standalone (dev)

```bash
# 1. Infra (just Postgres + Redis, not the backend)
docker compose -f ../docker-compose.prod.yml up -d postgres redis
# or bring your own — set DATABASE_URL / REDIS_URL below.

# 2. Install deps + generate the Prisma client
npm install
npx prisma generate

# 3. Config
cp .env.example .env
# edit: DATABASE_URL, REDIS_URL, JWT_SECRET (32+ chars), GEMINI_API_KEY

# 4. Apply the schema (first time only)
npx prisma migrate deploy
#   — or `npx prisma db push` if you're iterating on the schema without
#     wanting migration files yet.

# 5. Start with hot reload
npm run dev
# -> http://localhost:3000

# 6. Sanity check
curl http://localhost:3000/health
# -> { "status": "ok", "services": { "database": "connected", ... } }
```

The frontend lives in `../frontend` — see [`../frontend/README.md`](../frontend/README.md).

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the API with `tsx watch` (hot reload) |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | Run the built output (what Docker uses) |
| `npm test` | 1,400+ unit + integration tests via Vitest |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` strict check |
| `npm run db:generate` | Re-emit the Prisma client after a schema change |
| `npm run db:migrate` | Create a migration from current schema diff (dev) |
| `npm run db:deploy` | Apply pending migrations (prod — idempotent) |
| `npm run db:push` | Sync schema without generating a migration (dev only) |
| `npm run db:studio` | Open Prisma Studio |

## Project layout

```
backend/
├── prisma/
│   ├── schema.prisma           single source of truth for the DB
│   └── migrations/             version-controlled migrations (prod uses `migrate deploy`)
├── scripts/
│   └── docker-entrypoint.sh    runs `migrate deploy` then starts the server
├── src/
│   ├── config/                 zod-validated env loader
│   ├── lib/                    logger, di-container, prisma helpers
│   ├── repositories/           data-access layer (prisma queries)
│   ├── routes/                 REST + webhook endpoints
│   ├── services/               agents, integrations, queue, storage, orchestrator, …
│   ├── middleware/             tenant isolation, auth, rate limiting
│   ├── types/                  shared TS types
│   └── voice/                  Gemini Live API + Twilio Media Stream
└── __tests__/                  vitest — 95 files, 1,400+ cases
```

## Key design choices

- **All AI calls go through `ModelRegistryService`.** Product code never
  imports provider SDKs directly — swap Gemini/Claude/GPT without
  touching any agent. See `src/services/model-registry/`.
- **Graceful degradation.** Any optional integration (Jira, Slack, S3,
  Twilio, GitHub, …) disables cleanly when its env vars are unset. No
  crash on boot, no angry runtime errors — just a `isEnabled()` → false
  and a clean 503 from the relevant endpoint.
- **Storage defaults to local filesystem.** S3 is opt-in via
  `STORAGE_DRIVER=s3` or `AWS_S3_BUCKET`. Zero cloud dependency by
  default. See `src/services/storage/`.
- **Row-level tenant isolation.** Prisma `$extends` middleware injects
  `tenantId` filters on every query. See `src/lib/tenant-prisma.ts`.
- **Background work via BullMQ.** Meeting transcription, nightly Hermes
  distillation + rerank, email digest — all queued to Redis. See
  `src/services/queue/`.

## Running against your own infra

Set these in `.env` and you can point at anything:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_URL=redis://host:6379/0
# Optional HA
REDIS_SENTINEL_HOSTS=sentinel1:26379,sentinel2:26379
REDIS_SENTINEL_MASTER=mymaster
REDIS_PASSWORD=...
```

Full env reference: [`.env.example`](./.env.example).

## Tests

```bash
npm test                 # full suite
npm test -- --reporter=verbose
npm test src/services/storage    # scoped to one dir
```

Tests mock external services (BullMQ, Prisma, Gemini, S3, ioredis) via
`vi.hoisted` + `vi.mock` so no real infra is required.

## Contributing

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md). The [`docs/catalog/`](../docs/catalog/)
folder has walkthroughs for adding a new AI provider, integration, or
agent.
