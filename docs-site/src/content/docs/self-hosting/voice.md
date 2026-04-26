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

```
Workforce0 voice diagnostic
✓ whisper: healthy
✓ ollama:  healthy
✓ kokoro-tts: healthy
✓ pipecat-bridge: healthy

Synthetic session: STT 850ms · LLM 1.2s · TTS 320ms · total 2.4s
Transcript: "hello, this is a test"
```

If any step fails, see `bin/diagnose.sh` for full container logs.

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
