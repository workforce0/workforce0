# Slack Integration Setup Guide

## Overview

Workforce0 posts briefs, approvals, and alerts to your Slack workspace — so your team sees what the AI did without leaving the place they already work. Meeting briefs, items waiting on your review, PR-created alerts, and errors that need attention all land in the channel you choose.

You have two ways to connect:

- **Option A — Incoming Webhook**: send-only, 2-minute setup, no bot install.
- **Option B — Slack bot**: two-way, lets Workforce0 DM people, react-to-approve, and post threaded replies.

Pick A if you just want notifications. Pick B if you want the AI to actually participate in conversations.

---

## What you'll need

- A Slack workspace.
- Permission to add an app to that workspace.
  - If you're a **workspace owner or admin**, you can do this yourself.
  - Otherwise you'll need to ask your Slack admin to approve the app once (takes 30 seconds on their end — we include a message template at the bottom).
- About 5 minutes.

You will NOT need: a Slack paid plan, any Slack API coding, or the command line.

---

## Option A: Quick — Incoming Webhook (send-only)

**Best for:** teams who just want Workforce0 to post notifications into one channel. No DMs, no reaction-based approvals.

**Tradeoff:** Workforce0 can post, but cannot read replies or reactions. If you approve things in Slack ("👍 on a brief to ship it"), choose Option B instead.

### Step 1 — Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and sign in.
2. Click **Create New App** → **From scratch**.
3. **App name**: `Workforce0`
4. **Pick a workspace**: select yours.
5. Click **Create App**.

_Screenshot: Slack "Create an app" modal with From scratch highlighted._

### Step 2 — Turn on Incoming Webhooks

1. In the left sidebar, click **Incoming Webhooks**.
2. Toggle **Activate Incoming Webhooks** to **On**.
3. Scroll down and click **Add New Webhook to Workspace**.
4. Pick the channel where Workforce0 should post (e.g. `#product-updates`).
5. Click **Allow**.
6. Copy the **Webhook URL** — it looks like `hooks.slack.com/services/<TEAM_ID>/<CHANNEL_ID>/<TOKEN>`.

_Screenshot: Slack Incoming Webhooks page with a copied webhook URL._

### Step 3 — Paste into Workforce0

1. In Workforce0, open **Settings → Integrations → Slack**.
2. Select mode **Webhook (send-only)**.
3. Paste the webhook URL.
4. Click **Test** — you should see a "Hello from Workforce0 👋" message in the channel within a second or two.
5. Click **Save**.

Done — Workforce0 will start posting there.

---

## Option B: Full — Slack bot (recommended for two-way)

**Best for:** teams who want Workforce0 to behave like a real teammate — DM assignees, react-to-approve, post threaded replies, post into multiple channels.

**Tradeoff:** one extra step (inviting the bot to each channel), but worth it for the approval workflow.

### Step 1 — Create a Slack app

Same as Option A, Step 1 above. If you already created one, skip ahead.

