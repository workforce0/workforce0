# Bring Your Own Keys (BYOK)

Workforce0 never bills you for AI inference. You plug in keys for the providers you already pay for, and Workforce0 routes requests to them.

## Why BYOK?

- **No markup.** You pay provider prices directly — no platform margin.
- **Your data stays yours.** Prompts and responses go between your self-hosted instance and the provider. Workforce0 (the project) never sees them.
- **Pick your trade-offs.** Cheap? Gemini Flash. Quality? Claude Opus. Reasoning? GPT-4o. Mix and match.
- **Fallback for free.** If one provider is down, Workforce0 fails over to another.

## Required: one AI provider

You need at least one. Gemini is recommended because it has a generous free tier.

### Google Gemini (recommended)

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
2. Click **Create API key**.
3. Copy the key.
4. In Workforce0 **Settings → AI providers**, paste it into **Gemini API key** and click **Test connection**.

**Free tier (no credit card):** 15 requests/minute and **1,500 requests/day** on `gemini-2.0-flash`, explicitly allowed for automated/programmatic use under Google's AI Studio terms. That's enough to run a small team's planner + BA roles for free. Once you exceed the daily cap, API calls 429 until the next UTC day reset — Workforce0 logs the 429s clearly so you know to upgrade.

**Paid tier:** among the cheapest on the market; pay-as-you-go, no minimum.

**Best for:** Brief generation, voice (via Gemini Live), fast drafts, the chief_of_staff planner on small teams.

## Optional: extra Council models

Workforce0's AI Council uses one model to generate, a second to critique, and (optionally) a third to resolve disagreements. Adding more providers makes consensus stronger.

### Anthropic Claude

1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).
2. Click **Create Key**.
3. Paste into **Settings → AI providers → Anthropic API key**.

**Best for:** Code generation, structured critique, long-context reasoning.

> **Note:** Routing programmatic/orchestration workloads through a
> personal Claude Pro or ChatGPT Plus subscription is **not supported**
> by either provider's ToS. Use API keys, or see the [Local models](#optional-local-models-zero-cost)
> section below for a genuinely zero-cost path.

### OpenAI (OpenAI)

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Click **Create new secret key**.
3. Paste into **Settings → AI providers → OpenAI API key**.

**Best for:** Deep reasoning, adversarial critique, edge-case catching.

## Optional: local models (zero cost)

Workforce0 also speaks to anything with an OpenAI-compatible API —
meaning you can run it against **[Ollama](https://ollama.com)**,
**[LM Studio](https://lmstudio.ai)**, **[llama.cpp](https://github.com/ggerganov/llama.cpp)**,
**vLLM**, or any other self-hosted inference server. Zero tokens billed,
zero ToS risk.

### Quickstart: Ollama + Workforce0

```bash
# 1. Install Ollama on the same host as the Workforce0 backend
#    (or on any box reachable from it).
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull a capable model. Llama 3.1 70B is a solid baseline for
#    the specialist roles; smaller models (8B, 13B) work for
#    routine tasks. See the "What runs where" table below.
ollama pull llama3.1:70b

# 3. Ollama serves on localhost:11434 by default with an
#    OpenAI-compatible endpoint at /v1.
ollama serve   # usually already running as a service
```

In Workforce0: **Settings → AI providers → Add custom provider**

- **Provider type:** Custom (OpenAI-compatible)
- **Base URL:** `http://localhost:11434/v1`
- **API key:** `ollama` (any non-empty string; Ollama ignores it)
- **Model id:** `llama3.1:70b` (or whatever you pulled)

Click **Test**. You should see a green check.

Then in **Settings → Agent model assignments**, route specialist
roles (dev_agent, qa_agent, memory_optimizer) to your local model.

### What runs where

Local models and frontier models are not interchangeable. Some roles
degrade gracefully on a local 70B; others collapse.

| Role | Local model OK? | Why |
|---|---|---|
| `chief_of_staff` (planner) | ❌ Not recommended for v0.1 | Open-ended decomposition of ambiguous inputs. A frontier model (Gemini 2.5 Pro / Claude Opus / GPT-5) is load-bearing here. Use BYOK. |
| `ba_agent` | ⚠️ Acceptable on 70B+ | Structured extraction from transcripts; smaller models miss nuance. |
| `dev_agent` | ✅ With a code-tuned local model (Qwen 2.5 Coder, DeepSeek Coder) | Specialist task, well-scoped inputs. |
| `qa_agent` | ✅ Same as dev_agent | Focused scope. |
| `memory_optimizer` | ✅ Any 8B+ | Summarization + dedupe; doesn't need frontier quality. |

Short version: **put your API dollars into the planner and the BA
agent; run everything else locally.**

### LM Studio / vLLM / text-generation-webui

Same pattern: any OpenAI-compatible server works. Point Workforce0
at the server's `/v1` endpoint and pick a model id. No additional
configuration needed — `createModelClient(provider='custom')` in the
backend routes through the OpenAI client with whatever base URL you
gave.

### Air-gapped deployments

Combine: **Ollama for all roles** + **the free-tier Gemini API for
the planner** (1500 req/day, explicitly permitted by Google's ToS),
and you have a fully allowed, effectively-free install. For teams
that can't use Google either, route the planner to a larger local
model (Llama 3.1 405B via vLLM on a GPU server) and accept
lower-quality decompositions until you can BYOK.

## Optional: integration keys

These aren't AI keys, but they follow the same BYOK pattern — you paste a token, Workforce0 uses your account.

| Integration | Where to get the key | Setup guide |
|---|---|---|
| Jira | [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) | [jira-setup.md](../mvp/docs/) |
| Google Chat | Google Chat space → Apps & integrations → Webhooks | [gchat-setup.md](../mvp/docs/google-chat-setup.md) |
| Google Drive | OAuth — click **Connect** in Settings | [gdrive-setup.md](../mvp/docs/google-drive-setup.md) |
| Twilio (voice) | [twilio.com/console](https://twilio.com/console) | [twilio-setup.md](../mvp/docs/twilio-voice-bot.md) |

## How the Council picks models

Default routing:

| Task | Primary | Critic | Fallback |
|---|---|---|---|
| Brief generation | Gemini Flash | Claude Sonnet | GPT-4o |
| Code generation | Claude Sonnet | GPT-4o | Gemini |
| Critique / review | GPT-4o | Claude Sonnet | Gemini |
| Voice (real-time) | Gemini Live | — | — |

All configurable per-workspace in **Settings → AI providers → Advanced**.

## Key rotation

Rotate your keys periodically. To update:

1. Generate a new key in the provider's console.
2. **Settings → AI providers → [provider] → Edit**.
3. Paste the new key, click **Test**, then **Save**.
4. Revoke the old key in the provider's console.

Workforce0 stores keys encrypted at rest (AES-256-GCM with `JWT_SECRET`-derived key).

## Cost monitoring

Workforce0 logs every model call to the `usage_log` table — tokens in, tokens out, cost estimate.

View in-app: **Dashboard → Costs**.

Or query directly:
```sql
select provider, sum(cost_usd) from usage_log
where created_at > now() - interval '30 days'
group by provider;
```
