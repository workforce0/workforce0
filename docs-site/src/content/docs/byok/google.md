---
title: Google (Gemini)
description: Free-tier-friendly. Required for Gemini Live (voice dial-in).
---

## Get a key

1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. **Create API key**.
3. Paste into Workforce0.

### Free tier limits

Gemini has a **production-grade free tier**:

- 15 requests / minute
- 1,500 requests / day
- 1M input tokens / month free

This is enough for a hobbyist or small team deployment out of the
box. No credit card required.

## Set the key

```bash
GEMINI_API_KEY=AIza...
```

Or: **Settings → AI providers → Google (Gemini) → Paste key**.

## Models used by default

| Role                | Default model             |
| ------------------- | ------------------------- |
| Planner             | `gemini-2.0-flash-exp`    |
| Critique + revise   | `gemini-2.0-flash-exp`    |
| Specialists         | `gemini-2.0-flash`        |
| Voice live          | `gemini-2.0-flash-live-001` |

Override via `MODEL_<ROLE>_GOOGLE`.

## Voice dial-in

Gemini Live is the backend for voice dial-in. You need a Gemini API
key with Live API access enabled — it's enabled by default on new
projects. See [Voice dial-in](/usage/voice/).

## Rate limits

The free-tier limits (15 req/min, 1.5k req/day) apply per API key.
Workforce0 handles them:

- Dispatches are throttled to stay under 15/min.
- 429 responses are backed off.
- Sustained failures degrade Gemini in the AI Council.

## Cost rough numbers

| Model                   | Free tier | Paid input $/1M | Paid output $/1M |
| ----------------------- | --------- | ---------------:| ----------------:|
| Gemini 2.0 Flash         | yes       | $0.075          | $0.30            |
| Gemini 2.0 Flash-Lite    | yes       | $0.019          | $0.075           |
| Gemini Live (per minute) | yes       | $0.10 / minute  | —                |

## Vertex AI

Vertex AI (Google Cloud) is supported as an alternative to the
Generative Language API. Set:

```bash
GEMINI_USE_VERTEX=1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
VERTEX_PROJECT_ID=your-gcp-project
VERTEX_LOCATION=us-central1
```

Useful if you're already on GCP and want billing + audit on the same
invoice.

## What breaks

### "Quota exceeded — retry at…"

Free-tier exhaustion. Add billing on the Google Cloud console to
unlock paid tier, or wait.

### Token-counting drift

Google's token counter occasionally disagrees with ours by <1%. We
use theirs (via their count-tokens endpoint) for billing-accurate
numbers. No action needed.

### Safety filters

Gemini's default safety settings block "dangerous content" (weapons,
self-harm, etc). Legitimate briefs referencing such content (security
research, policy work) get filtered. Workforce0 sets the safety
thresholds to `BLOCK_ONLY_HIGH` by default — tune via
`GEMINI_SAFETY_LEVEL`.

## Data processing

Current policy:

- **Free tier**: inputs and outputs MAY be used to improve Google
  products. If that's unacceptable, upgrade to the paid tier.
- **Paid tier**: inputs / outputs are NOT used for training.

Read the live policy at
[ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms).
