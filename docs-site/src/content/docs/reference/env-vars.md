---
title: Environment variables (cheat sheet)
description: Every env var in one place. For the full install context, see Self-hosting → Environment variables.
---

The canonical list is at
[Self-hosting → Environment variables](/self-hosting/env-vars/).

Below is a one-line cheat sheet for quick lookups.

## Required

```bash
DATABASE_URL=postgresql://…
POSTGRES_PASSWORD=…
REDIS_URL=redis://…
JWT_SECRET=                       # ≥32 chars
```

## At least one AI provider

```bash
ANTHROPIC_API_KEY=sk-ant-…
OPENAI_API_KEY=sk-…
GEMINI_API_KEY=AIza…
```

## Optional — AI Council + tuning

```bash
AI_COUNCIL_MODE=majority          # strict-quorum | majority | best-available
AI_COUNCIL_MIN_PROVIDERS=2
SELF_CONSISTENCY_N=3
CRITIQUE_REVISE_THRESHOLD=20
PLAN_ATTEMPT_CAP=3
```

## Optional — per-provider model overrides

```bash
MODEL_PLANNER_ANTHROPIC=claude-sonnet-4-6
MODEL_PLANNER_OPENAI=gpt-4o
MODEL_PLANNER_GOOGLE=gemini-2.0-flash-exp
MODEL_BA_ANTHROPIC=claude-haiku-4-5
…
```

## Optional — local models

```bash
AI_CUSTOM_ENABLED=1
AI_CUSTOM_BASE_URL=http://host.docker.internal:11434/v1
AI_CUSTOM_API_KEY=sk-placeholder
AI_CUSTOM_MODELS=llama3.1:70b,qwen2.5-coder:14b
```

## Optional — integrations

```bash
JIRA_BASE_URL=https://acme.atlassian.net
JIRA_EMAIL=…
JIRA_API_TOKEN=…
SLACK_BOT_TOKEN=xoxb-…
SLACK_SIGNING_SECRET=…
GCHAT_WEBHOOK_URL=…
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
TWILIO_PHONE_NUMBER=+14155551234
GITHUB_WEBHOOK_SECRET=…
```

## Optional — security

```bash
CORS_ORIGINS=https://app.example.com
COOKIE_SECURE=1
COOKIE_SAMESITE=lax
RATE_LIMIT_AUTH_PER_MIN=20
RETAIN_RECORDINGS=0
RETAIN_CALL_AUDIO=0
```

## Optional — budgets

```bash
PLANNER_MONTHLY_BUDGET_TOKENS=2000000
AGENT_MONTHLY_BUDGET_TOKENS=10000000
VOICE_MONTHLY_MINUTES=1000
```

## Optional — observability

```bash
LOG_LEVEL=info
LOG_FORMAT=json
METRICS_ENABLED=0
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel…
TRACE_SAMPLE_RATE=0.1
```

## Optional — features + cron

```bash
FEATURE_AUTO_BRIEF=0
FEATURE_VOICE_ENABLED=1
FEATURE_PROJECT_GRAPH=1
WORKFORCE0_CRON_ENABLED=1          # exactly one replica at scale
DIGEST_CRON_HOUR=9
DIGEST_TIMEZONE=UTC
```

## Regenerating a full `.env.example`

```bash
cd backend
npm run env:template > .env.example
```

Stays in sync with the Zod schema that parses env on boot.
