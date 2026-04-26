# Model Versions

Last reviewed: 2026-04-25 · Next review due: 2026-05-25

This file tracks the model versions Workforce0 ships as defaults. Update via PR after the monthly review (or sooner if a major release lands).

## Open weights (local, via Ollama)

| Use | Model | License | Size | Source |
|---|---|---|---|---|
| Reasoning (heavy) | `qwen3.5:32b` | Apache 2.0 | ~20 GB | https://ollama.com/library/qwen3.5 |
| Reasoning (default) | `mistral-small-3:24b` | Apache 2.0 | ~14 GB | https://ollama.com/library/mistral-small-3 |
| Reasoning (light) / extraction | `qwen3.5:8b` | Apache 2.0 | ~5 GB | https://ollama.com/library/qwen3.5 |
| Code generation | `qwen3.5-coder:32b` | Apache 2.0 | ~20 GB | https://ollama.com/library/qwen3.5-coder |

## STT (local, via faster-whisper-server)

| Use | Model | License | Size |
|---|---|---|---|
| Default | `Systran/faster-whisper-large-v3-turbo` | MIT | ~1.6 GB |
| Light (English-only) | `Systran/faster-distil-whisper-large-v3.en` | MIT | ~750 MB |

## Voice (local TTS)

| Use | Model | License | Size |
|---|---|---|---|
| Default | Kokoro 82M (Apache 2.0) | Apache 2.0 | ~300 MB |
| Multilingual tier-up | Qwen3-TTS | Apache 2.0 | ~1.5 GB |

## BYOK provider tiers (April 2026)

| Tier | Anthropic | Google | OpenAI |
|---|---|---|---|
| Reasoning (flagship) | `claude-opus-4-7` | `gemini-3.1-pro` | `gpt-5.5` |
| Reasoning (explicit CoT) | — | — | `o3` (or `o3-pro` opt-in) |
| Execution | `claude-sonnet-4-6` | `gemini-3.1-pro` | `gpt-5.4` |
| Extraction | `claude-haiku-4-5` | `gemini-3.1-flash` | `gpt-5-nano` |

## Review process

1. Check upstream releases for each model on the first Monday of each month.
2. If a major release dropped (e.g. Qwen 4, Claude 5, GPT-6), open a PR titled `chore(models): bump <provider> to <version>`.
3. Run the smoke test (`backend/scripts/smoke-test.ts`) against the new model before merging.
4. Update this file's "Last reviewed" date and "Next review due" (+30 days).
