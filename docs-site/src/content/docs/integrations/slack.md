---
title: Slack
description: The canonical comms channel. Briefs, approvals, status — all in Slack.
---

## What it does

Workforce0 becomes a native member of your Slack workspace. It:

- Posts briefs and approval cards into chosen channels.
- Receives inline button clicks (Approve / Redirect / Pause).
- DMs the exec for urgent clarifying questions.
- Threads every update under the brief's original message.

## Setup — app install

1. **Slack side — create a Slack app**
   - [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From manifest**.
   - Paste the manifest from `docs/integrations/slack-manifest.yaml`
     in the repo. It has the scopes, event subscriptions, and
     interactivity URLs pre-set.
   - **Install to workspace** → approve the scopes.
   - Copy the **Bot User OAuth Token** (`xoxb-…`) and the **Signing
     Secret**.

2. **Workforce0 side**
   - **Integrations → Slack → Connect**.
   - Paste `xoxb-…` and the signing secret.
   - Test: click **Send test message** to a channel you invite the
     bot to.

## Scopes used

From the manifest:

- `chat:write` — post messages.
- `chat:write.public` — post in channels the bot isn't a member of.
- `commands` — slash commands (`/workforce0 status`, `/workforce0 brief`).
- `im:write` — DM the exec.
- `reactions:write` — react to messages (a ✓ when a clarifying
  question is answered).
- `channels:read` — list channels for routing.
- `users:read` — map Slack users to Workforce0 accounts.

No broader read scopes. We can't see other channels' contents.

## Channel routing

- **Default** — every brief posts to a single channel (e.g. `#exec-briefs`).
- **Per project** — map project → channel in **Integrations → Slack →
  Routes**.
- **Per role** — `dev_agent` pings to `#dev-briefs`, `ba_agent` to
  `#research-briefs`. Useful at medium / large companies.

## Slash commands

- `/workforce0 status` — current open briefs awaiting action.
- `/workforce0 brief <project>` — start a brief from scratch without
  a meeting.
- `/workforce0 approve <brief-id>` — alternate approval path for
  keyboard users.

## DMs vs channels

- **Approvals** → channel (by default), for visibility.
- **Clarifying questions** → DM to the specific exec (quieter).
- **Failure escalations** → DM, with a "mention in channel?" button
  if the exec wants to bring it public.

## Interactivity

Inline action buttons POST to `/api/webhooks/slack` with Slack's
signed payload. We verify the signature against your signing secret
before handling.

No action completes silently. Every button click gets either an
ephemeral "✓ received" toast or a thread reply.

## Multi-workspace

If your org has multiple Slack workspaces (parent + subsidiaries),
each needs its own app install. Workforce0 supports N connected
Slack workspaces per tenant.

## Uninstalling

**Integrations → Slack → Disconnect** tears down the OAuth token
server-side. Also revoke in Slack's app management to clean up on
Slack's side.

## Troubleshooting

| Symptom                             | Fix                                          |
| ----------------------------------- | -------------------------------------------- |
| Messages arrive, buttons do nothing | Interactivity URL wrong in app config.       |
| "not_in_channel" errors             | Invite the bot to that channel.              |
| Signature verification failing      | Signing secret wrong or clock drift > 60s.   |
| Duplicate messages                  | Two bot installs in the same workspace.      |
