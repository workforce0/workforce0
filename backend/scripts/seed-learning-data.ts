#!/usr/bin/env npx tsx
/**
 * Seed Learning Loop — inserts synthetic outcomes and skill candidates
 * to cold-start the self-improving skill system.
 *
 * Usage: cd mvp && npm run seed-learning
 *
 * Safe to run multiple times — checks for existing seed data first.
 *
 * What this seeds:
 *   - 20 synthetic AgentOutcome records representing common consulting patterns
 *   - 5 LearnedSkill candidates near the promotion threshold
 *
 * After seeding, run MemoryOptimizer to promote qualifying candidates to 'active'.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// Load .env from mvp/ root before anything else
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// dotenv
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../prisma/generated/client/index.js';

// ---------------------------------------------------------------------------
// Seed data definitions
// ---------------------------------------------------------------------------

/**
 * 20 synthetic AgentOutcome records.
 *
 * Pattern 1: PRDs with rollback steps get approved more (BA Agent)
 *   6 approved (confidence 0.88–0.95) + 2 revised (confidence 0.65–0.72)
 *
 * Pattern 2: Code with tests written first gets approved more (Dev Agent)
 *   5 approved (confidence 0.90–0.95) + 3 rejected (confidence 0.40–0.60)
 *
 * Pattern 3: PRDs with clear acceptance criteria get higher confidence (BA Agent)
 *   4 approved (confidence 0.90–0.95)
 */
