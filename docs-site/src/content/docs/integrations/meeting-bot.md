---
title: Meeting Bot
description: Two options for live meeting capture — self-hosted Vexa (BYO endpoint) or manual upload.
---

Workforce0 supports two modes for capturing live meetings. Pick the one that fits your install.

## Option 1 — Vexa (self-hosted, BYO)

Workforce0 supports Vexa as a meeting-capture backend, but does **NOT currently bundle Vexa's containers**. Vexa's stack has 7+ services (admin-api, runtime-api, api-gateway, meeting-api, mcp, dashboard, tts-service) plus MinIO, Redis, and Postgres dependencies — bundling them sensibly alongside the Workforce0 base stack is non-trivial, and the maintainers have deferred that work.

### Run Vexa separately, then point Workforce0 at it

To use Vexa, deploy it on its own following [Vexa's deployment guide](https://github.com/Vexa-ai/vexa/tree/main/deploy), then set `VEXA_API_URL` in your `.env` to point at it:

```bash
VEXA_API_URL=http://your-vexa-host:18056
```

Workforce0's `VexaProvider` calls the following endpoints on the configured URL:

- `POST /bots` — schedule a bot to join a meeting
- `GET /bots/:id/transcript` — fetch the transcript when the meeting ends
- `GET /bots/:id` — poll bot status
- `DELETE /bots/:id` — cancel a scheduled bot
- `GET /health` — readiness probe used by the integration-status aggregator

> **Caveat:** these endpoints reflect Workforce0's **expected contract** with Vexa. Vexa's actual API surface may have drifted — verify against [Vexa's docs](https://github.com/Vexa-ai/vexa) before relying on this in production. If your Vexa version exposes differently-named routes, the abstraction is small enough to fork — see `backend/src/services/meeting-bot/providers/vexa.provider.ts`.

Tracking issue for first-class bundling work: [#37](https://github.com/workforce0/workforce0/issues/37).

## Option 2 — Skip (manual upload only)

Don't enable Vexa. Users upload recordings after the meeting via the two-step presigned-upload flow: `POST /api/meetings/upload/presign` to mint a URL, then `POST /api/meetings/:id/upload/complete` once the file is uploaded. Always works.

## How the router picks

If a tenant has a preferred provider in `tenantSettings.meetingBotProviderId`, that's tried first. Otherwise the order is `vexa → manual`. Each provider's `isAvailable()` is checked at request time, so an unavailable Vexa endpoint falls through to "please upload" (HTTP 503 `NO_BOT_PROVIDER`).

> **Why no Recall.ai option?** Earlier versions of this page documented a BYOK Recall.ai integration. That code was removed during PR #38 review (2026-04-25) to reduce surface area; only Vexa (BYO) and Manual remain.
