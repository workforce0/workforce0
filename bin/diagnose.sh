#!/usr/bin/env bash
# Workforce0 diagnostic — collects health + last log lines for all services.
# PII-aware: redacts .env values from output.

set -uo pipefail

cd "$(dirname "$0")/.."

OUTFILE="diagnostics-$(date +%Y%m%dT%H%M%S).txt"

{
  echo "Workforce0 diagnostic — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "─────────────────────────────────────"
  echo

  for svc in backend frontend postgres redis ollama whisper; do
    cid=$(docker compose -f docker-compose.prod.yml ps -q "$svc" 2>/dev/null || true)
    if [ -z "$cid" ]; then
      echo "[$svc] not running"
      continue
    fi
    state=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$cid" 2>/dev/null || echo unknown)
    echo "[$svc] state=$state health=$health"
    echo "  last 5 log lines:"
    docker logs --tail 5 "$cid" 2>&1 | sed 's/^/    /' | sed -E 's/(API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL)=[^ ]+/\1=<redacted>/g'
    echo
  done

  echo "─────────────────────────────────────"
  echo "Output captured to ./$OUTFILE"
} | tee "$OUTFILE"

echo "Share $OUTFILE in your support thread (PII-redacted)."
