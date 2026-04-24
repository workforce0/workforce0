---
title: Development setup
description: Getting a local development environment running.
---

## Prereqs

- Node.js ≥ 20 LTS.
- Docker (for Postgres + Redis via the compose dev profile).
- A GitHub account with access to the repo.

## Clone + install

```bash
git clone https://github.com/workforce0/workforce0
cd workforce0
git submodule update --init --recursive   # vendored skills + subagents

cd backend && npm install
cd ../frontend && npm install
cd ../agent && npm install
cd ../docs-site && npm install
```

## Boot infra

Lightweight dev profile brings up Postgres + Redis only:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Check health:

```bash
docker compose -f docker-compose.dev.yml ps
```

## Environment

```bash
cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/workforce0
#   REDIS_URL=redis://localhost:6379
#   JWT_SECRET=<openssl rand -hex 32>
#   GEMINI_API_KEY=...  (or any other provider)
```

## Run the services

```bash
# Terminal 1 — backend
cd backend
npm run db:generate
npm run db:migrate
npm run dev                # http://localhost:3000

# Terminal 2 — frontend
cd frontend
npm run dev                # http://localhost:3001

# Terminal 3 — docs site (this site, while you're editing docs)
cd docs-site
npm run dev                # http://localhost:4321

# Terminal 4 — agent daemon (optional; for dev/QA code-gen)
cd agent
WORKFORCE0_AGENT_TOKEN=<from-UI> npm run dev
```

## Database UI

```bash
cd backend
npm run db:studio          # Prisma Studio at localhost:5555
```

## Project scripts

Per-workspace scripts:

**backend**
- `npm run dev` — auto-restart on change.
- `npm run build` — production build.
- `npm run start` — run the production build.
- `npm test` — Vitest unit + integration.
- `npm run typecheck` — TS strict pass.
- `npm run lint` — ESLint.

**frontend**
- `npm run dev` — Next.js dev server.
- `npm run build` — static export.
- `npm run start` — serve build.
- `npm test` — Vitest.
- `npm run e2e` — Playwright.
- `npm run typecheck` — TS pass.

**docs-site**
- `npm run dev` — Astro dev.
- `npm run build` — static build.
- `npm run preview` — preview build.

## Git workflow

1. Branch: `git checkout -b feat/short-name`.
2. Commit convention: `feat: …`, `fix: …`, `refactor: …`, `docs: …`,
   `test: …`, `chore: …`.
3. Push: `git push -u origin feat/short-name`.
4. Open PR against `main`. CI runs typecheck + tests + e2e.
5. Address review; rebase if needed; merge.

## Pre-commit checks

We use a lightweight pre-push hook (`.husky/`):

- `npm run typecheck` (per workspace).
- `npm test` on changed workspaces.

Bypass with `--no-verify` only for emergency fixes; the CI still
runs them.

## Code style

- TypeScript strict mode. No `any` unless genuinely dynamic.
- Prettier + ESLint for formatting / lint.
- 2-space indent. Semicolons.
- Comments only when the "why" isn't obvious from the code.

## Testing discipline

- Unit tests live in `__tests__/` next to the code.
- Integration tests hit real Postgres + Redis (see the
  `workforce0-test-*` dev containers).
- Mock LLM clients in unit tests; real LLMs in integration tests
  only when behind a feature flag.
- Aim for coverage on business logic services. UI components get
  e2e coverage.

## Schema changes

1. Edit `backend/prisma/schema.prisma`.
2. `cd backend && npx prisma migrate dev --name descriptive_name`.
3. Verify the generated SQL in `prisma/migrations/`.
4. Commit the migration file.

## What NOT to do

- Don't commit `.env`.
- Don't commit node_modules.
- Don't bypass the RLS middleware.
- Don't import provider SDKs directly — go through
  `ModelRegistryService`.
- Don't `rm -rf node_modules` as your first debugging step.
