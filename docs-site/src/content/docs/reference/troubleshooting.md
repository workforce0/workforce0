---
title: Troubleshooting
description: The 20 things most likely to go wrong and what to do.
---

## Install

### `docker compose up` errors on `postgres`

Port 5432 is already taken on your host. Either stop the local
Postgres or change the published port in `docker-compose.prod.yml`:

```yaml
postgres:
  ports:
    - "5433:5432"
```

### Setup wizard says "AI provider key invalid"

- Check the key is the exact string — no trailing newline.
- Check the key's project / workspace matches where it was issued.
- If paid tier was just enabled, wait 60 s and retry.

### "No skills / subagents available"

First-boot seed failed. Check `backend` logs for
`seed: error`. Common causes:

- `vendor/skills/` missing (git submodule not pulled).
- DB connection race on first migration + seed.

Re-run: `docker compose exec backend npm run db:seed`.

## AI calls

### Every plan comes back as "Step 1: Review and decide"

This is the deterministic fallback. Causes:

- All AI providers unreachable.
- `PLANNER_MONTHLY_BUDGET_TOKENS` exceeded.
- All Council members returning malformed JSON (usually a local-model
  config issue).

Check **Settings → AI providers** and **Analytics → AI spend**.

### "Critique scored 0" errors

The model couldn't produce a valid critique. Usually the critique
prompt's system-prompt cache invalidated after a backend deploy and
the first call in the new window fumbled. Retry the brief.

### Rate limits hit fast

- Check your Anthropic / OpenAI tier.
- Reduce `SELF_CONSISTENCY_N` from 3 to 1.
- Switch from `majority` to `best-available` AI Council mode.

## Transcription

### Upload stuck at "transcribing"

Whisper is slow or down. Check provider status. If using local
Whisper, check the server's CPU — `whisper.cpp` on CPU takes
~1 s/s of audio.

### Transcription returns empty text

Audio is silent or too compressed. Inspect the recording file. If
audible to you, submit a bug.

## Integrations

### Slack buttons do nothing

- Verify `/api/webhooks/slack` is reachable from Slack (Cloudflare
  Tunnel / ngrok for dev).
- Verify `SLACK_SIGNING_SECRET` matches the app's signing secret.
- Check `backend` logs for signature verification errors.

### Jira tickets not syncing

- API token may have expired; rotate.
- Project key may be wrong (`ACME` vs `ACM`).
- Your workflow lacks the target status. See
  [Jira integration](/integrations/jira/).

### Google Drive sync stopped

Push channels expire every 7 days. We auto-renew; when that fails
the UI shows a "Reconnect" banner. Re-authorize.

## Queue + tickets

### Tickets stuck on `pending`

- The role has no active consumer — check the agent daemon (for
  dev/QA) or the backend's service startup logs.
- The role's queue is paused. Admin dashboard → **Queues → (role) →
  Resume**.

### Tickets stuck on `in_progress` forever

Worker crashed. BullMQ should move it back to `active` after 30s; if
it doesn't, manually set to `pending` via SQL or retry from the UI.

### Plan keeps hitting attempt 3 (escalation)

The same failure signature is repeating. Common:

- A broken integration (Jira project gone, Slack channel archived).
- A skill referenced in the plan that no longer exists.
- A role's prompt is misconfigured.

Escalate and fix manually; root-cause then fix.

## Web UI

### Dashboard shows old data after action

Cache invalidation issue — reload. File a bug if reproducible.

### Page 500s

Check backend logs. Most 500s are schema / null issues; server logs
have the trace.

## Performance

### Planner latency > 30s

One Council member is slow / degraded. `LOG_LEVEL=debug` shows per-
provider timings. Degrade or remove the slow one.

### Queue lag growing

Too few workers or too many concurrent briefs. Scale backend
horizontally OR lower `SELF_CONSISTENCY_N`.

### DB slow under load

Missing index. Use `pg_stat_statements` to find the slow query; add
an index via a migration.

## Backups

### Restore fails on FK constraints

Use `pg_restore --clean --if-exists` to drop + recreate. If that
still fails, you're restoring into a newer schema; match schema
versions.

### Restore succeeds but keys don't decrypt

`JWT_SECRET` mismatch. Keys are encrypted with a key derived from
`JWT_SECRET`; changing it orphans everything. Restore the original
`.env` alongside the DB.

## When in doubt

1. **Check logs.** `docker compose logs -f backend` → grep your
   `requestId`.
2. **Open an issue** with:
   - Version (`git describe --tags` output).
   - Steps to reproduce.
   - Relevant log excerpt (sanitise secrets).
3. **Ask in the community Slack** — link in the README.
