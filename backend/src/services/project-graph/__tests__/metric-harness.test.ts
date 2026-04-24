import { describe, it, expect } from 'vitest';
import {
  aggregateRuns,
  formatReport,
  interpretReport,
  type RunResult,
} from '../metric-harness.js';

function run(
  partial: Partial<RunResult> & Pick<RunResult, 'condition' | 'fixtureId'>,
): RunResult {
  return {
    critiqueScore: null,
    revised: false,
    landmarksUsed: 0,
    planned: true,
    ...partial,
  };
}

describe('aggregateRuns', () => {
  it('computes mean, median, pass-rate, and revise-rate per condition', () => {
    const runs: RunResult[] = [
      run({ condition: 'control', fixtureId: 'a', critiqueScore: 10 }),
      run({ condition: 'control', fixtureId: 'b', critiqueScore: 15, revised: true }),
      run({ condition: 'control', fixtureId: 'c', critiqueScore: 18 }),
      run({ condition: 'treatment', fixtureId: 'a', critiqueScore: 20, landmarksUsed: 5 }),
      run({ condition: 'treatment', fixtureId: 'b', critiqueScore: 22, landmarksUsed: 5 }),
      run({ condition: 'treatment', fixtureId: 'c', critiqueScore: 21, landmarksUsed: 5 }),
    ];
    const report = aggregateRuns(runs);
    // control: [10,15,18] → mean 14.33, median 15, pass rate 0
    expect(report.control.meanScore).toBeCloseTo(14.33, 2);
    expect(report.control.medianScore).toBe(15);
    expect(report.control.passRate).toBe(0);
    expect(report.control.reviseRate).toBeCloseTo(1 / 3, 2);
    // treatment: [20,22,21] → mean 21, median 21, pass rate 1
    expect(report.treatment.meanScore).toBe(21);
    expect(report.treatment.medianScore).toBe(21);
    expect(report.treatment.passRate).toBe(1);
  });

  it('reports null deltas when one arm has zero scored runs', () => {
    const runs: RunResult[] = [
      run({ condition: 'control', fixtureId: 'a', critiqueScore: null, planned: false }),
      run({ condition: 'treatment', fixtureId: 'a', critiqueScore: 22 }),
    ];
    const report = aggregateRuns(runs);
    expect(report.control.meanScore).toBeNull();
    expect(report.meanScoreDelta).toBeNull();
    expect(report.passRateDelta).toBeNull();
  });

  it('ignores runs where planned=false when computing critique stats', () => {
    const runs: RunResult[] = [
      run({ condition: 'control', fixtureId: 'a', planned: false }),
      run({ condition: 'control', fixtureId: 'b', critiqueScore: 12 }),
      run({ condition: 'treatment', fixtureId: 'a', critiqueScore: 20 }),
      run({ condition: 'treatment', fixtureId: 'b', critiqueScore: 21 }),
    ];
    const report = aggregateRuns(runs);
    expect(report.control.planned).toBe(1);
    expect(report.control.meanScore).toBe(12);
    expect(report.treatment.meanScore).toBe(20.5);
  });

  it('computes the mean score delta as treatment − control', () => {
    const runs: RunResult[] = [
      run({ condition: 'control', fixtureId: 'a', critiqueScore: 14 }),
      run({ condition: 'control', fixtureId: 'b', critiqueScore: 16 }),
      run({ condition: 'treatment', fixtureId: 'a', critiqueScore: 19 }),
      run({ condition: 'treatment', fixtureId: 'b', critiqueScore: 21 }),
    ];
    const report = aggregateRuns(runs);
    // mean control = 15, mean treatment = 20 → delta +5
    expect(report.meanScoreDelta).toBe(5);
    // pass rate control = 0, treatment = 0.5 → delta 0.5
    expect(report.passRateDelta).toBe(0.5);
  });

  it('returns an empty shape when there are no runs', () => {
    const report = aggregateRuns([]);
    expect(report.control.n).toBe(0);
    expect(report.treatment.n).toBe(0);
    expect(report.meanScoreDelta).toBeNull();
    expect(report.passRateDelta).toBeNull();
  });

  it('handles critiqueScore = 0 distinctly from null', () => {
    const runs: RunResult[] = [
      run({ condition: 'control', fixtureId: 'a', critiqueScore: 0 }),
      run({ condition: 'treatment', fixtureId: 'a', critiqueScore: null }),
    ];
    const report = aggregateRuns(runs);
    expect(report.control.meanScore).toBe(0);
    expect(report.treatment.meanScore).toBeNull();
  });
});

describe('interpretReport', () => {
  const mkReport = (c: number | null, t: number | null, pr: number | null = 0) =>
    ({
      control: {
        condition: 'control' as const,
        n: 1,
        planned: 1,
        meanScore: c,
        medianScore: c,
        passRate: 0,
        reviseRate: 0,
      },
      treatment: {
        condition: 'treatment' as const,
        n: 1,
        planned: 1,
        meanScore: t,
        medianScore: t,
        passRate: pr === null ? 0 : pr,
        reviseRate: 0,
      },
      meanScoreDelta: c !== null && t !== null ? t - c : null,
      passRateDelta: pr,
      runs: [],
    });

  it('calls ≥1 point improvement + non-negative pass-rate improved', () => {
    const { verdict } = interpretReport(mkReport(15, 20, 0.2));
    expect(verdict).toBe('improved');
  });

  it('flags ≤−1 point regression', () => {
    const { verdict } = interpretReport(mkReport(20, 18));
    expect(verdict).toBe('regressed');
  });

  it('treats sub-1-point moves as flat noise', () => {
    const { verdict } = interpretReport(mkReport(15, 15.5));
    expect(verdict).toBe('flat');
  });

  it('flags insufficient data when control has no scored runs', () => {
    const { verdict } = interpretReport(mkReport(null, 20));
    expect(verdict).toBe('insufficient-data');
  });
});

describe('formatReport', () => {
  it('produces a human-readable table including both arms + deltas', () => {
    const runs: RunResult[] = [
      run({ condition: 'control', fixtureId: 'a', critiqueScore: 12 }),
      run({ condition: 'treatment', fixtureId: 'a', critiqueScore: 20 }),
    ];
    const out = formatReport(aggregateRuns(runs));
    expect(out).toContain('PG.14');
    expect(out).toContain('control');
    expect(out).toContain('treatment');
    expect(out).toContain('mean score');
    expect(out).toContain('pass rate');
  });
});
