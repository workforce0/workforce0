---
title: Anthropic (Claude)
description: How to set up Anthropic's Claude family with Workforce0.
---

## Get a key

1. Go to [console.anthropic.com](https://console.anthropic.com/).
2. **Settings → API Keys → Create key.**
3. Copy the `sk-ant-...` token.

Anthropic has no free tier. You'll need to add a payment method and
fund your workspace with at least $5 to make calls.

## Set the key

### Via `.env`

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Restart the backend container. The key is validated on start; a bad
key shows up as `[env:anthropic] Invalid API key` in the logs.

### Via the UI

**Settings → AI providers → Anthropic → Paste key → Save.** The UI
runs a validation call (`/v1/models`) before accepting. Saved keys
are encrypted before storage.

## Models used by default

| Role                | Default model                 | Why |
| ------------------- | ----------------------------- | --- |
| Planner (chief-of-staff) | `claude-sonnet-4-6`      | Best plan-quality per dollar. |
| Critique + revise   | Same as planner               | Same context, same model keeps consistency. |
| Specialists (BA, architect, QA) | `claude-haiku-4-5`   | Fast + cheap for routine work. |
| Long transcripts (summarisation) | `claude-sonnet-4-6`  | Handles 200k-token windows. |

Override any role via `MODEL_<ROLE>_ANTHROPIC` env vars. See
[Model registry](/architecture/model-registry/).

## Rate limits

Anthropic's rate limits are per-workspace and tier-gated:

- **Tier 1** (new account, <$100 spent): 50 req/min, ~1M tokens/min.
- **Tier 2** ($100+): 1k req/min, 2M+ tokens/min.
- **Tier 3+**: enterprise, much higher.

Workforce0 respects `429` responses by backing off and retrying.
Persistent 429s degrade this provider in the AI Council for 60s.

## Cost rough numbers

Based on Anthropic's published pricing at time of writing:

| Model              | Input $/1M | Output $/1M | Typical brief cost |
| ------------------ | ----------:| -----------:| -------------------|
| Claude Sonnet 4.6  | $3.00      | $15.00      | ~$0.10             |
| Claude Haiku 4.5   | $0.80      | $4.00       | ~$0.02             |

Prompt caching is enabled by default — see
[Model registry](/architecture/model-registry/).

## Claude Code subscription (indirect)

If you have a Claude Code (or Pro) subscription on your local machine,
the **agent daemon** can use it for code-gen via the CLI, not the API.
This is handled separately from the BYOK Anthropic key — see
[Agent daemon](/architecture/agent-daemon/).

The subscription key is never transmitted over the network. It stays
on your machine.

## What breaks

### Invalid / revoked key

The provider page shows red. Calls fall back to other Council members.
Fix: rotate the key.

### Overage on budget

Anthropic doesn't throttle on spend (paid tier). Workforce0's
`PLANNER_MONTHLY_BUDGET_TOKENS` gates do — see [Cost caps](/byok/cost-caps/).

### Region unavailability

Some regions have occasional 503s. The retry loop handles it. If
sustained, switch to OpenAI or Gemini until Anthropic recovers.

## Data processing

From Anthropic's current policy:

- API inputs and outputs are NOT used to train models by default.
- Retention: minimum necessary for providing the service.
- Workforce0 doesn't opt in to anything extra.

Read the current policy at [anthropic.com/legal](https://www.anthropic.com/legal).
