---
title: Usage overview
description: How the two audiences — installer and exec — actually use Workforce0 day-to-day.
---

The **Usage** section is split by audience. Installer-focused pages
are tagged Installer; exec-focused pages are tagged Consumer.

## For the installer (you, after first boot)

You'll spend the first day wiring integrations. After that your
Workforce0 duties are mostly:

- **Quarterly**: rotate API keys, review BYOK spend caps,
  verify backups still restore cleanly.
- **When the exec asks**: add a new integration, tweak a role's
  prompt, onboard a new team member.
- **When a regression happens**: triage from `backend` logs, retry
  a stuck ticket from the Activity page.

## For the exec (the consumer)

Most of this section is for them. Send them:

- [Uploading meetings](/usage/meetings/) — the one place the exec
  touches the web UI.
- [Approvals in Slack](/usage/approvals/) — how to approve, redirect,
  or pause a brief without opening a browser.
- [Daily workflow](/usage/daily-workflow/) — what a normal week looks
  like. This is the page to bookmark.

## The minimal exec UX

If all goes well the exec does four things, repeatedly:

1. **Start** a meeting (dial in, or upload a recording after).
2. **Review** a brief — approve / redirect / ask a clarifying question.
3. **Approve** a plan — one tap.
4. **Audit** progress from Slack as child tickets close.

Everything else — prompts, models, schemas, queues — is your problem as
the installer. That's the deal.
