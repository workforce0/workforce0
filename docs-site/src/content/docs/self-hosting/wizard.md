---
title: Setup Wizard
description: Walk through Workforce0's first-run setup wizard.
---

When you first visit Workforce0 after `docker compose up`, the wizard runs at `/setup`. It guides you through six screens.

## 1. Welcome

Confirms what you're installing. Click Next.

## 2. Hardware check

Workforce0 reads your host RAM and CPU and recommends a tier:

- **Light** — <9 GB free for AI: Qwen 3.5 8B
- **Default** — 9–25 GB: Mistral Small 3 24B + Qwen 3.5 8B
- **Heavy** — ≥25 GB: Qwen 3.5 32B (+ 8B warm)

You can override the recommendation. Used to pick the local-models default model.

## 3. AI providers

Two columns:

- **BYOK keys** — Anthropic / OpenAI / Google. Optional but recommended for quality.
- **Local models** — None / Light / Default / Heavy tier.

At least one provider must be configured.

## 4. Meeting capture

Three options:

- **Bundled (Vexa)** — adds ~310 MB RAM, no external account
- **Recall.ai (BYOK)** — vendor-managed, ~$0.50/hour
- **Skip** — manual upload only

## 5. Integrations

Slack, Jira, GitHub, etc. Same as before.

## 6. Apply

The wizard saves your choices and prints the `.env` keys you need plus the apply command:

```bash
./bin/setup-finish.sh --profile meeting-bot --profile local-llm --profile local-stt
```

Run that in your terminal. The wizard polls each service's `/health` and shows green checkmarks as they come up.

## Re-running the wizard

Visit Settings → Reconfigure to change your choices later.
