---
title: Local Models
description: Bundle Ollama + open-weights LLMs locally for self-hosted Workforce0 (no external AI account needed).
---

Workforce0's `local-llm` Compose profile bundles [Ollama](https://ollama.com) with open-weights models (Qwen 3.5 / Mistral Small 3) so the AI Council has a working fallback when no BYOK key is present.

## Enable

```bash
COMPOSE_PROFILES=local-llm docker compose -f docker-compose.prod.yml up -d
```

This adds one container (`workforce0-ollama`, ~5–20 GB depending on tier).

## Hardware tiers

The wizard auto-detects RAM and picks a tier. Override with `OLLAMA_DEFAULT_MODEL` in `.env`.

| Available RAM | Tier | LLM defaults | Disk |
|---|---|---|---|
| <9 GB | Light | `qwen3.5:8b` (all roles) | ~5 GB |
| 9–25 GB | Default | `mistral-small-3:24b` reasoning, `qwen3.5:8b` extraction | ~19 GB |
| ≥25 GB | Heavy | `qwen3.5:32b` reasoning + `qwen3.5:8b` warm | ~25 GB |

## How the AI Council uses local models

In `DEFAULT_MODEL_ASSIGNMENTS`, every agent role has a `fallbackChain` ending in an `ollama` entry. When the configured BYOK provider is unavailable, the Council falls through to the next entry — eventually landing on the local Ollama model. So a fresh install with no API keys still works on the local model alone.

Override per-role via env: `MODEL_BA_AGENT_ANTHROPIC=claude-opus-4-7` etc., or via the `AgentConfig` table.

## First-start expectation

The wizard apply step pulls the chosen model on first run (~5–12 GB depending on tier). Progress is streamed to the UI so you don't wonder if it's stuck.

## Resource budget

| State | RAM | Notes |
|---|---|---|
| Idle (1 model loaded) | ~5–8 GB | Light tier |
| Active inference (CPU) | +1–2 GB | Per request |
| Active inference (GPU) | similar host RAM, 5–12 GB VRAM | NVIDIA / Apple Silicon |

## Troubleshooting

- **Container OOM-killed** (`docker logs ollama` shows exit 137): switch to a lower tier (set `OLLAMA_DEFAULT_MODEL=qwen3.5:8b`) or close other applications.
- **Slow first response**: the model isn't pre-warmed. Backend pre-warms `qwen3.5:8b` on startup; warming the heavier tier requires a manual `docker exec workforce0-ollama ollama run <model>`.

See `MODELS.md` for the current pinned model versions and review cadence.