1. Go to [api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App** → **From scratch**.
3. **App name**: `Workforce0`
4. Pick your workspace and click **Create App**.

### Step 2 — Add OAuth scopes

In the left sidebar, click **OAuth & Permissions**. Scroll to **Scopes → Bot Token Scopes** and add each of these:

| Scope | Why Workforce0 needs it |
| --- | --- |
| `chat:write` | Post messages |
| `chat:write.public` | Post into channels without being invited first |
| `channels:read` | Show you a list of channels to pick a default |
| `reactions:read` | See when someone reacts 👍 on an approval request |
| `users:read` | Match Slack users to assignees in your briefs |
| `im:write` | Send direct messages to assignees |

Click **Add an OAuth Scope** for each one and type it in.

_Screenshot: Slack OAuth & Permissions page with the 6 scopes listed._

### Step 3 — Install to workspace

1. Still on the **OAuth & Permissions** page, scroll up and click **Install to Workspace**.
2. Review what the app can do, then click **Allow**.
3. Slack will show you a **Bot User OAuth Token** starting with `xoxb-…`. Click **Copy**.

> If you're not a workspace admin, this step will say "Request to install". Your admin will get a notification — they click Approve and you come back to copy the token.

### Step 4 — Paste into Workforce0

1. In Workforce0, open **Settings → Integrations → Slack**.
2. Select mode **Bot (two-way)**.
3. Paste the `xoxb-…` token.
4. Click **Test** — Workforce0 will verify the token and show your workspace name.
5. Pick a **Default channel** from the dropdown (this is where general notifications go — the AI can still post into any other channel it's invited to).
6. Click **Save**.

### Step 5 — Invite the bot to channels

The bot can post into any channel it's in, but you have to invite it first. In each channel you want it in, type:

```
/invite @Workforce0
```

Do this in your main channels (`#product`, `#eng`, and any project-specific ones). You only need to do this once per channel.

---

## Troubleshooting

| What you see | What it means | Fix |
| --- | --- | --- |
| `not_in_channel` | The bot isn't a member of that channel | Go to the channel, type `/invite @Workforce0` |
| `invalid_auth` | Token was revoked or copied from the wrong workspace | Re-install the app (OAuth & Permissions → Reinstall) and paste the new `xoxb-…` token |
| `missing_scope` | You added a scope after installing, so the existing token doesn't have it | Go to OAuth & Permissions → **Reinstall to Workspace** (required any time scopes change) |
| Webhook not posting (Option A) | Channel was archived, webhook was regenerated, or the app was removed | Create a new webhook in the Slack app page and paste the new URL |
| `channel_not_found` | The default channel was deleted or made private | Pick a new default in Workforce0 Settings |
| Messages post but formatting looks broken | Usually a workspace-wide restriction on rich messages | Try a plain-text test in the same channel; contact your admin if blocked |

If something else goes wrong, check **Settings → Integrations → Slack → Logs** in Workforce0 — we show the last 10 Slack API responses in plain English.

---

## What Workforce0 posts

- **Meeting briefs ready** — "Your Tuesday standup brief is ready. 3 decisions, 4 action items."
- **Approval queue reminders** — "2 briefs are waiting on your OK. React 👍 to approve or 👎 to reject."
- **PR-created alerts** — "Workforce0 opened a PR in `myapp/frontend` based on yesterday's design review."
- **Errors needing attention** — "Couldn't create Jira ticket for action item #4 — the project key changed. Tap to fix."
- **Threaded replies** (bot only) — follow-up questions on a brief get posted as replies in the same thread, so nothing clutters the channel.

You can turn any of these off in **Settings → Notifications**.

---

## Approving from Slack (optional)

Approvers can decide on a brief right from the Slack DM — no web UI needed.

When Workforce0 sends an approval request, it includes a short token:

```
Open to review: https://workforce0.yourcompany.com/approvals?prd=abc123
Or reply:
  APPROVE f1a2b3c4d5e6
  REJECT f1a2b3c4d5e6 [optional reason]
```

Replying to the DM with `APPROVE f1a2b3c4d5e6` flips the PRD to approved. `REJECT f1a2b3c4d5e6 missing success metrics` rejects it and records the reason in the audit log.

### Wire up the events webhook

1. In your Slack app (https://api.slack.com/apps → your app) → **Event Subscriptions**.
2. Turn on **Enable Events**.
3. Request URL: `https://workforce0.yourcompany.com/webhooks/slack/events` — Slack will send a challenge; Workforce0 responds automatically if `SLACK_SIGNING_SECRET` is set.
4. Under **Subscribe to bot events**, add:
   - `message.im` — catches DM replies
   - `message.channels` (optional) — catches channel replies where the bot is invited
5. Save.
6. In your Workforce0 `.env`, paste `SLACK_SIGNING_SECRET=...` (found in your Slack app's **Basic Information** → **Signing Secret**). Restart.

**Troubleshooting:**
- Replies don't register → check `docker compose logs backend | grep slack-webhook`. Most common: signature mismatch, which means the signing secret in `.env` doesn't match the Slack app's.
- "unknown/expired token" → tokens are 7-day TTL. If the approver waits longer, they'll need to click the link instead of replying.
- Bot echo loops → Workforce0 ignores any event with `bot_id` set, so reposting won't trigger itself.

---

## Revoking access

If you want to stop Workforce0 from posting or reading:

1. Go to [slack.com/apps/manage](https://slack.com/apps/manage) (or your workspace's Apps page).
2. Find **Workforce0** and click it.
3. Click **Remove app** (for admins) or **Configuration → Uninstall from workspace** on api.slack.com/apps.

Or, faster — in Workforce0 open **Settings → Integrations → Slack → Disconnect**. This deletes the stored token; the Slack app remains in your workspace but has no way to reach us.

---

## Privacy note

- Your Slack bot token is **encrypted at rest** using the same key that protects your other integration credentials. No one on the Workforce0 team (including hosted-plan support) can read it.
- We never post raw meeting transcripts to Slack — only summaries, action items, and the explicit content of briefs you've approved.
- We don't read your Slack channels. The bot only receives events it's subscribed to (reactions on messages it sent, and mentions).
- If you uninstall the app, the token is invalidated by Slack immediately — even if Workforce0 still has a copy, it won't work.

---

## Asking your admin to approve the app

If you're not a workspace admin, send this to the person who is:

> Hey — I'm setting up Workforce0 (an AI teammate that turns our meetings into briefs and PRs). It needs to post into Slack for us. Could you approve the app when you see the request? It's read-only on channel lists and users, plus permission to post messages and DM. No access to message history. Thanks!

---

## For the curious: what's under the hood

- Tokens stored encrypted via `mvp/src/lib/encryption.ts`.
- Schema fields: `slackBotToken`, `slackDefaultChannel` on the `WorkspaceSettings` model.
- Service (coming soon): `mvp/src/services/integrations/slack.service.ts`.
- Related docs: [google-chat-setup.md](./google-chat-setup.md), [stitch-prompts/05-integration-wizard.md](../../docs/stitch-prompts/05-integration-wizard.md).
