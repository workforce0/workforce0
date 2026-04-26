# Workforce0 CLI scripts

## `setup-finish.sh`

Apply the wizard's chosen configuration: pull container images, restart the stack with the right profiles enabled, then tail backend + frontend logs.

```bash
./bin/setup-finish.sh
./bin/setup-finish.sh --profile local-llm --profile local-stt
```

If no `--profile` flags are passed, reads `COMPOSE_PROFILES` from `.env`. Designed to run after the wizard has written `.env`; idempotent.

## `diagnose.sh`

Collects health + last 5 log lines from every Workforce0 container into a timestamped file. PII-aware: redacts `.env` secret values inline.

```bash
./bin/diagnose.sh
# → diagnostics-20260425T120000.txt
```

Share the output file when filing support issues.

## `diagnose-voice.sh`

Runs an end-to-end synthetic session against the `local-voice` profile (whisper + ollama + kokoro-tts + pipecat-bridge). Reports per-container health, mints a short-lived JWT, and POSTs `tests/fixtures/voice-intake-sample.wav` to the bridge's `/sessions/synthetic` debug endpoint.

```bash
export BRIDGE_JWT_SECRET=<same-as-.env>
./bin/diagnose-voice.sh
# → [whisper] health=healthy
# → [ollama]  health=healthy
# → [kokoro-tts] health=healthy
# → [pipecat-bridge] health=healthy
# → {"transcript": {...}, "audioBytes": 4096}
```

Requires the bridge container to be started with `DEBUG=1` so the synthetic endpoint is exposed. See [`docs-site` → Self-hosting → Voice smoke test](https://docs.workforce0.com/self-hosting/voice/) for the full walkthrough.