const seedOutcomes = [
  // --- Pattern 1: Rollback steps in PRDs (BA Agent) ---
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-001',
    result: 'approved',
    confidenceScore: 0.92,
    toolsUsed: ['read_transcript', 'write_prd', 'add_rollback_steps'],
    stepCount: 7,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'rollback-steps', hasRollback: true },
  },
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-002',
    result: 'approved',
    confidenceScore: 0.95,
    toolsUsed: ['read_transcript', 'write_prd', 'add_rollback_steps', 'add_migration_notes'],
    stepCount: 9,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'rollback-steps', hasRollback: true },
  },
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-003',
    result: 'approved',
    confidenceScore: 0.89,
    toolsUsed: ['read_transcript', 'write_prd', 'add_rollback_steps'],
    stepCount: 8,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'rollback-steps', hasRollback: true },
  },
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-004',
    result: 'approved',
    confidenceScore: 0.91,
    toolsUsed: ['read_transcript', 'write_prd', 'add_rollback_steps', 'check_backward_compat'],
    stepCount: 10,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'rollback-steps', hasRollback: true },
  },
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-005',
    result: 'approved',
    confidenceScore: 0.88,
    toolsUsed: ['read_transcript', 'write_prd', 'add_rollback_steps'],
    stepCount: 7,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'rollback-steps', hasRollback: true },
  },
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-006',
    result: 'approved',
    confidenceScore: 0.93,
    toolsUsed: ['read_transcript', 'write_prd', 'add_rollback_steps', 'add_migration_notes'],
    stepCount: 8,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'rollback-steps', hasRollback: true },
  },
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-007',
    result: 'revised',
    confidenceScore: 0.68,
    toolsUsed: ['read_transcript', 'write_prd'],
    stepCount: 5,
    revisionFeedback: 'PRD is missing rollback steps for the database migration. Please add a section describing how to revert the schema changes if the deployment fails.',
    metadata: { synthetic: true, pattern: 'rollback-steps', hasRollback: false },
  },
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-008',
    result: 'revised',
    confidenceScore: 0.65,
    toolsUsed: ['read_transcript', 'write_prd'],
    stepCount: 4,
    revisionFeedback: 'No rollback or backward-compatibility notes. This PRD proposes breaking schema changes but does not describe how to safely revert. Revision required.',
    metadata: { synthetic: true, pattern: 'rollback-steps', hasRollback: false },
  },

  // --- Pattern 2: Tests before implementation (Dev Agent) ---
  {
    agentType: 'dev_agent',
    taskId: 'seed-dev-001',
    result: 'approved',
    confidenceScore: 0.94,
    toolsUsed: ['read_prd', 'write_tests', 'write_implementation', 'run_linter'],
    stepCount: 12,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'tests-first', hasTests: true },
  },
  {
    agentType: 'dev_agent',
    taskId: 'seed-dev-002',
    result: 'approved',
    confidenceScore: 0.91,
    toolsUsed: ['read_prd', 'write_tests', 'write_implementation'],
    stepCount: 11,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'tests-first', hasTests: true },
  },
  {
    agentType: 'dev_agent',
    taskId: 'seed-dev-003',
    result: 'approved',
    confidenceScore: 0.95,
    toolsUsed: ['read_prd', 'write_tests', 'write_implementation', 'run_linter', 'check_coverage'],
    stepCount: 14,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'tests-first', hasTests: true },
  },
  {
    agentType: 'dev_agent',
    taskId: 'seed-dev-004',
    result: 'approved',
    confidenceScore: 0.90,
    toolsUsed: ['read_prd', 'write_tests', 'write_implementation'],
    stepCount: 10,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'tests-first', hasTests: true },
  },
  {
    agentType: 'dev_agent',
    taskId: 'seed-dev-005',
    result: 'approved',
    confidenceScore: 0.92,
    toolsUsed: ['read_prd', 'write_tests', 'write_implementation', 'run_linter'],
    stepCount: 13,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'tests-first', hasTests: true },
  },
  {
    agentType: 'dev_agent',
    taskId: 'seed-dev-006',
    result: 'rejected',
    confidenceScore: 0.55,
    toolsUsed: ['read_prd', 'write_implementation'],
    stepCount: 6,
    revisionFeedback: 'No tests provided. All code submissions must include unit tests. Implementation was rejected — please write failing tests first, then implementation.',
    metadata: { synthetic: true, pattern: 'tests-first', hasTests: false },
  },
  {
    agentType: 'dev_agent',
    taskId: 'seed-dev-007',
    result: 'rejected',
    confidenceScore: 0.48,
    toolsUsed: ['read_prd', 'write_implementation'],
    stepCount: 5,
    revisionFeedback: 'Missing test coverage. Code was submitted without any corresponding test file. Rejected — tests are mandatory before implementation is accepted.',
    metadata: { synthetic: true, pattern: 'tests-first', hasTests: false },
  },
  {
    agentType: 'dev_agent',
    taskId: 'seed-dev-008',
    result: 'rejected',
    confidenceScore: 0.41,
    toolsUsed: ['read_prd', 'write_implementation'],
    stepCount: 4,
    revisionFeedback: 'Submission rejected: no tests found. QA flagged this pattern — 3 consecutive rejections for missing tests. Write tests first, then implementation.',
    metadata: { synthetic: true, pattern: 'tests-first', hasTests: false },
  },

  // --- Pattern 3: Explicit acceptance criteria in PRDs (BA Agent) ---
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-ac-001',
    result: 'approved',
    confidenceScore: 0.93,
    toolsUsed: ['read_transcript', 'write_prd', 'add_acceptance_criteria'],
    stepCount: 9,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'acceptance-criteria', hasDetailedAC: true },
  },
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-ac-002',
    result: 'approved',
    confidenceScore: 0.90,
    toolsUsed: ['read_transcript', 'write_prd', 'add_acceptance_criteria'],
    stepCount: 8,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'acceptance-criteria', hasDetailedAC: true },
  },
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-ac-003',
    result: 'approved',
    confidenceScore: 0.95,
    toolsUsed: ['read_transcript', 'write_prd', 'add_acceptance_criteria', 'validate_testability'],
    stepCount: 11,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'acceptance-criteria', hasDetailedAC: true },
  },
  {
    agentType: 'ba_agent',
    taskId: 'seed-ba-ac-004',
    result: 'approved',
    confidenceScore: 0.91,
    toolsUsed: ['read_transcript', 'write_prd', 'add_acceptance_criteria'],
    stepCount: 9,
    revisionFeedback: null,
    metadata: { synthetic: true, pattern: 'acceptance-criteria', hasDetailedAC: true },
  },
] as const;

/**
 * 5 LearnedSkill candidates seeded near the promotion threshold.
 *
 * Promotion threshold: confidence >= 0.80 AND sourceOutcomes >= 10
 *
 * Notable: 'error-handling-in-api-endpoints' meets the threshold already
 * (confidence 0.85, sourceOutcomes 10) — MemoryOptimizer should promote it
 * to 'active' on its first run.
 */
