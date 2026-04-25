#!/usr/bin/env bash
# One-time: create the workforce0_vexa database on an existing Postgres
# instance for installs that pre-date Step 0's meeting-bot bundle.
#
# Idempotent — safe to run multiple times.
#
# Usage: ./bin/bootstrap-vexa-db.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker compose -f docker-compose.prod.yml ps -q postgres > /dev/null 2>&1; then
  echo "ERROR: postgres container not running. Start the stack first:"
  echo "  docker compose -f docker-compose.prod.yml up -d postgres"
  exit 1
fi

echo "==> Checking workforce0_vexa database..."
EXISTS=$(docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='workforce0_vexa'" 2>/dev/null || echo "")

if [ "$EXISTS" = "1" ]; then
  echo "OK workforce0_vexa already exists - nothing to do."
  exit 0
fi

echo "==> Creating workforce0_vexa..."
docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -c "CREATE DATABASE workforce0_vexa"
echo "OK Created. Now restart the meeting-bot profile:"
echo "  docker compose -f docker-compose.prod.yml --profile meeting-bot up -d"
