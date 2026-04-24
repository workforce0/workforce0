# Quickstart (5 minutes)

The fastest path from nothing to your first AI-generated brief.

## You will need

- [Docker](https://docs.docker.com/get-docker/) 20 or newer
- 4 GB of free RAM
- A free [Google Gemini API key](https://aistudio.google.com/app/apikey) (takes 30 seconds to get)

> **Not technical?** Skip this page and use a [one-click deploy](./one-click-deploy.md) instead.

## 1. Clone and configure

```bash
git clone https://github.com/workforce0/workforce0.git
cd workforce0
cp .env.example .env
```

Open `.env` and fill in three values:

| Variable | What | How to get it |
|---|---|---|
| `POSTGRES_PASSWORD` | Any strong password | `openssl rand -base64 32` |
| `JWT_SECRET` | A signing secret | `openssl rand -base64 32` |
| `GEMINI_API_KEY` | Your Gemini key | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |

Everything else can stay empty — you'll configure integrations from the in-app wizard later.

## 2. Start the stack

```bash
docker compose -f docker-compose.prod.yml up -d
```

This launches PostgreSQL, Redis, the backend API, and the Next.js frontend. First run takes about 2 minutes (pulling images, running migrations).

## 3. Create your account

Open **http://localhost:3001** and click **Sign up**.

You'll land in a setup wizard that walks you through:

1. Naming your workspace
2. Picking a default AI provider (Gemini is pre-filled)
3. Optionally connecting your first integration (Jira, Google Chat, etc.)

## 4. Generate your first brief

On the **Meetings** page, click **Paste transcript** and drop in any meeting notes.

Twenty seconds later, you'll have a structured brief — requirements, user stories, action items — ready to approve or edit.

## What next?

- [**Connect integrations**](../mvp/docs/) — Jira, Google Chat, Google Drive
- [**Add more AI models**](./byok.md) — plug in Claude or GPT for the AI Council
- [**Harden your instance**](./self-hosting.md) — HTTPS, backups, upgrades
- [**Install the local agent**](../agent/) — turn approved briefs into pull requests

## Stuck?

- [GitHub Discussions](https://github.com/workforce0/workforce0/discussions) — ask anything, get help
- [Issues](https://github.com/workforce0/workforce0/issues) — report bugs
