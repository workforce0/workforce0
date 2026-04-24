---
title: Installation
description: Full self-hosting install guide — prerequisites, first boot, wizard walkthrough, verification.
---

:::note[Audience]
Installer. If you want to move fast instead of read thoroughly, use
the [Quickstart](/getting-started/quickstart/) and only come back here
when something breaks.
:::

## Prerequisites

### Required

- **Docker ≥ 24** (or Podman ≥ 4.6 with a compose shim).
- **2 CPU cores, 4 GB RAM free** for the stack. First build of the
  project graph on a large repo wants an extra 2 GB transiently.
- **~3 GB disk** for the containers + 5–20 GB for your Postgres
  (meetings, briefs, transcripts accumulate).
- **One AI provider API key.** Gemini free tier is fine to start.

### Recommended

- **HTTPS terminator in front** — Caddy, Traefik, Cloudflare Tunnel,
  or nginx with Let's Encrypt. The containers don't terminate TLS
  themselves.
- **A dedicated Postgres** (managed or self-hosted) instead of the
  containerized one, once you commit. Easier backups.
- **A non-root user** on the host to own the data volumes
  (`appuser:1001` is the container default).

## Install paths

Pick one. All produce the same runtime. Differences are operational.

### 1. Docker Compose (reference path)

Most self-hosted installs live here. See the
[Docker Compose guide](/self-hosting/docker-compose/) for the detailed
`docker-compose.prod.yml` walkthrough. The short version:

```bash
git clone https://github.com/workforce0/workforce0
cd workforce0
cp .env.example .env        # set at least JWT_SECRET, POSTGRES_PASSWORD, one AI key
docker compose -f docker-compose.prod.yml up -d
```

### 2. Kubernetes (Helm chart)

If you already have a cluster:

```bash
helm repo add workforce0 https://charts.workforce0.dev
helm install workforce0 workforce0/workforce0 \
  --set env.JWT_SECRET=$(openssl rand -hex 32) \
  --set secrets.anthropicApiKey=$ANTHROPIC_API_KEY
```

Full values reference: [Kubernetes install](/self-hosting/kubernetes/).

### 3. One-click deploy

Aim these at fresh accounts — they won't read your existing env.

- [Deploy to Railway](https://railway.app/new/template/workforce0)
- [Deploy to Render](https://render.com/deploy?repo=https://github.com/workforce0/workforce0)
- [Deploy to Fly.io](https://fly.io/apps/new?template=workforce0)
- [Deploy to DigitalOcean App Platform](https://cloud.digitalocean.com/apps/new?repo=https://github.com/workforce0/workforce0)

Full walkthroughs: [Cloud platforms](/self-hosting/cloud-platforms/).

### 4. Bare-metal / VM

Supported but unopinionated. Run Node ≥ 20, Postgres ≥ 16, Redis ≥ 7.
See the `docker-compose.prod.yml` file for the exact command matrix.

## First-boot wizard

After the stack is reachable, point your browser at the **frontend
container's port** (default `:3001`). You'll see the setup wizard.

### Step 1 — workspace name

Cosmetic. Shows up in Slack messages: _"Hi from Acme's Workforce0."_

### Step 2 — AI providers

Paste the key you already set in `.env`. The wizard validates each key
against the provider's models endpoint — a red badge means the key is
invalid before you move on.

You can add multiple providers. The first works; adding more enables
the **AI Council** consensus feature — see [AI Council](/features/ai-council/).

### Step 3 — first integration

Pick one comms channel (Slack, Teams, WhatsApp, Google Chat). The wizard
walks you through creating a webhook URL on the provider's side and
pasting it back. Without this step the chief-of-staff has nowhere to
post.

### Step 4 — finish

The wizard writes its state to the `setup_status` table and redirects
to the dashboard. Re-running the wizard from the URL is safe — it
reads the existing state and skips completed steps.

## Verifying the install

### From the web UI

1. Dashboard loads without errors.
2. **Integrations** page shows at least one green ✓.
3. **Settings → AI** shows your provider(s) with "OK" badges.

### From the CLI

```bash
# Backend health
curl -s http://localhost:3000/api/health | jq .
# Expected: {"ok":true,"services":{"postgres":"up","redis":"up",…}}

# Queue worker health
curl -s http://localhost:3000/api/health/queues | jq .
# Expected: a list of named queues, all "ready".

# Agent daemon handshake (only if you're running the local agent)
curl -s http://localhost:3000/api/agents/ping -H "X-Agent-Token: $TOKEN"
```

### Smoke test (end-to-end)

```bash
# From inside the backend container
docker compose -f docker-compose.prod.yml exec backend \
  npm run smoke-test
```

This seeds a fake meeting, generates a brief against your AI keys,
fans out child tickets, and prints a PASS/FAIL report. Use it in CI
when you upgrade.

## What next?

- Connect the integrations the exec will need: [Integrations](/integrations/jira/).
- Wire up BYOK cost caps before the team starts using it heavily:
  [Cost caps](/byok/cost-caps/).
- Read the security checklist before exposing the instance publicly:
  [Security](/self-hosting/security/).
