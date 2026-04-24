---
title: Metric harness
description: Measure whether a planner change (e.g. god-nodes prompt injection) actually moves critique scores.
---

## Why a harness

AI product changes are easy to ship and hard to evaluate. The team
adds a new prompt feature, declares it a win, and nobody measures
whether it actually helps. The metric harness gives us a
deterministic way to measure paired (control, treatment) plan
outcomes and emit a qualitative verdict.

Lives at `backend/src/services/project-graph/metric-harness.ts` with
a CLI at `scripts/pg-metric-harness.ts`.

## Shape of a run

```ts
export interface RunResult {
  condition: "control" | "treatment";
  fixtureId: string;
  critiqueScore: number | null;  // 0..25
  revised: boolean;
  landmarksUsed: number;
  planned: boolean;
}
```

One run = one plan decomposition of one fixture (a synthetic ticket
or a real archived one).

## Aggregation

`aggregateRuns(runs)` returns:

- `control` + `treatment` stats (n, mean, median, pass-rate, revise-rate).
- `meanScoreDelta` — treatment − control.
- `passRateDelta` — same.
- Raw rows for downstream analysis (T-test, Wilcoxon, etc).

```bash
$ npx tsx scripts/pg-metric-harness.ts runs.json

════════════════════════════════════════════════════════════
  PG.14 — God-nodes prompt metric validation
════════════════════════════════════════════════════════════
  fixtures:   control n=3, treatment n=3

                    control      treatment    delta
  ------------------------------------------------------
  planned                      3            3            0
  mean score               13.67        20.33         6.66
  median score                14           20            —
  pass rate ≥20                0         0.67         0.67
  revise rate               0.67            0            —
════════════════════════════════════════════════════════════
  verdict:  improved
  note:     mean +6.66 / pass-rate +67%
```

## Verdict rules

Conservative thresholds (from `interpretReport`):

- **improved** — meanScoreDelta ≥ 1 AND passRateDelta ≥ 0.
- **regressed** — meanScoreDelta ≤ −1.
- **flat** — neither.
- **insufficient-data** — one arm has no scored runs.

We don't compute confidence intervals; sample size needed depends on
your corpus. Feed the raw rows to R / numpy if you need significance
testing.

## How to produce a paired run set

Option A — **real archive replay**:

1. Export 50 recent real plans with their critique scores
   (attempt 1, not replans).
2. For each, rerun the planner with and without the feature under
   test, capturing `(condition, fixtureId, critiqueScore, …)`.
3. Write to `runs.json`.

Option B — **synthetic fixtures**:

1. Hand-write 10 plausible ticket descriptions covering different
   scope shapes.
2. Run the planner against each, with and without the feature.
3. Capture the same fields.

Option A is more realistic but requires a real corpus. Option B is
enough for smoke testing a prompt change.

## Wiring into CI

The CLI exits with code 2 on `regressed`. Put it in your PR checks:

```yaml
# .github/workflows/metric.yml
- name: Metric harness
  run: |
    npx tsx scripts/pg-metric-harness.ts ./eval-runs.json
```

Use the `insufficient-data` / `flat` exit code (0) for non-blocking
advisory runs.

## What it doesn't do

- Compare two different models head-to-head. (Possible, but the
  comparison knob is "condition" — add `variant` if you need more
  arms.)
- Statistical significance testing. Deliberately out-of-scope; plug
  in your stats tool of choice on the raw rows.
- Automate the planner runs. You produce `runs.json`; the harness
  just aggregates it.

## Future: continuous eval

Plausible shape:

1. Nightly cron re-runs the planner against the last 7 days of
   real briefs.
2. Compares to the previous nightly run's results.
3. Posts a Slack notification if `verdict: regressed`.

Not yet built. Would live as a cron job pattern in
`backend/src/services/scheduled-jobs/`.

## The reason we built this

Internally, we landed a feature (PG.6 — god-nodes in planner prompt)
claiming it helped planner quality. When someone asked "how much?",
the honest answer was "we don't know — we eyeballed it." Shipping
the harness was forcing ourselves to either back the claim with
numbers or walk it back. That's the discipline we want every future
prompt change to face.
