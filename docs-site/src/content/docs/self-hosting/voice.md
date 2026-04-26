---
title: Voice smoke test
description: Verify the local-voice profile end-to-end before tagging a release.
---

Run this on a 16 GB host (Mac or Linux) to verify Pipecat is wired correctly.

```bash
docker compose -f docker-compose.prod.yml \
  --profile local-llm --profile local-stt --profile local-voice up -d

# Wait for whisper, ollama, kokoro-tts, pipecat-bridge to be healthy.
docker ps --filter "label=com.docker.compose.project=workforce0-public"

# Run the diagnose script (plays a sample WAV through the pipeline).
./bin/diagnose-voice.sh
```

## Expected output

The script prints a UTC-stamped header, a one-line health status for
each voice service, and the first 500 bytes of the bridge's synthetic
response. A healthy run looks roughly like:

```
Workforce0 voice diagnostic — 2026-04-25T12:00:00Z
─────────────────────────────────────
[whisper] health=healthy
[ollama] health=healthy
[kokoro-tts] health=healthy
[pipecat-bridge] health=healthy

Posting sample WAV to bridge synthetic endpoint…
{"sessionId":"diag","transcript":"hello this is a test", ... }
```

Any `health=unhealthy` / `health=starting` line, a non-zero exit, or a
missing trailing JSON body means the pipeline isn't fully wired — check
the per-service logs (see below) before running real calls.

If any step fails, run `bin/diagnose-voice.sh` for end-to-end voice
diagnostics (the general-purpose `bin/diagnose.sh` covers the rest of the
stack but does not exercise the kokoro/pipecat-bridge pipeline). To dump
the recent logs for the voice services directly:

```sh
docker compose -f docker-compose.prod.yml logs --tail=100 kokoro-tts pipecat-bridge whisper ollama
```

## Enabling the synthetic endpoint

The bridge's `/sessions/synthetic` endpoint is gated by `DEBUG=1`. The
`diagnose-voice.sh` script expects the bridge container to be started with
`DEBUG=1` in its environment. To enable it temporarily:

```bash
DEBUG=1 docker compose -f docker-compose.prod.yml \
  --profile local-voice up -d pipecat-bridge
```

Disable again after the diagnostic is done — the endpoint accepts arbitrary
audio and shouldn't be exposed in production.
