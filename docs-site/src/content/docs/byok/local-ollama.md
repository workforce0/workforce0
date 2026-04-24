---
title: Local models (Ollama, llama.cpp, vLLM, LM Studio)
description: Run specialist agents against a local OpenAI-compatible endpoint. Zero data egress.
---

## Why local

- **Privacy.** Nothing transits a third-party provider. Transcripts,
  briefs, code context all stay on your machine.
- **Cost.** You already paid for the GPU; inference is free.
- **Offline.** Train deployments, air-gapped workshops, flaky-network
  environments.

## What works

Anything that exposes the **OpenAI-compatible chat completions
endpoint**:

- **Ollama** — `brew install ollama` or the installer.
- **LM Studio** — macOS / Windows GUI; OpenAI-compatible server mode.
- **vLLM** — high-throughput serving (production).
- **llama.cpp** with the `server` binary.
- **TabbyAPI**, **KoboldCPP**, etc.

All use the same config path.

## Set it up

```bash
# Example: Ollama on the host machine, with llama3.1:70b pulled
AI_CUSTOM_ENABLED=1
AI_CUSTOM_BASE_URL=http://host.docker.internal:11434/v1
AI_CUSTOM_API_KEY=sk-local-placeholder   # most local servers ignore this
AI_CUSTOM_MODELS=llama3.1:70b,qwen2.5-coder:14b,mistral-small:22b
```

The backend auto-registers a provider entry named `custom`. In
**Settings → AI providers** it shows as "Custom (local)".

## Routing roles to local

By default, specialists keep using whichever BYOK provider you set.
To route them local, set:

```bash
MODEL_BA_CUSTOM=llama3.1:70b
MODEL_ARCHITECT_CUSTOM=llama3.1:70b
MODEL_QA_CUSTOM=qwen2.5-coder:14b
# Planner stays on a frontier provider for quality
MODEL_PLANNER_ANTHROPIC=claude-sonnet-4-6
```

Specialists route to `custom` if it's set; otherwise they fall back
to the other providers in priority order.

## What NOT to route local

The **planner** (chief-of-staff) is best on a frontier model. Local
7B / 13B models produce plans but miss structural nuance. The plans
get rejected by the critique step and waste tokens retrying. Keep a
frontier model for the planner.

## Recommended local models

| Use case                  | Model                 | Size  | Reasoning |
| ------------------------- | --------------------- | ----- | --------- |
| Specialist (BA, architect) | `llama3.1:70b`       | 40 GB | Best reasoning/size ratio. |
| Coding tasks              | `qwen2.5-coder:14b`   | 8 GB  | Strong code synthesis. |
| Cheap summarisation       | `llama3.1:8b`         | 4 GB  | Fast; works on CPU. |
| Critique                  | `deepseek-r1:14b`     | 8 GB  | Reasoning-tuned. |

Needs Apple Silicon M2 Max / M3 Max or a 24GB+ GPU for the 70B
models. 13B variants run fine on a 16GB Mac.

## vLLM for production

vLLM's OpenAI-compatible server is the production-grade option:

```bash
docker run --gpus all -v ~/.cache/huggingface:/root/.cache/huggingface \
  -p 8000:8000 vllm/vllm-openai \
  --model meta-llama/Llama-3.1-70B-Instruct \
  --api-key sk-local-placeholder
```

Then point Workforce0 at it:

```bash
AI_CUSTOM_BASE_URL=http://vllm-host:8000/v1
```

Throughput is ~10× Ollama on the same GPU because of continuous
batching.

## Debugging local calls

```bash
# See what Workforce0 is sending
LOG_LEVEL=debug docker compose logs -f backend | grep 'ai:chat'
```

Logs show the full request (model, messages, params) at debug level.
Compare against a raw curl to the local endpoint to isolate
model-side vs Workforce0-side issues.

## Common problems

### "Model not found"

Ollama: `ollama pull llama3.1:70b` first.
LM Studio: load the model in the GUI before starting the server.

### Slow first response

Cold-start is real. Ollama unloads idle models after 5 minutes. Set
`OLLAMA_KEEP_ALIVE=24h` to keep models hot.

### Context window too small

Default Ollama `num_ctx` is 2048 — nowhere near enough for a brief
with context. Configure per-model:

```bash
# In a Modelfile
FROM llama3.1:70b
PARAMETER num_ctx 8192
```

Rebuild with `ollama create custom-llama3 -f ./Modelfile`.

### Tool-use / function-calling mismatches

Some local models don't support OpenAI-style tool calls cleanly.
Workforce0 works around this — if a call returns non-tool-call output,
it falls back to JSON parsing. But model-specific quirks exist; grep
backend logs for `tool:mismatch` after a regression.

## Hybrid mode (recommended)

The most cost-effective setup for real teams:

- **Planner + critique** → Anthropic Claude (~40% of calls by volume,
  ~60% by quality impact).
- **Specialists** → Local via Ollama / vLLM (~60% of volume).
- **Voice dial-in** → Gemini Live (free tier often covers it).

Monthly cost: ~$20–50 Anthropic + electricity.
