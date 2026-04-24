---
title: Environment variables
description: Every env var Workforce0 reads, in one table, with defaults and intent.
---

## Required

Without these, the backend refuses to start.

| Var                  | Default | Notes |
| -------------------- | ------- | ----- |
| `DATABASE_URL`       | —       | Postgres URI. Include `?sslmode=require` for managed providers. |
| `POSTGRES_PASSWORD`  | —       | Only read when using the bundled Postgres container. |
| `REDIS_URL`          | —       | `redis://`, `rediss://`, or `redis-sentinel://`. |
| `JWT_SECRET`         | —       | ≥32 chars. Encryption for credential vault also derives from this. |

## At least one of

Workforce0 needs **at least one** AI provider configured, or planner
calls will silently fall back to a deterministic stub.

| Var                    | Notes |
| ---------------------- | ----- |
| `ANTHROPIC_API_KEY`    | Claude via direct API. |
| `OPENAI_API_KEY`       | GPT family via direct API. |
| `GEMINI_API_KEY`       | Gemini; free tier works. |

## Optional — AI Council / model tuning

| Var                          | Default      | Notes |
| ---------------------------- | ------------ | ----- |
| `AI_COUNCIL_MODE`            | `best-available` | `strict-quorum` \| `majority` \| `best-available` |
| `AI_COUNCIL_MIN_PROVIDERS`   | `2`          | Quorum cutoff; set `1` to disable council voting. |
| `MODEL_DEFAULT_PLANNER`      | provider-default | Override the chief-of-staff model slug. |
| `SELF_CONSISTENCY_N`         | `3`          | Parallel plan drafts; `1` = off. |

## Optional — integrations

| Var                    | Notes |
| ---------------------- | ----- |
| `JIRA_BASE_URL`        | e.g. `https://acme.atlassian.net` |
| `JIRA_EMAIL`           | Atlassian account email. |
| `JIRA_API_TOKEN`       | Atlassian API token. |
| `GCHAT_WEBHOOK_URL`    | Google Chat incoming webhook URL. |
| `SLACK_BOT_TOKEN`      | `xoxb-…`; required for Slack integration. |
| `SLACK_SIGNING_SECRET` | verifies Slack → Workforce0 webhook signatures. |
| `TWILIO_ACCOUNT_SID`   | Voice. |
| `TWILIO_AUTH_TOKEN`    | Voice. |
| `TWILIO_PHONE_NUMBER`  | E.164 format. |

## Optional — security

| Var                     | Default | Notes |
| ----------------------- | ------- | ----- |
| `CORS_ORIGINS`          | same-origin | Comma-separated list of allowed origins. |
| `COOKIE_SECURE`         | `1` in prod | `0` for localhost. |
| `COOKIE_SAMESITE`       | `lax`    | `strict` \| `lax` \| `none`. |
| `RATE_LIMIT_AUTH_PER_MIN` | `20`   | Per-IP login throttle. |
| `RETAIN_RECORDINGS`      | `0`    | `1` keeps meeting audio after transcription. |
| `RETAIN_CALL_AUDIO`      | `0`    | `1` keeps Twilio call audio. |

## Optional — observability

| Var                    | Notes |
| ---------------------- | ----- |
| `LOG_LEVEL`            | `debug` \| `info` \| `warn` \| `error` (default `info`). |
| `LOG_FORMAT`           | `pretty` (dev) \| `json` (prod). |
| `TRACE_SAMPLE_RATE`    | `0`..`1` (OTLP export sampling). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Enable OpenTelemetry traces. |

## Optional — scheduling / cron

| Var                         | Default | Notes |
| --------------------------- | ------- | ----- |
| `WORKFORCE0_CRON_ENABLED`   | `1`     | Turn off for horizontal backend replicas that shouldn't own cron. |
| `DIGEST_CRON_HOUR`          | `9`     | Local hour to post the daily digest. |
| `DIGEST_TIMEZONE`           | `UTC`   | IANA timezone for the cron schedule. |

## Optional — budget gates

| Var                                    | Default | Notes |
| -------------------------------------- | ------- | ----- |
| `PLANNER_MONTHLY_BUDGET_TOKENS`        | none    | Hard cap; planner falls back to deterministic stub once hit. |
| `AGENT_MONTHLY_BUDGET_TOKENS`          | none    | Per-specialist monthly cap. |

## Optional — feature flags

| Var                          | Default | Notes |
| ---------------------------- | ------- | ----- |
| `FEATURE_VOICE_ENABLED`      | `1`     | Gate the voice dial-in endpoint. |
| `FEATURE_PROJECT_GRAPH`      | `1`     | Gate project graph build endpoints. |
| `FEATURE_AUTO_BRIEF`         | `0`     | Auto-generate briefs on transcript-ready. |

## How they're read

- Backend: `backend/src/config/env.ts` is a single Zod schema that
  parses `process.env` once at boot. Invalid values crash on start.
- Frontend (Next.js): only `NEXT_PUBLIC_*` prefixed vars are
  available at runtime.
- Agent daemon: its own `agent/src/config.ts`, narrower surface.

## Generating a full `.env` template

```bash
cd backend
npm run env:template > .env.example
```

This re-exports the Zod schema as a commented `.env.example`. Use it
to stay in sync across upgrades.

## Treating secrets correctly

- Commit `.env.example`, never `.env`.
- Rotate keys quarterly. JWT_SECRET rotation logs out every user —
  schedule it.
- Managed platforms (Railway, Render, Fly, DO) have secret stores;
  prefer them over plain env vars where offered.

## When a value isn't listed here

If you found an env var in the source that isn't documented above,
that's a docs bug — open an issue.
