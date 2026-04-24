---
title: Cloud platforms (one-click deploy)
description: Railway, Render, Fly.io, DigitalOcean — fast paths for teams without their own infra.
---

## TL;DR

Each platform offers a one-click deploy button that reads the
repo's `deploy.json` and provisions the services automatically. You
still need BYOK keys — paste them into the provisioned dashboard's
env-var section.

| Platform   | Cost (starter) | Cold-start | Best for                         |
| ---------- | -------------- | ---------- | -------------------------------- |
| Railway    | ~$10/mo        | instant    | Solo operators, small teams     |
| Render     | ~$15/mo        | instant    | Moderate scale, clean TLS       |
| Fly.io     | ~$8/mo (3 machines) | ~2s | Global, multi-region            |
| DigitalOcean App Platform | ~$15/mo | instant | Teams already on DO droplets |

All of them work. Ignore the marketing copy — pick based on which
dashboard you already know.

## Railway

1. Click [Deploy to Railway](https://railway.app/new/template/workforce0).
2. Sign in. Railway provisions:
   - `backend` (Node)
   - `frontend` (Node)
   - `postgres` (managed)
   - `redis` (managed)
3. The template pre-fills env vars. You only need to add your BYOK
   keys:
   - `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` or `GEMINI_API_KEY`
4. Deploy. Open the generated URL.
5. You're in the setup wizard.

### Production-ready Railway

- **Custom domain.** Railway → Settings → Domains → add yours.
  Automatic TLS via Let's Encrypt.
- **Postgres backups.** Railway backs up nightly; configurable to
  hourly on paid plans.
- **Logs.** Railway's log viewer is usable. For long retention, pipe
  to Logtail / Axiom / Better Stack.

## Render

1. [Deploy to Render](https://render.com/deploy?repo=https://github.com/workforce0/workforce0).
2. Render reads `render.yaml` and provisions services.
3. Add BYOK keys in the Render dashboard (one service at a time).
4. First deploy takes ~5 min; subsequent deploys ~2 min.

### Render specifics

- **Render Postgres** has a free tier but it's deleted after 90 days
  of inactivity. Upgrade for anything real.
- **Static frontend option.** You can deploy the frontend as a
  Render static site (cheaper) — the template does this by default.
- **Background workers** (queue consumers) share the backend service;
  Render doesn't need a separate worker.

## Fly.io

1. Install `flyctl`.
2. ```bash
   git clone https://github.com/workforce0/workforce0
   cd workforce0
   fly launch
   ```
3. `fly launch` reads `fly.toml`, asks confirmation, provisions:
   - Backend app (3 machines across regions)
   - Frontend app
   - Postgres cluster (`fly pg create`)
   - Upstash Redis (`fly ext redis create`)
4. Set BYOK keys:
   ```bash
   fly secrets set ANTHROPIC_API_KEY=...
   fly secrets set JWT_SECRET=$(openssl rand -hex 32)
   ```
5. `fly deploy`.

### Fly specifics

- **Multi-region by default.** Backend scales to zero when idle;
  scales up on the first request. ~2 second cold-start.
- **Upstash Redis** is single-region; the backend's BullMQ setup
  handles the cross-region latency fine at <100ms.
- **Volumes for uploads.** `fly volumes create workforce0_uploads`
  and mount in `fly.toml`.

## DigitalOcean App Platform

1. [Deploy to DO](https://cloud.digitalocean.com/apps/new?repo=https://github.com/workforce0/workforce0).
2. App Platform reads `.do/app.yaml` and provisions components.
3. Add BYOK keys in the component settings.
4. Deploy.

### DO specifics

- **Managed Postgres add-on** — $15/mo, minimum. DO's `DATABASE_URL`
  has SSL mandatory; already handled.
- **Managed Redis** — $15/mo additional. Cheaper to run Redis as a
  worker component on a $5 droplet for hobby.
- **Nice TLS story** — `*.ondigitalocean.app` has automatic TLS, with
  your own domain just a CNAME.

## What you can't do on one-click platforms

- Run the **agent daemon** for code-gen — it needs your local CLI
  subscription. Leave `agent` disabled.
- **Truly high-scale workloads** — once you're over 100 concurrent
  briefs, move to Kubernetes.
- **Network-isolate Postgres** — PaaS Postgres is always reachable
  over the internet with credentials. Fine for most; not for
  compliance-heavy workloads.

## Migrating between platforms

All four platforms expose a Postgres connection string. To migrate:

```bash
# On the old platform
pg_dump -Fc -d $OLD_DATABASE_URL > dump

# On the new platform
pg_restore -d $NEW_DATABASE_URL dump
```

Point the new platform's backend at the restored DB, deploy, done.
Zero data loss as long as you pause the old deployment during the
dump.

## Costs

Rough monthly bills at typical usage (100 briefs / month):

| Platform    | App tier | Postgres | Redis | Total    |
| ----------- | -------- | -------- | ----- | -------- |
| Railway     | $10      | included | included | ~$10    |
| Render      | $7       | $7       | $10   | ~$24    |
| Fly.io      | $8       | $0 (dev) | $10 (Upstash) | ~$18 |
| DO          | $12      | $15      | $15   | ~$42    |

BYOK API costs are additional and depend on your model mix — see
[Cost caps](/byok/cost-caps/).
