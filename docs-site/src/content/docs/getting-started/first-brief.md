---
title: Your first brief
description: A 15-minute walkthrough from "meeting transcript in hand" to "approved plan dispatched to the team."
---

:::note[Audience]
Installer — you'll do this once, with the exec alongside you or with a
dummy transcript, to confirm the loop works end-to-end.
:::

## What you'll produce

At the end of this walkthrough you'll have:

- A **meeting** object with its transcript attached.
- A **brief** (also called a PRD in the schema) drafted from the
  transcript by the chief-of-staff.
- An **approved plan** — 2 to 6 steps — fanned out as child tickets.
- A Slack / Teams thread showing the approval flow.

If something goes wrong partway through, each step is re-runnable from
the UI — you don't have to start over.

## Step 1: create a project

Projects scope everything. A single workspace can have many projects;
meetings, briefs, and tickets always belong to one.

1. Sidebar → **Projects** → **New project**.
2. Name it (e.g. "Mobile app redesign"), pick a color swatch, describe
   it in a sentence.
3. Save.

The sidebar's project switcher now shows your new project as the active
scope. Every list you see — meetings, briefs, tickets — is filtered to
this project until you switch.

## Step 2: upload a meeting

You have three ways to create a meeting:

- **Upload a recording** (mp3 / m4a / webm) — Whisper transcribes.
- **Paste a transcript** — skip transcription, go straight to brief
  drafting.
- **Dial in by phone** — Twilio + Gemini Live; real-time. See
  [Voice dial-in](/usage/voice/).

For the first run, **paste a transcript**. Copy something real:

> PM: I want to redesign the onboarding flow. Signups are flat and
> the first-week retention is at 22%. I want a new flow, mobile-first,
> tested with 5 users before we ship.
> Eng: OK, that's probably 3 weeks. I want to split it into a design
> spike first.
> PM: Fine. Let's decide by Friday.

Paste this into the text field, click **Create meeting**. The UI takes
you to the meeting detail page.

## Step 3: generate a brief

On the meeting detail page, click **Generate brief**.

The chief-of-staff now:

1. Reads the transcript and any prior project history.
2. Drafts a **brief** — title, goal, target users, success metrics,
   open questions, proposed scope.
3. If it has meaningful open questions, posts them to your comms
   channel ("Hey, before I fan this out, two quick questions…").
4. Persists the brief as a PRD row in the database.

You now see the draft brief in the web UI, with status **Pending
approval**.

## Step 4: review + approve

You (or the exec, in production) review the brief. Two paths:

**Approve from the web UI.** Click **Approve** on the brief. This sets
the brief status to `approved` and enqueues a `chief_of_staff` ticket
for plan decomposition.

**Approve from Slack.** The same message posted to Slack has three
buttons — **Approve**, **Redirect**, **Pause**. Tap **Approve**. The
thread updates to "Plan accepted" within 5 seconds.

Either way, the chief-of-staff now decomposes the approved brief.

## Step 5: watch the plan land

The decomposition uses the multi-model AI Council (if you've configured
more than one provider) with self-consistency and a critique-and-revise
loop. See [Brief generation](/features/brief-generation/) for the details.

The output is an `ExecutionPlan` row with 2–6 steps:

```
1. ba_agent        — User research: 5 onboarding interviews.
2. architect       — Design spike: 3 candidate flows + tradeoff memo.
3. dev_agent       — Implement chosen flow behind a feature flag.
4. qa_agent        — Acceptance test plan + manual run.
```

Each step becomes a **child ticket** in the queue. Specialist agents
(BA, architect, dev, QA) pull them:

- `ba_agent` + `architect` tickets run server-side against your BYOK
  frontier model.
- `dev_agent` + `qa_agent` tickets run **on your machine** via the
  AgentHub daemon — code-gen uses your Claude Code / Cursor
  subscription so production source code never leaves your laptop.

## Step 6: follow up

As each ticket completes, the chief-of-staff posts a short update to
Slack:

> ✓ BA research complete (5 interviews summarized). Next up: architect
> on design spike (ETA 2 hours).

Failed tickets trigger an automatic **replan** with the failure
signature fed back into the next plan prompt. You see this as a new
`ExecutionPlan` row with `attempt: 2`; the first plan is marked
`superseded`.

## What's happening under the hood?

If you want to understand the machinery you just ran:

- [System overview](/architecture/overview/) — the moving parts.
- [Chief of Staff](/features/chief-of-staff/) — how the planner works.
- [Project Graph](/features/project-graph/) — how code context enters
  the prompt for engineering-touching briefs.

## What if something goes wrong?

Every surface in the loop is replayable.

| Thing that broke        | Do this                                             |
| ----------------------- | --------------------------------------------------- |
| Transcript upload failed | Try again; Whisper occasionally 503s on free tier. |
| Brief is garbled / weird | On the brief, click **Regenerate** — it re-runs with a fresh prompt. |
| Plan has wrong steps     | Open the plan, click **Replan** with a reason. The chief of staff folds the reason into the next prompt. |
| A ticket failed          | The chief-of-staff already replanned. Check the new plan in **Activity**. |

From here: [Daily workflow](/usage/daily-workflow/) covers what the
exec's week looks like.
