#!/usr/bin/env bash
# Verify the local-voice profile end-to-end with a synthetic session.
#
# Requires:
#   - The local-voice Compose profile up (whisper, ollama, kokoro-tts, pipecat-bridge)
#   - The pipecat-bridge container started with DEBUG=1 (gates the synthetic endpoint)
#   - $BRIDGE_JWT_SECRET exported (matches the value in .env)
#   - tests/fixtures/voice-intake-sample.wav (commit-tracked or generated locally)
#
# Optional:
#   - $COMPOSE_PROJECT_NAME (default: parent dir name) — must match the project
#     used at `docker compose ... up`. Without this the ps lookups silently
#     report "not running" even when services are up under a non-default project.
#   - $BRIDGE_HOST_PORT (default: 8400) — host port the bridge is published on.

set -uo pipefail
cd "$(dirname "$0")/.."

PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"
BRIDGE_HOST_PORT="${BRIDGE_HOST_PORT:-8400}"

echo "Workforce0 voice diagnostic — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  project = $PROJECT"
echo "  bridge  = http://localhost:${BRIDGE_HOST_PORT}"
echo "─────────────────────────────────────"

for svc in whisper ollama kokoro-tts pipecat-bridge; do
  cid=$(docker compose -f docker-compose.prod.yml -p "$PROJECT" ps -q "$svc" 2>/dev/null || true)
  if [ -z "$cid" ]; then echo "[$svc] not running"; continue; fi
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$cid" 2>/dev/null || echo unknown)
  echo "[$svc] health=$health"
done
echo

# Mint a JWT and POST a sample WAV to the bridge's debug synthetic endpoint.
# The bridge exposes /sessions/synthetic only when DEBUG=1 (see voice.md).
SAMPLE="tests/fixtures/voice-intake-sample.wav"
if [ ! -f "$SAMPLE" ]; then
  echo "Sample WAV missing: $SAMPLE"
  echo "Generate one with: say -o $SAMPLE --data-format=LEI16@16000 \"hello this is a test\""
  echo "  (or use espeak-ng / any TTS that writes a small 16-kHz mono PCM WAV)"
  exit 2
fi

if [ -z "${BRIDGE_JWT_SECRET:-}" ]; then
  echo "BRIDGE_JWT_SECRET not set in env — export it (matches .env) and retry."
  exit 2
fi

echo "Posting sample WAV to bridge synthetic endpoint…"

# Mint JWT in Python so we don't need a Node install or `npm i jsonwebtoken`.
# Python 3 stdlib ships everything we need (json, base64, hmac, hashlib).
TOKEN=$(BRIDGE_JWT_SECRET="$BRIDGE_JWT_SECRET" python3 - <<'PY'
import base64, hashlib, hmac, json, os, time

secret = os.environ["BRIDGE_JWT_SECRET"].encode()

def b64(data: bytes) -> bytes:
    return base64.urlsafe_b64encode(data).rstrip(b"=")

header  = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
payload = b64(json.dumps(
    {"callId": "diag", "tenantId": "default", "sessionId": "diag", "exp": int(time.time()) + 300},
    separators=(",", ":"),
).encode())
sig = b64(hmac.new(secret, header + b"." + payload, hashlib.sha256).digest())
print((header + b"." + payload + b"." + sig).decode())
PY
)

if [ -z "$TOKEN" ]; then
  echo "Failed to mint JWT (python3 missing or hmac failure)"
  exit 3
fi

curl -fsS -X POST "http://localhost:${BRIDGE_HOST_PORT}/sessions/synthetic?token=${TOKEN}" \
  -H "Content-Type: audio/wav" --data-binary "@$SAMPLE" | head -c 1024
echo
