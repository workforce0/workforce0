---
title: Transcription
description: Local Whisper service via faster-whisper-server, with BYOK fallback to OpenAI/Deepgram.
---

Workforce0 transcribes uploaded meetings (and live capture, when enabled) via a provider chain configured by `STT_PROVIDER_CHAIN`. Local Whisper is the default first-class option.

## Enable local Whisper

```bash
COMPOSE_PROFILES=local-stt docker compose -f docker-compose.prod.yml up -d
```

This adds one container (`workforce0-whisper`, ~2 GB RAM idle, ~1.6 GB disk for the default model).

## Provider chain

Default: `STT_PROVIDER_CHAIN=local,openai`. Set in `.env` to override:

```bash
STT_PROVIDER_CHAIN=local,openai,deepgram
```

The router tries each in order. A provider is skipped if `isAvailable()` returns false (e.g. local container is down, or `OPENAI_API_KEY` is unset). On exception, it falls through to the next.

If the chain is exhausted, the meeting is marked failed with `All STT providers exhausted`.

## Models by tier

| Tier | Model | Notes |
|---|---|---|
| Default | `Systran/faster-whisper-large-v3-turbo` | 99 languages |
| Light (English-only) | `Systran/faster-distil-whisper-large-v3.en` | ~6× faster on CPU |
| GPU | same `large-v3-turbo` | float16, ~10× faster than CPU |

Override with `WHISPER_MODEL` in `.env`.

## CPU vs GPU

CPU transcription on `large-v3-turbo` runs at ~realtime (a 60-min meeting takes ~60 min). GPU (NVIDIA or Apple Silicon) is ~10× faster. For CPU-only hosts, consider adding a BYOK key (`OPENAI_API_KEY` or `DEEPGRAM_API_KEY`) to the chain.

## Diarization

Out of scope for Step 0. Vexa (the bundled meeting bot) handles its own diarization per-bot. Manual uploads get speaker-agnostic transcripts.

## Troubleshooting

- **Model download stuck**: `docker logs workforce0-whisper` — Hugging Face Hub rate limits or network issues. Backend retries 3× on container restart.
- **Transcription times out**: `WHISPER_TIMEOUT_MULT` controls the timeout (default 2× audio duration). Increase for very long files.
