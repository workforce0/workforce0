---
title: Google Chat
description: Post approvals, status, and questions into a Google Chat space.
---

## What it does

The chief-of-staff posts cards into a Google Chat space — briefs,
approval prompts, status updates. Users reply or click action buttons
to approve.

## Setup

1. **Google Chat side**
   - Open the target space.
   - **Manage webhooks → Add webhook**.
   - Name it "Workforce0". Copy the URL.

2. **Workforce0 side**
   - **Integrations → Google Chat → Connect**.
   - Paste the webhook URL. Save.
   - Send a test message from the UI.

## Message shape

Workforce0 posts **cards**, not plain text. A brief looks like:

```
┌─────────────────────────────────────────┐
│ 📋 Brief ready: Mobile onboarding       │
│ Alex Chen · 2 min ago                   │
├─────────────────────────────────────────┤
│ Redesign the onboarding flow to lift    │
│ first-week retention from 22% → 35%.    │
│                                         │
│ [✅ Approve] [↪︎ Redirect] [⏸ Pause]     │
└─────────────────────────────────────────┘
```

Action buttons round-trip through the Google Chat **interactive
event API** — Workforce0 receives the click, processes it, and posts
a follow-up in the same thread.

## Per-project channels

By default all briefs post to the one connected space. For per-project
routing:

- **Integrations → Google Chat → Routes**.
- Map project → space webhook URL.
- Unmapped projects fall back to the default space.

## Threading

Messages use Google Chat's threaded-reply mode. Every brief starts a
thread; status updates, clarifying questions, and approvals all go
into the same thread. Easy to scroll; easy to forget about closed
threads.

## Limitations

- Google Chat cards are less expressive than Slack Block Kit. Long
  briefs get truncated with a "Read more…" link to the web UI.
- No DMs (1:1 chats): only space webhooks. If the exec wants a DM
  experience, use Slack instead.
- Google Chat action events are POSTs without signatures; we verify
  by matching the `spaceId` on inbound against our connected spaces.
