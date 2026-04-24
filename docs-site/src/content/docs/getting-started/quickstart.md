---
title: Quickstart (5 min)
description: Clone, boot, and approve your first brief in Slack.
---

:::note[Audience]
This page is for the **installer**. You'll need Docker Desktop (or a
container runtime equivalent) and one API key from Anthropic, OpenAI,
or Google. A free-tier Gemini key is enough.
:::

## 1. Clone the repo

```bash
git clone https://github.com/workforce0/workforce0
cd workforce0
```

## 2. Set your first API key

The stack only needs **one** AI provider key to boot. Pick the one you
already have.

```bash
cp .env.example .env
# Open .env in your editor and set ONE of:
#   GEMINI_API_KEY=...       (recommended for quickstart — free tier exists)
#   ANTHROPIC_API_KEY=...
#   OPENAI_API_KEY=...
```

Set two other required values:

```bash
# .env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/workforce0
POSTGRES_PASSWORD=postgres
REDIS_URL=redis://redis:6379
JWT_SECRET=change-me-to-something-32-chars-long
```

The `JWT_SECRET` must be at least 32 characters. Use `openssl rand -hex 32`
if you don't want to think about it.

## 3. Bring the stack up

```bash
docker compose -f docker-compose.prod.yml up -d
```

This boots five containers:

| Container         | Port  | What it is                            |
| ----------------- | ----- | ------------------------------------- |
| `workforce0-postgres` | 5432 | Your primary database                 |
| `workforce0-redis`    | 6379 | Queue + cache + pub/sub               |
| `workforce0-backend`  | 3000 | Fastify API + orchestration runtime   |
| `workforce0-frontend` | 3001 | Next.js audit UI                      |
| `workforce0-agent`    | —    | Local code-gen daemon (optional)      |

First boot runs migrations and seeds the default skill / subagent
library. It takes ~45 seconds on a warm machine.

## 4. Open the setup wizard

Point your browser at:

```
http://localhost:3001
```

Create the first admin account (workspace owner). The wizard walks
you through:

1. **Workspace name** — cosmetic, used in Slack messages.
2. **AI providers** — paste the same key(s) you put in `.env` so the
   UI knows what's available. (You can skip this if you trust the env.)
3. **First integration** — connect Slack / Google Chat / Teams so the
   chief-of-staff agent has somewhere to post.

## 5. Upload a meeting transcript

From the dashboard:

1. Click **Upload meeting**.
2. Paste the transcript of any meeting — a real one you just had, or
   a sample like `docs/samples/pm-review-meeting.txt`.
3. Give it a project ("Acme Mobile Redesign" is fine).
4. Click **Generate brief**.

Within ~30 seconds the chief-of-staff agent:

- Drafts a brief from the transcript.
- Posts a summary to your connected Slack / Teams channel.
- Asks a clarifying question if anything's ambiguous.

## 6. Approve from Slack

The posted message has three buttons: **Approve**, **Redirect**, and
**Pause**. Tap **Approve**.

The chief-of-staff responds in the same thread within 5 seconds:

> Plan accepted (4 steps). Dispatching to the team. I'll post back
> when the first ticket comes back with a result.

Open the web UI's **Activity** page and you'll see the 4 child tickets,
each assigned to a role (`ba_agent`, `architect`, `dev_agent`, `qa_agent`).

Congratulations — your first brief is live. From here:

- Connect Jira so `dev_agent` tickets sync to your tracker:
  [Jira integration](/integrations/jira/).
- Add a second AI provider for AI Council quorum:
  [AI Council](/features/ai-council/).
- Enable voice dial-in for phone-first meetings:
  [Voice dial-in](/usage/voice/).

## Troubleshooting

| Symptom                              | Fix                                                   |
| ------------------------------------ | ----------------------------------------------------- |
| `docker compose up` fails on `postgres` | Port 5432 is taken — stop your host Postgres.         |
| Setup wizard keeps asking for a key  | The `.env` provider key is malformed; paste it again. |
| No Slack messages arrive              | Check the **Integrations** page — webhook URL not set. |
| Brief generation hangs > 2 min        | Free-tier Gemini rate-limits; add an OpenAI / Anthropic key. |

If nothing here matches, open [an issue](https://github.com/workforce0/workforce0/issues)
with your `docker compose logs backend` output.
