---
title: Meeting Bot
description: Three options for live meeting capture — self-hosted Vexa (BYO endpoint), Recall.ai BYOK, or manual upload.
---

Workforce0 supports three modes for capturing live meetings. Pick the one that fits your install.

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

Tracking issue for first-class bundling work: [#TBD](https://github.com/workforce0/workforce0/issues).

## Option 2 — Recall.ai (BYOK)

If you'd rather a vendor-managed option, bring your own Recall.ai key.

### Enable

Set in `.env`:

```bash
RECALL_API_KEY=your-recall-key
RECALL_WEBHOOK_SECRET=your-webhook-signing-secret
# Optional — override regional endpoint. Defaults to us-west-2.
# RECALL_API_BASE_URL=https://eu-central-1.recall.ai/api/v1
```

Configure Recall to send webhooks to `https://your-host/webhooks/meeting-bot/recall`. The `RECALL_WEBHOOK_SECRET` is used to verify the `x-recall-signature` HMAC on every event.

Recall.ai is regionalized — if your account lives in `us-east-1` or `eu-central-1`, set `RECALL_API_BASE_URL` to match. See [Recall's regions docs](https://docs.recall.ai/docs/regions) for the full list.

### Cost

~$0.50/hour of meeting recorded (consult Recall.ai pricing for current rates).

### Trade-offs

- Most reliable joins (Recall handles SSO/captcha edge cases).
- Audio leaves your network and is processed by Recall's infrastructure.

## Option 3 — Skip (manual upload only)

Don't enable any of the above. Users upload recordings via the existing `/api/meetings/upload` endpoint after the meeting. Always works.

## How the router picks

If a tenant has a preferred provider in `tenantSettings.meetingBotProviderId`, that's tried first. Otherwise the order is `vexa → recall → manual`. Each provider's `isAvailable()` is checked at request time, so an unavailable Vexa endpoint falls through to Recall (if configured), then to "please upload" (HTTP 503 `NO_BOT_PROVIDER`).
