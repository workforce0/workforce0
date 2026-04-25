#!/usr/bin/env bash
# Apply wizard configuration: pull images, restart services, tail logs.
#
# Usage: ./bin/setup-finish.sh [--profile <profile>]...
# Examples:
#   ./bin/setup-finish.sh
#   ./bin/setup-finish.sh --profile meeting-bot --profile local-llm

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $(pwd)"
  echo "Run the wizard first or copy .env.example to .env"
  exit 1
fi

# Read COMPOSE_PROFILES from .env if not passed via flags.
if [ "${COMPOSE_PROFILES:-}" = "" ] && grep -q '^COMPOSE_PROFILES=' .env; then
  export "$(grep '^COMPOSE_PROFILES=' .env | head -1)"
fi

PROFILES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILES+=("--profile" "$2"); shift 2;;
    *) echo "Unknown arg: $1"; exit 2;;
  esac
done

echo "==> Pulling images..."
docker compose -f docker-compose.prod.yml "${PROFILES[@]}" pull

echo "==> Starting services..."
docker compose -f docker-compose.prod.yml "${PROFILES[@]}" up -d --remove-orphans

echo "==> Tailing backend + frontend logs (Ctrl-C to stop)..."
docker compose -f docker-compose.prod.yml logs -f --tail=20 backend frontend
