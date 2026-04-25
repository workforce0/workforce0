---
title: Diagnose
description: Troubleshoot a Workforce0 install with bin/diagnose.sh.
---

When something's broken, the first stop is:

```bash
./bin/diagnose.sh
```

This collects health and last 5 log lines from every Workforce0 container into a timestamped file (`diagnostics-<timestamp>.txt`). PII-aware: redacts `.env` secret values inline.

Share the output file in your support thread (issues, Discord, email).

## What it checks

- backend, frontend, postgres, redis (always present)
- ollama (if `local-llm` profile active)
- whisper (if `local-stt` profile active)
- vexa-api, vexa-bot-manager, docker-socket-proxy (if `meeting-bot` profile active)

## Sample output

```
[backend] state=running health=healthy
  last 5 log lines:
    {"level":"info","msg":"server listening on :3000"}
    ...
[ollama] not running
[whisper] state=running health=starting
  ...
```

If a service is `health=unhealthy` or has errors in the last 5 lines, that's where to start.
