---
title: Projects & goals
description: How to organise work in Workforce0 — projects scope data; goals track outcomes.
---

## Projects are the top-level scope

A **project** is the container for everything: meetings, briefs,
tickets, and the project graph. A workspace can have many projects. The
active project is set by the sidebar project switcher; every list you
see is filtered to the active project.

### When to create a new project

- New external initiative ("Mobile app redesign").
- New internal workstream ("Q3 growth experiments").
- New client engagement (agencies).

### When _not_ to create a new project

- One-off ad hoc work. Reuse an existing project and use **Goals** for
  lower granularity.
- Temporary investigations. File under the closest existing project.
- Personal notes. Workforce0 isn't a note tool.

### Archiving projects

**Projects → Archive** preserves all history but removes the project
from active lists. Archived projects don't generate new briefs. You can
restore any time.

Deleting a project requires it to be empty (no meetings, no briefs). If
you need to nuke it, archive instead — it's lossless.

## Goals are the second-level scope

**Goals** live inside projects. They describe outcomes:

- "Ship new onboarding flow by end of Q3."
- "Reduce support tickets by 20%."
- "Land 5 new enterprise customers."

When you generate a brief, you can link it to a goal. The chief-of-staff
uses the goal as context: the brief is framed as "how does this move
goal X forward?"

Goals are soft-touch. You don't have to use them. Teams that do get
better brief relevance; teams that don't still get work done.

## Project switching

Two ways to switch:

- **Sidebar switcher** — click the project name at the top of the
  sidebar, pick another.
- **URL deep link** — append `?project=<slug>` to any URL. Useful for
  shared links that should land on a specific project.

The active project persists in `localStorage`. A new tab inherits the
last-active project.

## Project colors

Cosmetic but useful. A color-coded project name shows up in:

- The sidebar switcher.
- Every message the chief-of-staff sends ("Hi from the 📱 Mobile app
  redesign project").
- Notifications.

## What gets scoped per project?

Everything with a `projectId` column:

- Meetings and transcripts.
- Briefs / PRDs.
- Execution plans.
- Tickets (child and parent).
- The project graph.
- Skills and subagents (if you add a project-scoped override).

What _doesn't_ scope to projects:

- Users and auth. User accounts are workspace-wide.
- AI provider keys. One set per workspace.
- Integration connections (Jira, Slack). Workspace-wide — but you can
  route messages to different Slack channels per project.

## Common patterns

### One project per customer / client

Agencies and consultancies. Keeps each client's data cleanly isolated,
including meetings, briefs, and code graphs.

### One project per product surface

Product teams. Mobile app, web app, admin dashboard, each its own
project. Briefs that cut across surfaces can live in a "Platform"
meta-project.

### One project for "operations"

A catch-all for recurring exec work — hiring, vendor reviews,
quarterly planning. Not everything maps to shipping code.

## Limits

Soft limits (no enforcement):

- ~100 active projects per workspace before the sidebar gets unwieldy.
- ~1,000 archived projects per workspace before list performance
  degrades.

Hard limits (enforced):

- 64-char project names.
- Reserved slugs: `new`, `all`, `archived`, `settings`.
