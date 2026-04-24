---
title: Approvals in Slack
description: How the exec approves, redirects, or pauses work without ever opening the web UI.
---

:::note[Audience]
Exec / consumer. This is the page to bookmark.
:::

## The three buttons

Every brief and every plan the chief-of-staff posts to your comms
channel has three inline buttons:

| Button    | What happens                                           |
| --------- | ------------------------------------------------------ |
| ✅ Approve | The brief / plan moves forward. Work starts.            |
| ↪︎ Redirect | You reply with a reason. The chief-of-staff replans with your reason folded in. |
| ⏸ Pause    | The brief / plan is parked. No tickets dispatched until you resume. |

One tap. No form. No dashboard.

## Approve

A tap on **Approve** does four things:

1. Marks the brief / plan as approved in the database.
2. Records **who** approved it and when (visible in the audit log).
3. Dispatches any child tickets that were waiting on approval.
4. Replies in-thread: _"Approved. Dispatching N steps. I'll update as
   they land."_

Once approved, the chief-of-staff posts status updates in the same
thread as tickets complete or fail. The thread becomes the running
log for that brief.

## Redirect

**Redirect** is for "almost, but not quite." Tap it, the Slack client
opens a reply prompt. Type your redirection:

> Skip the user research step — we already have data. Start from the
> design spike.

The chief-of-staff reads your reply, generates a new plan with your
redirection as the `replanReason`, and posts the updated plan in the
same thread for another approval round.

### Good redirections

- Explicit scope changes: "drop the QA step this time."
- Priority changes: "do the accessibility audit first."
- Role swaps: "send this to the architect instead of dev."

### Bad redirections

- Vague feedback: "make it better." (Better how?)
- Contradictory changes: "do more but also do less." (The chief-of-staff
  will pick one.)
- Personal attacks on the model: save it for therapy.

## Pause

**Pause** parks work without canceling it. Common triggers:

- The brief landed during a meeting and you can't look at it yet.
- Budget pause: you want to delay before burning more AI quota.
- External block: the team you'd dispatch to is on vacation.

Tap **Pause**. The thread shows it as paused. When you're ready, tap
**Resume** (appears on the same message). Work picks up from where it
stopped.

## Clarifying questions

Sometimes the chief-of-staff asks a question before drafting:

> Quick check — this brief talks about "the old rebranding doc." Do
> you mean the 2025 one or the 2024 one? I can't find either in
> Drive.

Reply in-thread like you would to a colleague. The next brief draft
folds your answer in.

## Audit — seeing who did what

Every approval, redirect, and pause is logged with attribution. To
audit:

- Web UI → **Activity** → filter by type = `approval`.
- Or the slower route: search your Slack channel's history.

Approvals include the approver's email, the message link, and the
decision timestamp. Useful for regulated industries or when the exec
wants to know why a brief shipped.

## Approval rules (set by the installer)

Not every approval needs to go through the exec. Installers can
configure:

- **Auto-approve by cost.** Plans that estimate under N tokens or N
  API-call cost auto-approve. Everything above waits.
- **Auto-approve by role.** Tickets that are only `ba_agent` or
  `qa_agent` (non-shipping roles) auto-approve. Anything that touches
  `dev_agent` waits.
- **Auto-approve by project.** Dev projects auto-approve; client-facing
  projects wait.
- **Approval delegate.** Another team member can approve on the exec's
  behalf for vacation coverage.

Installer docs: [Audit & approvals](/features/audit-approvals/).

## If you mis-tap

- **Approved by mistake.** Tap the **Pause** button that reappears on
  the thread. Work halts on the next ticket boundary (current tickets
  finish).
- **Redirected by mistake.** You can Redirect again with the correct
  reason. Older plans are marked `superseded`; nothing is lost.

## Reducing Slack noise

Large Workforce0 deployments can generate a lot of Slack messages.
Options:

- **Daily digest mode.** Instead of realtime messages, a single daily
  summary in the morning. (**Settings → Comms → Digest mode**.)
- **Dedicated channels per project.** Instead of one #workforce0 for
  everything, `#proj-mobile`, `#proj-billing`. The chief-of-staff
  picks the right channel automatically by project.
- **Quiet hours.** No messages 8 PM – 8 AM local time. Everything is
  still processed; notifications just batch to the morning.

## What about email / WhatsApp / Teams?

Same three buttons, different surface:

- **WhatsApp** — Twilio-integrated; reply with `approve`, `redirect`,
  `pause` (case-insensitive).
- **Microsoft Teams** — Adaptive Cards with the same three buttons.
- **Email** — flag-driven, text-based approvals (`Reply "approve"`).
- **Google Chat** — cards, same shape as Slack.

All route to the same underlying approval API.
