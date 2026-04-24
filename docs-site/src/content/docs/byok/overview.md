---
title: BYOK overview
description: Bring your own API keys — the Workforce0 cost model, provider matrix, and decision tree.
---

## The BYOK deal

Workforce0 doesn't resell AI tokens. Every LLM call uses a provider
API key that you own. You pay the provider directly at the provider's
published rate. We don't take a cut.

Benefits:

- **No markup.** The API list price is what you pay.
- **Full cost visibility.** Your provider dashboard shows what you
  spent.
- **Switchable.** When Anthropic ships a cheaper model, switch. No
  platform lock-in.
- **Free tiers count.** A free Gemini key is a legitimate production
  provider for light use.

## The provider matrix

| Provider      | Required for | Free tier | Notes |
| ------------- | ------------ | --------- | ----- |
| Anthropic     | Nothing specific; Claude Sonnet is the default planner if set | No (paid only) | Best-in-class writing quality. |
| OpenAI        | Nothing specific; gpt-4o is the default planner if set | No | Widest integration surface. |
| Google (Gemini) | Voice dial-in (Gemini Live); planner alternative | Yes, generous | Fastest cheap tier. |
| Ollama (local) | Specialist agents (BA, QA) for privacy | N/A | No network required. |
| llama.cpp / LM Studio / vLLM | Same as Ollama | N/A | OpenAI-compatible endpoint. |

## The decision tree

### "I want to try it on free tier"

Get a Gemini API key. Set `GEMINI_API_KEY`. Done.

### "I want production quality on a single provider"

Anthropic + Claude Sonnet is a good single-provider choice for
plan quality. OpenAI + GPT-4o is a close second.

### "I want AI Council quorum"

Set at least two of: Anthropic, OpenAI, Gemini. Three is better. See
[AI Council](/features/ai-council/).

### "I want to run sensitive content locally"

Ollama + one frontier provider (as a fallback for complex planning).
Specialist agents route to Ollama by role assignment — see
[Local models](/byok/local-ollama/).

### "I want to cap monthly spend hard"

Set `PLANNER_MONTHLY_BUDGET_TOKENS` + `AGENT_MONTHLY_BUDGET_TOKENS`.
See [Cost caps](/byok/cost-caps/).

## Where keys live

### In `.env` (installer-side)

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

### In the `ai_providers` table (workspace-side)

The setup wizard also asks for keys. They're encrypted with AES-256-GCM
(key derived from `JWT_SECRET`) and stored in the `ai_providers` table.
The runtime reads from `.env` first, then from the database.

### Per-provider override

```bash
# Override the planner model choice per-provider
MODEL_PLANNER_ANTHROPIC=claude-sonnet-4
MODEL_PLANNER_OPENAI=gpt-4o
MODEL_PLANNER_GOOGLE=gemini-2.0-flash-exp
```

## Key rotation

1. Generate the new key in the provider dashboard.
2. Update `.env` on your host, OR update the UI (**Settings → AI
   providers**).
3. Restart the backend container (if you updated `.env`), OR click
   **Reload** in the UI.
4. Verify: the **AI providers** page shows a green "OK" badge next to
   the updated provider.
5. Revoke the old key in the provider dashboard.

If a rotation breaks anything, the old key works until you revoke it
in step 5.

## When the primary key fails

The AI Council falls back gracefully:

- **Strict quorum mode** — if fewer than `AI_COUNCIL_MIN_PROVIDERS`
  respond, the planner uses the deterministic fallback (a single-step
  stub). Nothing crashes.
- **Majority mode** — majority wins; absent providers don't veto.
- **Best-available** (default) — tries all, uses whichever returns
  first. Falls back to a single-step stub only if ALL fail.

## What providers see

The same thing they'd see from any application using their API:

- The prompt (system + user messages).
- Optionally, tool definitions (most calls don't use tools).
- Metadata in the HTTP headers (`User-Agent: workforce0/X.Y.Z`).

What they do NOT see:

- Your database contents beyond what's in the prompt.
- Other tenants' content.
- Any secrets from your `.env`.

This is the same contract as any other BYOK product. Respect the
providers' ToS; don't share keys with third parties.

## Provider outage

Providers go down. Our approach:

1. **Detect** — AI calls failing twice get the provider marked
   `degraded`.
2. **Route around** — the next call skips that provider; AI Council
   quorum falls back to available providers.
3. **Recover** — every 60 seconds, the system retries the degraded
   provider with a cheap call; on success, `degraded` → `healthy`.

No config needed. The status is visible in **Settings → AI providers**
and as a Prometheus metric (`wf0_ai_provider_health{provider,status}`).

## Pricing reality

Back-of-envelope monthly costs for 50 briefs / day at the default
Council quorum (3 providers):

- Planner calls (~5k tokens each, 50/day × 3 providers): ~$15/mo
  Anthropic + ~$10/mo OpenAI + ~$0 Gemini free tier.
- Specialist calls (~10k tokens each, 200/day × 1 provider): ~$40/mo
  on Anthropic Haiku.

Total: ~$65/mo typical. See [Cost caps](/byok/cost-caps/) to put an
upper bound.

## What's next

- Detailed provider setup: [Anthropic](/byok/anthropic/),
  [OpenAI](/byok/openai/), [Google](/byok/google/),
  [Ollama](/byok/local-ollama/).
- Ceiling your spend: [Cost caps](/byok/cost-caps/).
- Understand the consensus model: [AI Council](/features/ai-council/).
