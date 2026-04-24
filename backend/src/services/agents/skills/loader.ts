// mvp/src/services/agents/skills/loader.ts
import type { SkillTarget, ResolvedSkill, FoundationSkill } from './types.js';
import { createChildLogger } from '../../../lib/logger.js';

// Import all foundation skills
import { SECURITY } from './foundation/all/security.js';
import { CODING_STANDARDS } from './foundation/all/coding-standards.js';
import { QUALITY_GATES } from './foundation/all/quality-gates.js';
import { API_DESIGN } from './foundation/ba/api-design.js';
import { DATABASE_MIGRATIONS } from './foundation/ba/database-migrations.js';
import { PRD_PATTERNS } from './foundation/ba/prd-patterns.js';
import { TDD_WORKFLOW } from './foundation/dev/tdd-workflow.js';
import { SECURITY_REVIEW } from './foundation/dev/security-review.js';
import { BACKEND_PATTERNS } from './foundation/dev/backend-patterns.js';
import { DOCKER_PATTERNS } from './foundation/dev/docker-patterns.js';
import { E2E_TESTING } from './foundation/qa/e2e-testing.js';
import { TEST_COVERAGE } from './foundation/qa/test-coverage.js';
import { SECURITY_SCAN } from './foundation/qa/security-scan.js';

const log = createChildLogger({ module: 'skill-loader' });

const ALL_FOUNDATION_SKILLS: FoundationSkill[] = [
  SECURITY, CODING_STANDARDS, QUALITY_GATES,
  API_DESIGN, DATABASE_MIGRATIONS, PRD_PATTERNS,
  TDD_WORKFLOW, SECURITY_REVIEW, BACKEND_PATTERNS, DOCKER_PATTERNS,
  E2E_TESTING, TEST_COVERAGE, SECURITY_SCAN,
];

const LEARNED_SKILLS_CACHE_PREFIX = 'skills:learned:';
const LEARNED_SKILLS_CACHE_TTL = 1800; // 30 minutes

export class SkillLoader {
  constructor(
    private prisma: any,
    private redis: any,
  ) {}

  loadFoundationSkills(targets: SkillTarget[]): ResolvedSkill[] {
    return ALL_FOUNDATION_SKILLS
      .filter(s => targets.includes(s.target))
      .map(s => ({
        name: s.name,
        version: s.version,
        scope: 'foundation' as const,
        content: s.content,
      }));
  }

  async loadLearnedSkills(targets: SkillTarget[]): Promise<ResolvedSkill[]> {
    const cacheKey = LEARNED_SKILLS_CACHE_PREFIX + [...targets].sort().join(',');

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as ResolvedSkill[];
      } catch {
        log.warn('Failed to parse learned skills cache');
      }
    }

    const learned = await this.prisma.learnedSkill.findMany({
      where: {
        status: 'active',
        target: { in: targets },
      },
      orderBy: { confidence: 'desc' },
    });

    const resolved: ResolvedSkill[] = learned.map((s: any) => ({
      name: s.name,
      version: 'learned',
      scope: 'learned' as const,
      content: s.content,
    }));

    await this.redis.setex(cacheKey, LEARNED_SKILLS_CACHE_TTL, JSON.stringify(resolved));

    return resolved;
  }

  async resolveAllSkills(targets: SkillTarget[]): Promise<ResolvedSkill[]> {
    const foundation = this.loadFoundationSkills(targets);
    const learned = await this.loadLearnedSkills(targets);
    return [...foundation, ...learned];
  }
}
