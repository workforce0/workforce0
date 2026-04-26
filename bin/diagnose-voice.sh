#!/usr/bin/env bash
# Verify the local-voice profile end-to-end with a synthetic session.
#
# Requires:
#   - The local-voice Compose profile up (whisper, ollama, kokoro-tts, pipecat-bridge)
#   - The pipecat-bridge container started with DEBUG=1 (gates the synthetic endpoint)
#   - $BRIDGE_JWT_SECRET exported (matches the value in .env)
#   - tests/fixtures/voice-intake-sample.wav (commit-tracked or generated locally)

set -uo pipefail
cd "$(dirname "$0")/.."

echo "Workforce0 voice diagnostic — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "─────────────────────────────────────"

for svc in whisper ollama kokoro-tts pipecat-bridge; do
  cid=$(docker compose -f docker-compose.prod.yml ps -q "$svc" 2>/dev/null || true)
  if [ -z "$cid" ]; then echo "[$svc] not running"; continue; fi
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$cid" 2>/dev/null || echo unknown)
  echo "[$svc] health=$health"
done
echo

# Mint a JWT and POST a sample WAV to the bridge's debug synthetic endpoint.
# The bridge exposes /sessions/synthetic only when DEBUG=1 (see voice.md).
SAMPLE="tests/fixtures/voice-intake-sample.wav"
if [ ! -f "$SAMPLE" ]; then
  # Operator can generate this on first run if it isn't committed:
  #   say -o tests/fixtures/voice-intake-sample.wav --data-format=LEI16@16000 "hello this is a test"
  # (or use espeak-ng / any other TTS that writes < 100 KB 16-kHz mono PCM WAV.)
  echo "Sample WAV missing: $SAMPLE"
  echo "Generate one with: say -o $SAMPLE --data-format=LEI16@16000 \"hello this is a test\""
  exit 2
fi

if [ -z "${BRIDGE_JWT_SECRET:-}" ]; then
  echo "BRIDGE_JWT_SECRET not set in env — export it (matches .env) and retry."
  exit 2
fi

echo "Posting sample WAV to bridge synthetic endpoint…"
TOKEN=$(node -e "
  const jwt = require('jsonwebtoken');
  console.log(jwt.sign({ callId: 'diag', tenantId: 'default', sessionId: 'diag' },
    process.env.BRIDGE_JWT_SECRET, { expiresIn: '5m' }));
")
curl -fsS -X POST "http://localhost:8400/sessions/synthetic?token=$TOKEN" \
  -H "Content-Type: audio/wav" --data-binary "@$SAMPLE" | head -c 500
echo
