---
title: Daily workflow
description: What a normal week looks like for the exec using Workforce0.
---

:::note[Audience]
Exec / consumer. If it's not Monday morning, you probably don't need
to read this top-to-bottom — just the day that matches yours.
:::

## The steady state

A production-steady Workforce0 costs you roughly **15 minutes a day**:

- ~5 minutes in the morning clearing overnight Slack messages (briefs
  ready for approval, questions needing answers).
- ~10 minutes scattered through the day, reacting to approval prompts
  as they arrive.

The rest — transcription, decomposition, dispatch, replanning —
happens in the background.

## Morning

Open Slack / Teams / WhatsApp. The chief-of-staff has probably posted:

- A **daily digest** summarising yesterday (if you've turned digests on).
- One or two **briefs** from meetings you had yesterday afternoon.
- Any **clarifying questions** from briefs in progress.
- **Failed tickets** needing a redirect.

Work through them top-down:

1. Answer clarifying questions first — these unblock the most work.
2. Approve or redirect briefs.
3. Look at failures — usually the chief-of-staff has already
   replanned; you just confirm the new direction.

## Before / during meetings

If you're about to have a meeting that Workforce0 should capture:

- **Phone meeting?** Give the other party the dial-in number. See
  [Voice dial-in](/usage/voice/).
- **Video meeting you're recording?** Save the recording, upload
  later.
- **In-person / external?** Use a recording app on your phone; upload
  later.
- **Google Meet with Drive recording?** Workforce0 auto-imports via
  the Drive integration — nothing to do. See [Google Drive integration](/integrations/google-drive/).

## After meetings

Within a few minutes of a meeting ending, the chief-of-staff posts:

> 📝 New meeting: **Design review w/ Alex** (17 min). Brief coming
> in ~30 seconds.

A little later:

> 📋 **Brief ready: Onboarding flow redesign.** 1-line summary. One
> open question:
> **Q:** Is the 3-screen limit a hard constraint or a preference?
> [✅ Approve] [↪︎ Redirect] [⏸ Pause]

Answer the question in-thread; approve when ready.

## Evening / wind-down

Most execs skim Slack before ending the day. You'll see:

- Plans that landed during the day, waiting for approval.
- Progress updates as tickets close.
- Any blocked tickets that escalated to you for a decision.

If you want to defer everything to tomorrow, use Slack's **remind me**
on the message. The chief-of-staff doesn't time out pending approvals.

## End of week

Workforce0 can post a weekly digest (installer-configurable, off by
default). It covers:

- Briefs approved this week, with outcomes.
- Tickets completed (and by which role).
- Replans — which briefs required redirection, and the common reason.
- Spend — BYOK token usage, rollup by project.

Useful for one-on-ones with your leadership team.

## Patterns that work

### "Always send the brief"

Treat Workforce0 as a dedicated brief-writer. Every meeting gets a
transcript uploaded, even if you won't act on most of them. Scanning
briefs is faster than scanning transcripts; you'll find items you
would have forgotten.

### "Front-load the questions"

The chief-of-staff's clarifying questions are usually the most
important 30 seconds of your day. They surface hidden ambiguities
before they become wrong work.

### "Escalate the replan"

When a ticket fails twice in a row, the chief-of-staff escalates to
you instead of auto-replanning a third time. Treat this as a signal:
the brief probably has a wrong assumption. Redirect, don't replan.

## Patterns that don't

### "Approving everything"

Approval is not rubber-stamping. Bad approvals turn into wasted
BYOK spend and confusing Slack noise for everyone downstream.

### "Treating briefs as final specs"

A brief is a proposal, not a spec. If the brief is wrong, redirect or
pause — don't let downstream roles build against it.

### "Using the web UI daily"

The web UI is for audit, not work. If you find yourself opening it
daily, something's off — probably you need more / different Slack
notifications. Tell the installer.

## Life events that affect the loop

### You go on vacation

Set an **approval delegate** (Settings → Approvals → Delegate). Briefs
post to them while you're away; they inherit your approval rights.
Re-inherit on return.

### A team member changes roles

If Jamie was the QA approver and now Alex is: Settings → Team →
change Jamie to Observer, add Alex as Approver. Existing tickets
don't need anything — new approvals route to the new delegate.

### Key rotation

Once a quarter or so, rotate your BYOK keys. Installer handles it;
you won't notice any workflow difference. See [BYOK overview](/byok/overview/).
