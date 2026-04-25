# Workforce0 CLI scripts

## `setup-finish.sh`

Apply the wizard's chosen configuration: pull container images, restart the stack with the right profiles enabled, then tail backend + frontend logs.

```bash
./bin/setup-finish.sh
./bin/setup-finish.sh --profile meeting-bot --profile local-llm --profile local-stt
```

If no `--profile` flags are passed, reads `COMPOSE_PROFILES` from `.env`. Designed to run after the wizard has written `.env`; idempotent.

## `diagnose.sh`

Collects health + last 5 log lines from every Workforce0 container into a timestamped file. PII-aware: redacts `.env` secret values inline.

```bash
./bin/diagnose.sh
# → diagnostics-20260425T120000.txt
```

Share the output file when filing support issues.

## `bootstrap-vexa-db.sh`

One-time creation of the `workforce0_vexa` database on an existing Postgres instance. The bundled `meeting-bot` profile (Vexa) needs a separate database; new installs get it via `backend/db-init/01-create-vexa-db.sql` (only runs on a fresh Postgres volume). Existing installs need this script.

```bash
./bin/bootstrap-vexa-db.sh
```

Idempotent — checks for the database first and exits cleanly if it already exists. Run before enabling the `meeting-bot` Compose profile.