const seedSkills = [
  {
    name: 'always-include-rollback-steps',
    content: `### Migration Safety
Always include rollback steps and backward-compatibility notes in PRDs that involve database changes. PRDs without rollback plans have a 2x higher revision rate.

**When to apply:** Any PRD that mentions schema changes, data migrations, column renames, or table restructuring.

**Template to include:**
\`\`\`
## Rollback Plan
1. Revert: [describe how to undo the migration]
2. Backward compatibility: [describe how old code handles new schema]
3. Data safety: [describe how existing data is preserved]
\`\`\``,
    target: 'ba',
    confidence: 0.78,
    sourceOutcomes: 8,
    positiveRate: 0.75,
    negativeRate: 0.25,
    status: 'candidate',
  },
  {
    name: 'tests-before-implementation',
    content: `### Test-First Development
Write failing tests before implementation code. Code submissions without corresponding tests have a 3x higher rejection rate.

**When to apply:** All Dev Agent code generation tasks.

**Required pattern:**
1. Read the PRD acceptance criteria
2. Write unit tests that will initially fail (red)
3. Write implementation that makes tests pass (green)
4. Refactor while keeping tests green

**Minimum coverage:** At least one test per acceptance criterion.`,
    target: 'dev',
    confidence: 0.82,
    sourceOutcomes: 8,
    positiveRate: 0.625,
    negativeRate: 0.375,
    status: 'candidate',
  },
  {
    name: 'explicit-acceptance-criteria',
    content: `### Acceptance Criteria
Every user story must have explicit, testable acceptance criteria. PRDs with vague criteria (e.g., "should work well") consistently score below 80% confidence.

**Format for each criterion:**
\`\`\`
Given [context]
When [action]
Then [expected outcome]
\`\`\`

**Anti-patterns to avoid:**
- "The feature should be fast" → replace with "Response time < 200ms for 95th percentile"
- "Users should be able to..." → replace with specific Given/When/Then
- "Should work correctly" → not testable, rewrite with measurable outcome`,
    target: 'ba',
    confidence: 0.75,
    sourceOutcomes: 4,
    positiveRate: 1.0,
    negativeRate: 0.0,
    status: 'candidate',
  },
  {
    name: 'error-handling-in-api-endpoints',
    content: `### API Error Handling
Every API endpoint must handle: invalid input (400), unauthorized (401), not found (404), and internal error (500). Endpoints missing error handling are flagged by QA 90% of the time.

**Required error responses for every endpoint:**
\`\`\`typescript
// 400 - Validation failure
{ success: false, error: 'Validation failed', details: [...] }

// 401 - Missing or invalid auth
{ success: false, error: 'Unauthorized' }

// 404 - Resource not found
{ success: false, error: 'Resource not found' }

// 500 - Internal error (never expose stack traces)
{ success: false, error: 'Internal server error', requestId: '...' }
\`\`\`

**Checklist before submitting:**
- [ ] Input validated with schema (Zod or equivalent)
- [ ] Auth checked before any data access
- [ ] 404 returned when resource doesn't exist for the tenant
- [ ] Errors logged internally but sanitized in response`,
    target: 'dev',
    confidence: 0.85,
    sourceOutcomes: 10,
    positiveRate: 0.80,
    negativeRate: 0.20,
    status: 'candidate',
  },
  {
    name: 'scope-boundaries-prevent-revision',
    content: `### Explicit Scope Boundaries
PRDs that include an "Out of Scope" section have 40% fewer revision requests. Clearly stating what is NOT included prevents scope creep during development.

**Required "Out of Scope" section format:**
\`\`\`
## Out of Scope
The following are explicitly excluded from this PRD:
- [Feature A] — will be addressed in [future PRD / Q3 planning]
- [Integration B] — blocked on [dependency / decision]
- [Optimization C] — deferred for performance baseline

Anything not listed in the Requirements section above is out of scope by default.
\`\`\`

**When this matters most:** Features that could naturally expand (auth systems, notification systems, search features, admin panels).`,
    target: 'ba',
    confidence: 0.72,
    sourceOutcomes: 6,
    positiveRate: 0.833,
    negativeRate: 0.167,
    status: 'candidate',
  },
] as const;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Workforce0 — Seed Learning Loop');
  console.log('==================================\n');

  // Connect to database
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is not set. Make sure mvp/.env exists.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  try {
    // Check if synthetic data already exists (idempotency guard)
    const existingOutcomes = await prisma.agentOutcome.count({
      where: { taskId: { startsWith: 'seed-' } },
    });

    const existingSkills = await prisma.learnedSkill.count({
      where: { name: { in: seedSkills.map(s => s.name) } },
    });

    if (existingOutcomes > 0 || existingSkills > 0) {
      console.log('Seed data already present — skipping to avoid duplicates.\n');
      console.log(`  Existing synthetic outcomes : ${existingOutcomes}`);
      console.log(`  Existing skill candidates   : ${existingSkills}`);
      console.log('\nTo re-seed, delete existing seed records first:');
      console.log("  DELETE FROM agent_outcomes WHERE task_id LIKE 'seed-%';");
      console.log("  DELETE FROM learned_skills WHERE name IN ('always-include-rollback-steps', 'tests-before-implementation', 'explicit-acceptance-criteria', 'error-handling-in-api-endpoints', 'scope-boundaries-prevent-revision');");
      return;
    }

    // Insert 20 synthetic AgentOutcome records
    console.log('Inserting synthetic AgentOutcome records...');
    let outcomeCount = 0;
    for (const outcome of seedOutcomes) {
      await prisma.agentOutcome.create({
        data: {
          agentType: outcome.agentType,
          taskId: outcome.taskId,
          result: outcome.result,
          confidenceScore: outcome.confidenceScore,
          toolsUsed: outcome.toolsUsed as unknown as string[],
          stepCount: outcome.stepCount,
          revisionFeedback: outcome.revisionFeedback ?? undefined,
          metadata: outcome.metadata,
        },
      });
      outcomeCount++;
      const icon = outcome.result === 'approved' ? 'approved' : outcome.result === 'revised' ? 'revised' : 'rejected';
      console.log(`  [${outcomeCount.toString().padStart(2, '0')}] ${outcome.agentType.padEnd(10)} ${icon.padEnd(8)} confidence=${outcome.confidenceScore.toFixed(2)}  task=${outcome.taskId}`);
    }

    // Insert 5 LearnedSkill candidates
    console.log('\nInserting LearnedSkill candidates...');
    const PROMOTION_CONFIDENCE = 0.80;
    const PROMOTION_OUTCOMES = 10;

    let skillCount = 0;
    for (const skill of seedSkills) {
      await prisma.learnedSkill.create({
        data: {
          name: skill.name,
          content: skill.content,
          target: skill.target,
          confidence: skill.confidence,
          sourceOutcomes: skill.sourceOutcomes,
          positiveRate: skill.positiveRate,
          negativeRate: skill.negativeRate,
          status: skill.status,
        },
      });
      skillCount++;

      const meetsThreshold = skill.confidence >= PROMOTION_CONFIDENCE && skill.sourceOutcomes >= PROMOTION_OUTCOMES;
      const thresholdNote = meetsThreshold
        ? ' *** MEETS PROMOTION THRESHOLD — will be activated on next MemoryOptimizer run ***'
        : ` (needs confidence >= ${PROMOTION_CONFIDENCE} and outcomes >= ${PROMOTION_OUTCOMES})`;

      console.log(`  [${skillCount}] ${skill.name}`);
      console.log(`       target=${skill.target}  confidence=${skill.confidence}  sourceOutcomes=${skill.sourceOutcomes}${thresholdNote}`);
    }

    // Summary
    console.log('\n==================================');
    console.log('Seed complete.\n');
    console.log(`  AgentOutcome records inserted : ${outcomeCount}`);
    console.log(`  LearnedSkill candidates inserted: ${skillCount}\n`);

    // Breakdown by pattern
    const baApproved = seedOutcomes.filter(o => o.agentType === 'ba_agent' && o.result === 'approved').length;
    const baRevised = seedOutcomes.filter(o => o.agentType === 'ba_agent' && o.result === 'revised').length;
    const devApproved = seedOutcomes.filter(o => o.agentType === 'dev_agent' && o.result === 'approved').length;
    const devRejected = seedOutcomes.filter(o => o.agentType === 'dev_agent' && o.result === 'rejected').length;

    console.log('Pattern breakdown:');
    console.log(`  BA Agent  — ${baApproved} approved, ${baRevised} revised`);
    console.log(`  Dev Agent — ${devApproved} approved, ${devRejected} rejected\n`);

    const promotionReady = seedSkills.filter(
      s => s.confidence >= PROMOTION_CONFIDENCE && s.sourceOutcomes >= PROMOTION_OUTCOMES
    );
    if (promotionReady.length > 0) {
      console.log('Skills ready for immediate promotion (threshold already met):');
      for (const s of promotionReady) {
        console.log(`  - ${s.name} (confidence=${s.confidence}, outcomes=${s.sourceOutcomes})`);
      }
      console.log('\nRun MemoryOptimizer to promote these to active status.');
    }

    const nearThreshold = seedSkills.filter(
      s => !(s.confidence >= PROMOTION_CONFIDENCE && s.sourceOutcomes >= PROMOTION_OUTCOMES)
    );
    if (nearThreshold.length > 0) {
      console.log('\nSkills approaching promotion threshold:');
      for (const s of nearThreshold) {
        const confGap = s.confidence < PROMOTION_CONFIDENCE
          ? ` (confidence ${s.confidence} → needs ${PROMOTION_CONFIDENCE})`
          : '';
        const outcomeGap = s.sourceOutcomes < PROMOTION_OUTCOMES
          ? ` (outcomes ${s.sourceOutcomes} → needs ${PROMOTION_OUTCOMES})`
          : '';
        console.log(`  - ${s.name}${confGap}${outcomeGap}`);
      }
    }

    console.log('\nThe learning loop is now primed. Run the server and trigger');
    console.log('MemoryOptimizer to complete the cold-start.');

  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(err => {
  console.error('\nERROR: Seed script failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
