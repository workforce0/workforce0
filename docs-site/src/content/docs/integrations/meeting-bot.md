---
title: Meeting Bot
description: Three options for live meeting capture — bundled (Vexa), Recall.ai BYOK, or manual upload.
---

Workforce0 supports three modes for capturing live meetings. Pick the one that fits your install.

## Option 1 — Bundled (Vexa)

The simplest path. Workforce0 ships a Vexa stack as an opt-in Compose profile. No external account, no API key, audio stays on your host.

### Enable

Add `meeting-bot` to your active profiles (the wizard does this for you):

```bash
COMPOSE_PROFILES=meeting-bot docker compose -f docker-compose.prod.yml up -d
```

This adds three containers:

| Container | What it does |
|---|---|
| `workforce0-vexa-api` | HTTP API for scheduling/canceling bots |
| `workforce0-vexa-bot-manager` | Spawns per-meeting Chrome bot containers |
| `workforce0-docker-socket-proxy` | Whitelists `containers.{create,start,stop,inspect}` so bot-manager can spawn bots without root-on-host access |

### Security note

The bot-manager needs Docker control to spawn per-meeting containers. We isolate this through a socket proxy ([tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)) that whitelists only specific Docker API calls. If bot-manager were ever compromised, the attacker could spawn/kill containers but could not exec arbitrary commands or mount host paths.

### Existing installs

Vexa needs a separate database (`workforce0_vexa`) on your existing Postgres. New installs get this automatically via `backend/db-init/01-create-vexa-db.sql`. **For existing installs**, create it manually once:

```bash
docker compose exec postgres psql -U postgres -c "CREATE DATABASE workforce0_vexa"
```

## Option 2 — Recall.ai (BYOK)

If you'd rather a vendor-managed option, bring your own Recall.ai key.

### Enable

Set in `.env`:

```bash
RECALL_API_KEY=your-recall-key
RECALL_WEBHOOK_SECRET=your-webhook-signing-secret
```

Configure Recall to send webhooks to `https://your-host/webhooks/meeting-bot/recall`. The `RECALL_WEBHOOK_SECRET` is used to verify the `x-recall-signature` HMAC on every event.

### Cost

~$0.50/hour of meeting recorded (consult Recall.ai pricing for current rates).

### Trade-offs

- Most reliable joins (Recall handles SSO/captcha edge cases).
- Audio leaves your network and is processed by Recall's infrastructure.

## Option 3 — Skip (manual upload only)

Don't enable any of the above. Users upload recordings via the existing `/api/meetings/upload` endpoint after the meeting. Always works.

## How the router picks

If a tenant has a preferred provider in `tenantSettings.meetingBotProviderId`, that's tried first. Otherwise the order is `vexa → recall → manual`. Each provider's `isAvailable()` is checked at request time, so an unavailable Vexa stack falls through to Recall (if configured), then to "please upload" (HTTP 503 `NO_BOT_PROVIDER`).
