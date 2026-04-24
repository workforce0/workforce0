#!/bin/sh
# =============================================================================
# WORKFORCE0 BACKEND — container entrypoint
# =============================================================================
#
# Applies any pending Prisma migrations, then starts the server. This is
# what makes `docker compose up` work end-to-end on a fresh clone — the
# first boot lands on an empty Postgres, `migrate deploy` creates every
# table, and the app starts against a ready schema.
#
# `migrate deploy` is idempotent: it only applies migrations that haven't
# run yet, so subsequent boots are effectively a no-op.
#
# Skip knob: set `SKIP_DB_MIGRATE=1` to bypass migrations (useful when a
# sidecar / init container already ran them, or during debugging).
# =============================================================================

set -e

if [ "${SKIP_DB_MIGRATE:-0}" = "1" ]; then
  echo "entrypoint: SKIP_DB_MIGRATE=1 — skipping prisma migrate deploy"
else
  echo "entrypoint: applying pending Prisma migrations..."
  npx prisma migrate deploy --schema prisma/schema.prisma
fi

echo "entrypoint: starting backend..."
exec node dist/index.js
