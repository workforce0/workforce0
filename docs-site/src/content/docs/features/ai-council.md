---
title: AI Council
description: Multi-model consensus for planner calls. One provider down? The council keeps planning.
---

## The idea

Every planner call routes through the **AI Council** — Claude + GPT +
Gemini in parallel — and consensus decides the final plan. The goal
is threefold:

1. **Quality** — multiple frontier models catch each other's
   shortcuts.
2. **Resilience** — one provider outage doesn't block the team.
3. **Cost transparency** — BYOK means you see the exact spend per
   provider.

You can run it single-provider; the Council just becomes "one member
plus a deterministic fallback." But consensus is where the quality
bump comes from.

## Modes

Set via `AI_COUNCIL_MODE`:

| Mode              | Behaviour                                                | Good for |
| ----------------- | -------------------------------------------------------- | -------- |
| `strict-quorum`   | Require ≥ N providers to respond. If N-1, use fallback. | Regulated / mission-critical |
| `majority`        | Run all; majority decides. Dissenters are logged.        | Production (default) |
| `best-available`  | First acceptable response wins. Cheapest to run.          | Hobbyist / tight budget |

Tune `AI_COUNCIL_MIN_PROVIDERS` (default `2`) to require a quorum
size.

## How consensus works (for plans)

Each provider returns a JSON-structured plan:
`{ summary: string, steps: [{ title, description, roleSlug, … }] }`.

For `majority` mode:

1. All providers run in parallel.
2. Each plan is scored on **structural consistency**: step count,
   role distribution, dependency graph.
3. The plan most similar to the pack is chosen. Outliers (wildly
   different step counts, unusual role picks) are noted in the
   metrics.
4. If providers disagree more than a threshold, the critique step
   runs a second round targeting the disagreement.

## The critique-revise loop (M8.1)

After a plan is picked, a **critique call** scores it on five axes
(coverage, feasibility, dependencies, missing context, ambiguity),
0–5 each, 25 total.

Threshold: `CRITIQUE_REVISE_THRESHOLD=20`. Below that, a **revise
call** runs once with the critique as added context.

This is independent of the Council — every plan goes through
critique-revise whether it's one provider or three.

## Self-consistency (M8.2)

Orthogonal to Council: each provider generates `SELF_CONSISTENCY_N=3`
drafts. The most structurally-consistent draft wins. Absorbs
prompt-level instability without needing N providers.

Default: 3 drafts, 1 critique, 1 optional revise = ~5 LLM calls per
Council member per brief.

## Cost of Council mode

For `majority` mode with 3 providers:

- 3 × 3 drafts = 9 draft calls.
- 1 critique + optional revise = 2.
- Plan-finalize synthesis (rare): 1 call.

Total: ~12 LLM calls per brief. At ~5k tokens per call that's ~60k
tokens per brief, ~$0.30 total across the three providers for a
Claude/GPT/Gemini mix.

Cheaper paths:

- `best-available` + `SELF_CONSISTENCY_N=1`: 1 call per brief.
- Single provider + critique-revise: 2 calls per brief.
- Hybrid: Council for planning, single provider for specialists.

## Disagreement insight

When Council members disagree sharply, that's signal. Workforce0
exposes it:

- **Analytics → Council disagreement rate** — plans where ≥1 provider
  voted differently.
- Each `ExecutionPlan` has a `councilVote` audit record linking to
  each provider's draft.

Use this to tune prompts and pick models that agree more often on
the kinds of plans you want.

## Provider failure behaviour

- Network error / 5xx → the provider is marked **degraded** for 60s.
  Council proceeds with remaining members; the critique still runs.
- Malformed JSON → the draft is discarded (common from local models).
  Falls back to structured re-asks or the fallback plan.
- Rate limit (429) → same as network error; the Council doesn't
  retry within a plan.

## Code pointers

- Orchestration: `backend/src/services/chief-of-staff/planner-llm.ts`.
- Model routing: `backend/src/services/model-registry/`.
- Council mode evaluation: `backend/src/services/chief-of-staff/council.ts`.

Tests: `backend/src/services/chief-of-staff/__tests__/planner-llm.test.ts`
has ~40 cases covering Council behaviour.

## Disabling the Council

Set `AI_COUNCIL_MIN_PROVIDERS=1` and `AI_COUNCIL_MODE=best-available`.
You now have a single-provider LLMPlanner with critique-revise still
active. Saves tokens if you trust one provider over the Council
dynamic.
