---
title: OpenAI (GPT)
description: How to set up OpenAI's GPT family with Workforce0.
---

## Get a key

1. [platform.openai.com](https://platform.openai.com/) → **API keys**.
2. Create a new secret key.
3. Paste into Workforce0.

OpenAI has no free tier; $5 minimum credit to start.

## Set the key

```bash
OPENAI_API_KEY=sk-...
```

Or: **Settings → AI providers → OpenAI → Paste key**.

## Models used by default

| Role                | Default            |
| ------------------- | ------------------ |
| Planner             | `gpt-4o`           |
| Critique + revise   | `gpt-4o`           |
| Specialists         | `gpt-4o-mini`      |
| Transcription       | `whisper-1`        |
| Long summaries      | `gpt-4o` (128k window) |

Override via `MODEL_<ROLE>_OPENAI`.

## Whisper integration

`whisper-1` is the primary transcription path for uploaded recordings
(unless you've configured a local Whisper; see
[Local models](/byok/local-ollama/)). Usage is billed per second of
audio.

## Rate limits

OpenAI's rate limits by tier:

- **Tier 1** (new, <$5): 500 req/min, 30k TPM.
- **Tier 2–4** escalating as you spend more.
- **Enterprise**: custom.

Workforce0 respects `429` and Retry-After headers.

## Cost rough numbers

| Model                | Input $/1M | Output $/1M | Typical brief cost |
| -------------------- | ----------:| -----------:| -------------------|
| GPT-4o               | $2.50      | $10.00      | ~$0.08             |
| GPT-4o-mini          | $0.15      | $0.60       | ~$0.01             |
| Whisper-1 (audio)    | $0.006/min | —           | ~$0.05 / 10 min     |

## Azure OpenAI

Supported via `OPENAI_BASE_URL` override:

```bash
OPENAI_API_KEY=your-azure-key
OPENAI_BASE_URL=https://your-resource.openai.azure.com
OPENAI_API_VERSION=2024-07-01-preview
OPENAI_DEPLOYMENT_PLANNER=gpt4o-deployment-name
```

The schema stays the same; you're just pointing at Azure's endpoints.

## What breaks

### Org / project key mismatches

Some OpenAI keys are project-scoped. If you get a 401 with "no
matching project", use an org-level key or pin the project:

```bash
OPENAI_ORG_ID=org-...
```

### Rate limits on burst

Decomposing 50 briefs simultaneously hits TPM limits on Tier 1. Either
fund your OpenAI account enough for Tier 3, or use Anthropic / Gemini
alongside to spread load.

### Moderation holds

OpenAI sometimes flags transcripts with sensitive content ("violent
language", even for quoted material in a crime-podcast brief). These
return 400 + a moderation reason. Workforce0 logs them; nothing to
auto-retry. Route sensitive content through local models if this
matters — see [Local models](/byok/local-ollama/).
