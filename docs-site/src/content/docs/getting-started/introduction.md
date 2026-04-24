---
title: Introduction
description: What Workforce0 is, what it isn't, and whether it fits your team.
---

:::note[Audience]
This page is for the **installer** — the person who will clone the repo
and run `docker compose up`. If you are the exec, ask your installer to
send you [the daily workflow page](/usage/daily-workflow/) instead.
:::

## What Workforce0 is

Workforce0 is an open-source software package that behaves like an AI
product team. You install it once. After that it can:

- Listen in on meetings (Google Meet / Zoom recordings, uploads, or a
  phone dial-in) and transcribe them with domain-aware prompts.
- Write briefs (the equivalent of a PM's one-pager) from those
  transcripts, with follow-up questions it posts back to the exec.
- Decompose an approved brief into a plan — 1 to 6 steps — with each
  step assigned to a specialist AI role (BA, architect, dev, QA).
- Dispatch those steps as tickets into a queue. Specialist agents pull
  them, do the work, and report back.
- Summarise status in Slack / WhatsApp / Teams so the exec stays in
  the loop without ever opening the UI.
- Keep the loop tight: failed tickets get replanned automatically,
  with the failure signature fed back into the plan prompt.

Everything runs on **your** infrastructure. Every LLM call uses **your**
API keys. Every database row lives in **your** Postgres.

## What it isn't

Workforce0 is deliberately not:

- **A SaaS.** We don't host anything. No multi-tenant cluster to share
  with strangers. No monthly fee.
- **A chat UI.** The exec doesn't prompt Claude in a web app. They
  approve a brief, answer a clarifying question, or redirect a
  step — always by replying to a message.
- **A fully-autonomous "agent swarm."** Humans stay on the critical
  path. Plans are drafted, not executed silently. Work that affects
  shared systems waits for a human approval.
- **A no-code builder.** We optimize for developer teams that can run
  Docker and understand API keys. The exec gets a curated product;
  the installer gets YAML and logs.

## Who it's for

Workforce0 fits teams where:

1. There's an **exec or operator** with a lot of meeting-driven,
   decision-heavy work — VP Product, CPO, Head of Ops, founding CEO.
2. There's at least **one technical person** (founding engineer, tech
   lead, platform engineer) willing to run the installer persona.
3. The team uses **Slack / Teams / WhatsApp / Google Chat** as the
   daily communication surface.
4. The team has **at least one** API key for a frontier model —
   Anthropic, OpenAI, or Google (a free-tier Gemini key is fine to start).

If that's not you, that's fine — there are a lot of good AI tools. But
Workforce0 won't give you value in isolation.

## The two-persona contract

We take the split-audience separation seriously. You'll see it
everywhere:

| Surface                          | Speaks to        |
| -------------------------------- | ---------------- |
| This docs site                   | Installer        |
| The repo's README / CLI errors   | Installer        |
| The **setup wizard** in the web UI | Installer        |
| Slack / WhatsApp / Teams messages | Exec (consumer) |
| The web UI dashboard / audit log | Both             |

If you find a page, a message, or a log line that blurs these two
audiences, [open an issue](https://github.com/workforce0/workforce0/issues).
It's a bug.

## Where to go next

- If you have 5 minutes and want to see it work:
  [Quickstart](/getting-started/quickstart/).
- If you need a production-grade install plan:
  [Installation](/getting-started/installation/).
- If you want to understand the pieces before installing anything:
  [System overview](/architecture/overview/).
