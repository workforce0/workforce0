/**
 * PG.14 — Metric validation harness.
 *
 * Built to answer ONE narrow question:
 *
 *    "Does injecting the top-N god nodes into the planner prompt
 *     actually move the M8.1 critique score?"
 *
 * It's easy to add a feature and declare it a win without measuring.
 * This harness is the measurement scaffold: a deterministic, in-process
 * aggregator that takes paired (control, treatment) plan outcomes and
 * emits mean / median / pass-rate / revise-rate deltas.
 *
 * The INPUT shape (`RunResult[]`) is intentionally flat so you can fill
 * it from anywhere:
 *
 *   - A vitest-driven experiment with a mocked LLM (see the harness
 *     test for a worked example).
 *   - A script that replays a corpus of real tickets through a live
 *     model provider (scripts/pg-metric-harness.ts).
 *   - A production-capture CSV imported from an evaluation run.
 *
 * The harness does NOT pass judgment on statistical significance —
 * the sample size required depends on your corpus. It emits the raw
 * distribution so callers can feed it into their own analysis
 * (T-test, Wilcoxon signed-rank, whatever they like).
 *
 * WHY this shape: LLMPlanner is already exercised end-to-end in
 * `planner-llm.test.ts`. Duplicating that mock stack inside the
 * harness would couple the aggregator to a test framework. Keeping
 * the aggregator pure lets CI validate the MATH of the harness
 * independently of whether any particular model is available.
 *
 * @module services/project-graph/metric-harness
 */

export type Condition = 'control' | 'treatment';

/** One planner invocation's outcome — fill in whatever the planner produced. */
export interface RunResult {
  condition: Condition;
  /** Stable id of the fixture (ticket / scenario) that was planned. */
  fixtureId: string;
  /** M8.1 critique score 0..25. Null when no critique ran (planner
   *  returned a fallback or self-consistency skipped critique). */
  critiqueScore: number | null;
  /** True when the critic flagged the draft and planner ran a revision. */
  revised: boolean;
  /** How many landmark names the treatment arm injected (0 for control). */
  landmarksUsed: number;
  /** Whether the run produced any plan at all (false = LLM error / bad JSON). */
  planned: boolean;
}

export interface ConditionStats {
  condition: Condition;
  n: number;
  planned: number;
  meanScore: number | null;
  medianScore: number | null;
  /** Fraction of scored runs at or above the revise threshold (≥20). */
  passRate: number | null;
  /** Fraction of planned runs that required a revision. */
  reviseRate: number | null;
}

export interface HarnessReport {
  control: ConditionStats;
  treatment: ConditionStats;
  /** treatment.meanScore − control.meanScore — null when either side has no scores. */
  meanScoreDelta: number | null;
  /** treatment.passRate − control.passRate. */
  passRateDelta: number | null;
  /** Raw rows so callers can run their own stats. */
  runs: RunResult[];
}

/**
 * Aggregate a list of paired runs into a condition-by-condition report.
 *
 * `runs` must contain both a `control` and a `treatment` entry per
 * fixture for the deltas to be meaningful. Unpaired rows are allowed
 * (the helper just summarizes whichever side it got) but the caller
 * should be aware that the delta then isn't a fair comparison.
 */
export function aggregateRuns(runs: RunResult[]): HarnessReport {
  const control = summarize(
    runs.filter((r) => r.condition === 'control'),
    'control',
  );
  const treatment = summarize(
    runs.filter((r) => r.condition === 'treatment'),
    'treatment',
  );
  const meanScoreDelta =
    control.meanScore !== null && treatment.meanScore !== null
      ? round2(treatment.meanScore - control.meanScore)
      : null;
  const passRateDelta =
    control.passRate !== null && treatment.passRate !== null
      ? round2(treatment.passRate - control.passRate)
      : null;
  return { control, treatment, meanScoreDelta, passRateDelta, runs };
}

/** Human-readable table for terminal / log output. */
export function formatReport(report: HarnessReport): string {
  const fmt = (x: number | null, d = 2) =>
    x === null ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(d);
  const lines: string[] = [
    '',
    '════════════════════════════════════════════════════════════',
    '  PG.14 — God-nodes prompt metric validation',
    '════════════════════════════════════════════════════════════',
    `  fixtures:   control n=${report.control.n}, treatment n=${report.treatment.n}`,
    '',
    '                    control      treatment    delta',
    '  ------------------------------------------------------',
    `  planned          ${pad(report.control.planned)}${pad(report.treatment.planned)}${pad(
      report.treatment.planned - report.control.planned,
    )}`,
    `  mean score       ${pad(fmt(report.control.meanScore))}${pad(
      fmt(report.treatment.meanScore),
    )}${pad(fmt(report.meanScoreDelta))}`,
    `  median score     ${pad(fmt(report.control.medianScore))}${pad(
      fmt(report.treatment.medianScore),
    )}${pad('—')}`,
    `  pass rate ≥20    ${pad(fmt(report.control.passRate))}${pad(
      fmt(report.treatment.passRate),
    )}${pad(fmt(report.passRateDelta))}`,
    `  revise rate      ${pad(fmt(report.control.reviseRate))}${pad(
      fmt(report.treatment.reviseRate),
    )}${pad('—')}`,
    '════════════════════════════════════════════════════════════',
    '',
  ];
  return lines.join('\n');
}

/**
 * Interpret a report: returns a short qualitative verdict string.
 * Useful for CI gating and for printing a one-line summary in logs.
 *
 * Thresholds are deliberately conservative — we only claim "moved"
 * when the mean improves by ≥1 critique point AND the pass-rate delta
 * is positive. Everything else stays "flat" or "regressed" so we
 * don't celebrate noise.
 */
export function interpretReport(report: HarnessReport): {
  verdict: 'improved' | 'flat' | 'regressed' | 'insufficient-data';
  note: string;
} {
  if (report.meanScoreDelta === null) {
    return { verdict: 'insufficient-data', note: 'One or both arms produced no scored runs.' };
  }
  const delta = report.meanScoreDelta;
  const pr = report.passRateDelta ?? 0;
  if (delta >= 1 && pr >= 0) {
    return {
      verdict: 'improved',
      note: `mean +${delta.toFixed(2)} / pass-rate +${(pr * 100).toFixed(0)}%`,
    };
  }
  if (delta <= -1) {
    return {
      verdict: 'regressed',
      note: `mean ${delta.toFixed(2)} / pass-rate ${(pr * 100).toFixed(0)}%`,
    };
  }
  return {
    verdict: 'flat',
    note: `mean Δ=${delta.toFixed(2)} / pass-rate Δ=${(pr * 100).toFixed(0)}% — below movement threshold`,
  };
}

// ————————————————————————————————————————————————————————————
// internals
// ————————————————————————————————————————————————————————————

function summarize(rows: RunResult[], condition: Condition): ConditionStats {
  const planned = rows.filter((r) => r.planned);
  const scored = planned
    .map((r) => r.critiqueScore)
    .filter((s): s is number => typeof s === 'number');
  const meanScore = scored.length
    ? round2(scored.reduce((a, b) => a + b, 0) / scored.length)
    : null;
  const medianScore = scored.length ? round2(median(scored)) : null;
  const passRate = scored.length
    ? round2(scored.filter((s) => s >= 20).length / scored.length)
    : null;
  const reviseRate = planned.length
    ? round2(planned.filter((r) => r.revised).length / planned.length)
    : null;
  return {
    condition,
    n: rows.length,
    planned: planned.length,
    meanScore,
    medianScore,
    passRate,
    reviseRate,
  };
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function pad(v: string | number, width = 13): string {
  return String(v).padStart(width);
}
