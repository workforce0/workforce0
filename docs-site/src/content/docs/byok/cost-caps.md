---
title: Cost caps
description: Put an upper bound on monthly AI spend so a runaway plan can't bankrupt you.
---

## Why caps matter

Every AI-driven product has a "stuck in a loop" failure mode. Ours is
the replan cycle: a plan fails → replan → fails again → replan again →
burns tokens on every attempt. Workforce0 mitigates this with an
attempt cap (`PLAN_ATTEMPT_CAP=3` by default), but caps at the
provider-cost layer are the defense-in-depth.

## Cap variables

| Var                            | Applies to                              |
| ------------------------------ | --------------------------------------- |
| `PLANNER_MONTHLY_BUDGET_TOKENS` | chief-of-staff plan + critique + revise |
| `AGENT_MONTHLY_BUDGET_TOKENS`  | each specialist (BA, architect, dev, QA) |
| `VOICE_MONTHLY_MINUTES`        | Twilio + Gemini Live voice minutes      |
| `TRANSCRIPTION_MONTHLY_MINUTES` | Whisper calls                          |

All are **soft defaults**: set them in `.env` or override per-role in
the **Settings → Roles → Budget** panel.

## What happens when you hit a cap

The budget gate lives in `LLMPlanner.budgetGate` and runs before each
LLM call. When the month-to-date spend exceeds the cap:

- **Planner**: falls back to a deterministic single-step plan. Every
  brief becomes "Step 1: review and decide." The exec is informed via
  Slack with a **Budget exceeded** badge.
- **Specialists**: refuse to claim new tickets; existing tickets
  finish but new ones stay in the queue. Team gets a Slack alert.
- **Voice**: dial-in answers with "we've hit this month's quota;
  please upload a recording instead."

No silent cost blow-outs. Your wallet survives the accident.

## Setting caps

```bash
# Conservative — single team, ~$50/mo
PLANNER_MONTHLY_BUDGET_TOKENS=500000
AGENT_MONTHLY_BUDGET_TOKENS=2000000
VOICE_MONTHLY_MINUTES=300

# Generous — power user, ~$200/mo
PLANNER_MONTHLY_BUDGET_TOKENS=2000000
AGENT_MONTHLY_BUDGET_TOKENS=10000000
VOICE_MONTHLY_MINUTES=1000

# No cap (you know what you're doing)
# Unset any of the above.
```

Reset on the 1st of each month automatically.

## Per-role caps (finer grain)

For more control, cap individual roles:

**Settings → Roles → (pick role) → Budget**. Each role has its own
`monthlyBudgetTokens`. A brief that hits the `dev_agent` cap doesn't
prevent `ba_agent` from running on other briefs.

## Monitoring spend

Three places:

1. **Provider dashboards** — Anthropic / OpenAI / Google all show
   current-month spend. Set billing alerts in their UIs too.
2. **Workforce0 analytics** — **Analytics → AI spend**. Same data,
   per-project and per-role rollup.
3. **Prometheus metric** — `wf0_ai_tokens_total` / `wf0_ai_call_total`.

## Spend anomalies — what to look for

- **Sudden spike in `claude-sonnet-4-6` tokens.** Often a replan loop
  on a specific brief. Audit in the Activity log.
- **Sustained high `wf0_critique_score` failures.** Critique is
  rejecting draft plans too often → more revisions → more tokens.
  Tune the planner prompt or switch model.
- **Voice minutes climbing without meetings.** Possible inbound spam
  on the Twilio number. Add an allowlist.

## Cost guard patterns

### Pattern 1: "charge the exec once per brief"

Set `PLANNER_MONTHLY_BUDGET_TOKENS` sized for the expected brief
volume × a 20% buffer. Caps kick in when volume jumps unexpectedly.

### Pattern 2: "unlimited exploration, capped exploitation"

No cap on the planner, but a low `AGENT_MONTHLY_BUDGET_TOKENS`. Execs
can draft ten wild briefs; the team only ships what fits the cap.

### Pattern 3: "hard stop"

Set all caps. Workforce0 falls back to deterministic mode when caps
hit. Best for demos / regulated environments where overspend is
worse than degraded UX.

## Provider-side guardrails

In addition to Workforce0 caps, set provider-side budgets:

- **Anthropic**: [console.anthropic.com/settings/limits](https://console.anthropic.com/settings/limits).
- **OpenAI**: [platform.openai.com/account/billing/limits](https://platform.openai.com/account/billing/limits).
- **Google**: [console.cloud.google.com/billing/…/budgets](https://console.cloud.google.com/billing).

Provider budgets hard-stop at the API; they're your last line of
defense.

## Debugging "I hit my cap unexpectedly"

1. Check **Analytics → AI spend → by role** for the month. Find the
   role with the unexpected burn.
2. Click the role to see per-ticket attribution.
3. Find the ticket that consumed most tokens.
4. Look at its `ExecutionPlan.attempt` field. Values of 2 or 3
   indicate replans — probably the culprit.
5. Read the failure messages. Fix the underlying issue (often a bad
   prompt or a missing integration); lifetime token spend stabilizes.

## Zero-cost modes

If you're set up entirely on:

- **Gemini free tier** (planner + specialists), AND
- **Local models** (specialists), AND
- **Free-tier Twilio trial** (voice)

…you can run Workforce0 at zero dollars. The free Gemini tier's
1,500 req/day is enough for a small team.

The moment you cross a free-tier line, a cap is the friend that
saves you from the unexpected invoice.
