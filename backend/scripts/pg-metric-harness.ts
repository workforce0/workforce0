/**
 * PG.14 — Metric validation harness runner.
 *
 * Feeds a JSON file of run results into the aggregator and prints a
 * formatted report + interpretation. Useful after capturing a paired
 * (control, treatment) experiment from production (or from a
 * scripted sweep against a real model).
 *
 * Usage:
 *
 *   npx tsx scripts/pg-metric-harness.ts runs.json
 *
 * The runs.json file must be an array of RunResult objects:
 *
 *   [
 *     { "condition": "control",   "fixtureId": "tkt-1", "critiqueScore": 14,
 *       "revised": false, "landmarksUsed": 0, "planned": true },
 *     { "condition": "treatment", "fixtureId": "tkt-1", "critiqueScore": 21,
 *       "revised": false, "landmarksUsed": 5, "planned": true },
 *     …
 *   ]
 *
 * See services/project-graph/metric-harness.ts for the full type
 * definitions and tests/metric-harness.test.ts for worked examples.
 *
 * This runner intentionally does not touch the network, Prisma, Redis,
 * or any model provider — it is a pure stats CLI. Capture the runs
 * with whatever experiment rig you like (a test harness, a
 * production tap, a script against a live LLM), then pipe the
 * resulting JSON through this file to get a report.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  aggregateRuns,
  formatReport,
  interpretReport,
  type RunResult,
} from '../src/services/project-graph/metric-harness.js';

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write('usage: pg-metric-harness <runs.json>\n');
    process.exit(1);
  }
  const path = resolve(arg);
  let runs: RunResult[];
  try {
    const raw = await readFile(path, 'utf8');
    runs = JSON.parse(raw) as RunResult[];
  } catch (err) {
    process.stderr.write(`failed to read ${path}: ${(err as Error).message}\n`);
    process.exit(1);
    return;
  }
  if (!Array.isArray(runs)) {
    process.stderr.write(`${path} must be a JSON array of RunResult\n`);
    process.exit(1);
  }
  const report = aggregateRuns(runs);
  const verdict = interpretReport(report);
  process.stdout.write(formatReport(report));
  process.stdout.write(`  verdict:  ${verdict.verdict}\n`);
  process.stdout.write(`  note:     ${verdict.note}\n\n`);
  // Non-zero exit on regression so CI can gate.
  if (verdict.verdict === 'regressed') process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
