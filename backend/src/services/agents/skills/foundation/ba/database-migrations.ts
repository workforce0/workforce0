import type { FoundationSkill } from '../../types.js';

export const DATABASE_MIGRATIONS: FoundationSkill = {
  name: 'database-migrations',
  version: '1.0.0',
  target: 'ba',
  content: `### Database Migration Standards
- Write only backward-compatible migrations; new columns must have defaults or be nullable so old application code continues to work during deploy
- Every migration must include a documented rollback step or down migration that cleanly reverses the change
- Target zero-downtime deployments: add columns before the app references them, remove columns only after the app no longer references them in a separate release
- Test all migrations on a copy of production data before applying to production; never experiment directly on live data
- Never drop a column or table in the same migration that removes its last code reference — use a two-step deploy (remove code, then remove column in next release)
- Add indexes for every foreign key and every column that appears in a WHERE, ORDER BY, or GROUP BY clause in a known query
- Use advisory locks or migration framework locks to prevent concurrent migration runs in multi-instance deployments
- Keep each migration focused on a single logical change; avoid bundling unrelated schema changes into one migration file
- Document the reason for each schema change in the migration file header comment`,
};
