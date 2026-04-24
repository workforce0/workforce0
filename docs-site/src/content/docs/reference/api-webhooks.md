---
title: Webhook payloads
description: Inbound webhooks we accept, signature verification, and payload shapes.
---

## Why this exists

Every integration has inbound webhooks (Slack button clicks, Twilio
call events, GitHub push, Jira issue transitions, Google Drive
channel updates). They all land at `POST /api/webhooks/:source`.

Each handler:

1. Verifies the signature (per-provider mechanism).
2. Parses the payload.
3. Dispatches to the relevant service.
4. Returns a 200 even on "ignored" events so the provider doesn't
   retry.

## Signature verification

| Source        | Mechanism                          | Header(s)                                 |
| ------------- | ---------------------------------- | ----------------------------------------- |
| Slack         | HMAC-SHA256 with signing secret    | `X-Slack-Signature`, `X-Slack-Request-Timestamp` |
| Twilio        | Twilio's `validateRequest`         | `X-Twilio-Signature`                      |
| GitHub        | HMAC-SHA256 with webhook secret    | `X-Hub-Signature-256`                     |
| Jira          | Shared secret in query string      | `?secret=…`                               |
| Google Drive  | Channel token in header            | `X-Goog-Channel-Token`                    |

All verified in `backend/src/lib/webhook-verify.ts` with tests that
exercise every path. Never bypass.

## Slack payload shape

```json
{
  "type": "block_actions",
  "user": { "id": "U...", "name": "..." },
  "actions": [{ "action_id": "approve", "value": "brief:pr_..." }],
  "team": { "id": "T..." },
  "channel": { "id": "C..." },
  "response_url": "..."
}
```

Our handler maps `action_id` to:

- `approve` / `redirect` / `pause` — brief actions.
- `resume` — un-pause.
- `ack` — dismiss a notification.

## Twilio voice

Two events:

```
POST /api/webhooks/twilio   (incoming call)
  → body: CallSid, From, To, …
  → response: TwiML XML opening a Media Stream
```

```
POST /api/webhooks/twilio/status
  → body: CallSid, CallStatus (ringing / in-progress / completed / failed)
```

The Media Stream URL is `/api/voice/media-stream?callId=…`.

## GitHub push

```json
{
  "ref": "refs/heads/main",
  "repository": {
    "full_name": "acme/app",
    "default_branch": "main"
  },
  "head_commit": { "id": "abc..." }
}
```

Only `ref == refs/heads/<default_branch>` triggers a project-graph
rebuild. Other refs are acknowledged and ignored.

## Jira issue events

```json
{
  "webhookEvent": "jira:issue_updated",
  "issue": {
    "key": "ACME-123",
    "fields": {
      "status": { "name": "Done" },
      "labels": ["wf0:ticket:tk_..."]
    }
  }
}
```

We look at the `wf0:ticket:<id>` label to map back to our `Ticket`
row. Without the label, the event is ignored.

## Google Drive push channel

```
X-Goog-Channel-Id: <channel-uuid>
X-Goog-Resource-State: update | add | remove
X-Goog-Resource-Id: <drive-resource-id>
X-Goog-Changed: content
```

No body. We match `X-Goog-Channel-Token` to a connected integration;
then call Drive's API to diff the watched folder and pull new files.

## Idempotency

We de-duplicate by:

- `X-Hub-Delivery` (GitHub) — cached for 24h.
- `(CallSid, CallStatus)` pairs (Twilio).
- `(team, ts)` pairs on Slack interactivity.

Replays return the original response without side effects.

## Retries

Providers retry failed webhooks with their own backoff. Our handler
returns 200 for "accepted, processing async" and non-2xx only for
signature verification failures (which shouldn't retry — the
signature won't magically validate).

For jobs that fail async (transcription, brief drafting), we record
the failure and surface it in the Activity feed, but the provider's
webhook returns 200.

## Adding a new inbound source

See [Adding an integration](/contributing/adding-integration/) for
the recipe. Rough shape:

1. Add a signature-verifier function in `lib/webhook-verify.ts`.
2. Add a route handler in `routes/webhooks/<source>.routes.ts`.
3. Wire it into `routes/webhooks/index.ts`.
4. Add tests covering both valid and invalid signatures.

## Outbound webhooks

Workforce0 also emits outbound webhooks (for agent daemons, and
optionally for notifications to external systems). See
[AgentWebhook](/architecture/agent-daemon/) for the agent-daemon case.

Generic outbound webhooks are on the roadmap (notify an arbitrary URL
when a brief is approved); track the issue in the repo.
