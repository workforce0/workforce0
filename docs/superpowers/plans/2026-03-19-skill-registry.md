# Skill Registry + Self-Improving Agent Consultants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Workforce0 agent battle-tested ECC skills (TDD, security, API design, etc.) via BaseConsultant inheritance, and enable the firm to self-improve by learning from task outcomes.

**Architecture:** BaseConsultant class carries foundation skills (immutable, from ECC) and learned skills (self-improved, from DB). Each agent extends it. OutcomeObserver tracks approval/rejection. MemoryOptimizer periodically analyzes outcomes and promotes patterns to learned skills.

**Tech Stack:** TypeScript, Prisma 7, PostgreSQL, Redis (caching), Vitest (testing)

**Spec:** `docs/superpowers/specs/2026-03-19-skill-registry-design.md`

---

## File Structure

### New Files

```
mvp/src/services/agents/skills/types.ts                          # Skill interfaces
mvp/src/services/agents/skills/loader.ts                         # Load foundation + learned skills
mvp/src/services/agents/skills/foundation/all/security.ts        # Firm-wide: OWASP, input validation
mvp/src/services/agents/skills/foundation/all/coding-standards.ts # Firm-wide: immutability, file org
mvp/src/services/agents/skills/foundation/all/quality-gates.ts   # Firm-wide: confidence thresholds
mvp/src/services/agents/skills/foundation/ba/api-design.ts       # BA: REST conventions
mvp/src/services/agents/skills/foundation/ba/database-migrations.ts # BA: safe schema changes
mvp/src/services/agents/skills/foundation/ba/prd-patterns.ts     # BA: requirements structure
mvp/src/services/agents/skills/foundation/dev/tdd-workflow.ts    # Dev: RED-GREEN-REFACTOR
mvp/src/services/agents/skills/foundation/dev/security-review.ts # Dev: code-level security
mvp/src/services/agents/skills/foundation/dev/backend-patterns.ts # Dev: service/repo patterns
mvp/src/services/agents/skills/foundation/dev/docker-patterns.ts # Dev: multi-stage builds
mvp/src/services/agents/skills/foundation/qa/e2e-testing.ts      # QA: Playwright POM
mvp/src/services/agents/skills/foundation/qa/test-coverage.ts    # QA: coverage strategies
mvp/src/services/agents/skills/foundation/qa/security-scan.ts    # QA: vulnerability detection
mvp/src/services/agents/base-consultant.ts                       # BaseConsultant abstract class
mvp/src/services/agents/outcome-observer.ts                      # Outcome tracking service
mvp/src/services/agents/skills/__tests__/loader.test.ts          # SkillLoader tests (colocated)
mvp/src/services/agents/__tests__/base-consultant.test.ts        # BaseConsultant tests (colocated)
mvp/src/services/agents/__tests__/outcome-observer.test.ts       # OutcomeObserver tests (colocated)
```

### Modified Files

```
mvp/prisma/schema.prisma                                          # Add LearnedSkill + AgentOutcome models
mvp/src/services/agent-runtime/types.ts                           # Add skillVersions to AgentRunResult
mvp/src/services/agents/ba/ba.agent.ts                            # extends BaseConsultant
mvp/src/services/agents/dev/dev.agent.ts                          # extends BaseConsultant
mvp/src/services/agents/qa/qa.agent.ts                            # extends BaseConsultant
mvp/src/services/agents/meeting-brain/meeting-brain.agent.ts      # extends BaseConsultant
mvp/src/services/agents/supervisor/supervisor.agent.ts            # extends BaseConsultant
mvp/src/services/agents/memory-optimizer/tools.ts                 # Add outcome analysis tools
mvp/src/services/queue/processors.ts                              # Hook OutcomeObserver at task completion
mvp/src/lib/di-container.ts                                       # Register OutcomeObserver
```

---

## Task 1: Skill Types and Foundation Skill Constants

**Files:**
- Create: `mvp/src/services/agents/skills/types.ts`
- Create: `mvp/src/services/agents/skills/foundation/all/security.ts`
- Create: `mvp/src/services/agents/skills/foundation/all/coding-standards.ts`
- Create: `mvp/src/services/agents/skills/foundation/all/quality-gates.ts`
- Create: `mvp/src/services/agents/skills/foundation/ba/api-design.ts`
- Create: `mvp/src/services/agents/skills/foundation/ba/database-migrations.ts`
- Create: `mvp/src/services/agents/skills/foundation/ba/prd-patterns.ts`
- Create: `mvp/src/services/agents/skills/foundation/dev/tdd-workflow.ts`
- Create: `mvp/src/services/agents/skills/foundation/dev/security-review.ts`
- Create: `mvp/src/services/agents/skills/foundation/dev/backend-patterns.ts`
- Create: `mvp/src/services/agents/skills/foundation/dev/docker-patterns.ts`
- Create: `mvp/src/services/agents/skills/foundation/qa/e2e-testing.ts`
- Create: `mvp/src/services/agents/skills/foundation/qa/test-coverage.ts`
- Create: `mvp/src/services/agents/skills/foundation/qa/security-scan.ts`

- [ ] **Step 1: Create skill type definitions**

```typescript
// mvp/src/services/agents/skills/types.ts

export type SkillTarget = 'all' | 'ba' | 'dev' | 'qa' | 'meeting_brain' | 'supervisor';
export type SkillScope = 'foundation' | 'learned';
export type LearnedSkillStatus = 'candidate' | 'active' | 'demoted';

export interface FoundationSkill {
  name: string;
  version: string;
  target: SkillTarget;
  content: string;
}

export interface LearnedSkill {
  id: string;
  name: string;
  content: string;
  target: SkillTarget;
  confidence: number;
  sourceOutcomes: number;
  positiveRate: number | null;
  negativeRate: number | null;
  status: LearnedSkillStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedSkill {
  name: string;
  version: string;
  scope: SkillScope;
  content: string;
}

export interface ConsultantConfig {
  agentType: string;
  rolePrompt: string;
  roleSkillTargets: SkillTarget[];
  tools: import('../agent-runtime/types.js').AgentTool[];
  maxSteps: number;
  confidenceThreshold: number;
  defaultModel: {
    provider: string;
    modelId: string;
  };
}
```

- [ ] **Step 2: Create all foundation skill files**

Each foundation skill follows this pattern (content adapted from ECC). Create all 13 files. Example for `security.ts`:

```typescript
// mvp/src/services/agents/skills/foundation/all/security.ts
import type { FoundationSkill } from '../../types.js';

export const SECURITY: FoundationSkill = {
  name: 'security',
  version: '1.0.0',
  target: 'all',
  content: `### Security Standards
- Never hardcode secrets — use environment variables or secret managers
- Validate all user input at system boundaries with schema validation
- Use parameterized queries for all database operations
- Sanitize HTML output to prevent XSS
- Verify webhook signatures using HMAC-SHA256 with timingSafeEqual
- Scope all queries by tenantId for multi-tenant isolation
- Never expose stack traces or internal errors to clients
- Rate limit authentication and public-facing endpoints`,
};
```

Content for each skill:
- `all/coding-standards.ts`: Immutability, file org (<800 lines), error handling, input validation
- `all/quality-gates.ts`: Confidence thresholds (0.9 auto-approve, 0.7 review, <0.7 blocked), max revision loops
- `ba/api-design.ts`: REST conventions, resource naming, pagination, error response format, versioning
- `ba/database-migrations.ts`: Backward-compatible migrations, rollback steps, zero-downtime, index strategy
- `ba/prd-patterns.ts`: Requirements structure, acceptance criteria, user stories, edge cases, non-functional requirements
- `dev/tdd-workflow.ts`: RED-GREEN-REFACTOR, 80%+ coverage, unit/integration/E2E, never fix tests to match broken code
- `dev/security-review.ts`: OWASP code patterns, auth checks, injection prevention, secret management in code
- `dev/backend-patterns.ts`: Service layer, repository pattern, DI, caching strategies, error handling
- `dev/docker-patterns.ts`: Multi-stage builds, non-root user, health checks, dumb-init, layer optimization
- `qa/e2e-testing.ts`: Page Object Model, network wait strategies, flaky test handling, screenshot artifacts
- `qa/test-coverage.ts`: Coverage targets, what to test (boundaries, edge cases, error paths), what not to test (trivial getters)
- `qa/security-scan.ts`: Vulnerability detection patterns, dependency audit, secret scanning, CORS validation

- [ ] **Step 3: Commit**

```bash
git add mvp/src/services/agents/skills/
git commit -m "feat: add skill type definitions and 13 foundation skills from ECC patterns"
```

---

## Task 2: Skill Loader

**Files:**
- Create: `mvp/src/services/agents/skills/loader.ts`
- Test: `mvp/src/services/agents/skills/__tests__/loader.test.ts`

- [ ] **Step 1: Write failing tests for SkillLoader**

```typescript
// mvp/src/services/agents/skills/__tests__/loader.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillLoader } from '../loader.js';

describe('SkillLoader', () => {
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(() => {
    mockPrisma = {
      learnedSkill: { findMany: vi.fn().mockResolvedValue([]) },
    };
    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue('OK'),
    };
  });

  describe('loadFoundationSkills', () => {
    it('returns all + role-specific skills for ba target', () => {
      const loader = new SkillLoader(mockPrisma, mockRedis);
      const skills = loader.loadFoundationSkills(['all', 'ba']);
      const names = skills.map(s => s.name);
      expect(names).toContain('security');
      expect(names).toContain('coding-standards');
      expect(names).toContain('quality-gates');
      expect(names).toContain('api-design');
      expect(names).not.toContain('tdd-workflow');
    });

    it('returns all + role-specific skills for dev target', () => {
      const loader = new SkillLoader(mockPrisma, mockRedis);
      const skills = loader.loadFoundationSkills(['all', 'dev']);
      const names = skills.map(s => s.name);
      expect(names).toContain('tdd-workflow');
      expect(names).not.toContain('api-design');
    });
  });

  describe('loadLearnedSkills', () => {
    it('loads active learned skills from DB', async () => {
      mockPrisma.learnedSkill.findMany.mockResolvedValue([
        { id: '1', name: 'pattern-1', content: 'Always X', target: 'all',
          confidence: 0.85, sourceOutcomes: 15, status: 'active',
          positiveRate: 0.9, negativeRate: 0.6, createdAt: new Date(), updatedAt: new Date() },
      ]);
      const loader = new SkillLoader(mockPrisma, mockRedis);
      const skills = await loader.loadLearnedSkills(['all', 'dev']);
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('pattern-1');
    });

    it('uses Redis cache when available (target-aware key)', async () => {
      // Cache key is 'skills:learned:' + sorted targets
      mockRedis.get.mockImplementation((key: string) => {
        if (key === 'skills:learned:all,dev') {
          return JSON.stringify([
            { name: 'cached-pattern', content: 'cached', scope: 'learned', version: 'learned' },
          ]);
        }
        return null;
      });
      const loader = new SkillLoader(mockPrisma, mockRedis);
      const skills = await loader.loadLearnedSkills(['all', 'dev']);
      expect(skills).toHaveLength(1);
      expect(mockPrisma.learnedSkill.findMany).not.toHaveBeenCalled();
    });

    it('excludes candidates and demoted skills', async () => {
      mockPrisma.learnedSkill.findMany.mockResolvedValue([]);
      const loader = new SkillLoader(mockPrisma, mockRedis);
      await loader.loadLearnedSkills(['all']);
      expect(mockPrisma.learnedSkill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'active' }) })
      );
    });
  });

  describe('resolveAllSkills', () => {
    it('combines foundation and learned skills', async () => {
      mockPrisma.learnedSkill.findMany.mockResolvedValue([]);
      const loader = new SkillLoader(mockPrisma, mockRedis);
      const skills = await loader.resolveAllSkills(['all', 'ba']);
      expect(skills.length).toBeGreaterThanOrEqual(3); // At least 3 foundation 'all' skills
      expect(skills.every(s => s.scope === 'foundation' || s.scope === 'learned')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mvp && npx vitest run src/services/agents/skills/__tests__/loader.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement SkillLoader**

```typescript
// mvp/src/services/agents/skills/loader.ts
import type { SkillTarget, ResolvedSkill, FoundationSkill } from './types.js';
import { createChildLogger } from '../../lib/logger.js';

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
    // Cache key includes sorted targets to avoid cross-role cache pollution
    const cacheKey = LEARNED_SKILLS_CACHE_PREFIX + [...targets].sort().join(',');

    // Check Redis cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as ResolvedSkill[];
      } catch {
        log.warn('Failed to parse learned skills cache');
      }
    }

    // Load from DB
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

    // Cache in Redis (target-specific key)
    await this.redis.setex(cacheKey, LEARNED_SKILLS_CACHE_TTL, JSON.stringify(resolved));

    return resolved;
  }

  async resolveAllSkills(targets: SkillTarget[]): Promise<ResolvedSkill[]> {
    const foundation = this.loadFoundationSkills(targets);
    const learned = await this.loadLearnedSkills(targets);
    return [...foundation, ...learned];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mvp && npx vitest run src/services/agents/skills/__tests__/loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mvp/src/services/agents/skills/loader.ts mvp/src/__tests__/services/agents/skills/loader.test.ts
git commit -m "feat: add SkillLoader with Redis caching and foundation/learned skill resolution"
```

---

## Task 3: Prisma Schema — LearnedSkill and AgentOutcome Models

**Files:**
- Modify: `mvp/prisma/schema.prisma`

- [ ] **Step 1: Add LearnedSkill and AgentOutcome models to Prisma schema**

Append to `mvp/prisma/schema.prisma`:

```prisma
model LearnedSkill {
  id              String   @id @default(cuid())
  name            String
  content         String   @db.Text
  target          String   // all, ba, dev, qa, meeting_brain, supervisor
  confidence      Float    @default(0.3)
  sourceOutcomes  Int      @default(0)
  positiveRate    Float?
  negativeRate    Float?
  status          String   @default("candidate") // candidate, active, demoted
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([status, target])
  @@index([status])
  @@map("learned_skills")
}

model AgentOutcome {
  id                String   @id @default(cuid())
  agentType         String
  taskId            String
  result            String   // approved, revised, rejected
  confidenceScore   Float
  toolsUsed         Json?    // Array of tool names in order
  stepCount         Int?
  revisionFeedback  String?  @db.Text
  metadata          Json?
  createdAt         DateTime @default(now())

  @@index([agentType, result])
  @@index([createdAt])
  @@map("agent_outcomes")
}
```

- [ ] **Step 2: Generate Prisma client and create migration**

Run: `cd mvp && npx prisma migrate dev --name add_learned_skills_and_outcomes`
Expected: Migration created, client regenerated

- [ ] **Step 3: Commit**

```bash
git add mvp/prisma/
git commit -m "feat: add LearnedSkill and AgentOutcome Prisma models"
```

---

## Task 4: Extend AgentRunResult with skillVersions

**Files:**
- Modify: `mvp/src/services/agent-runtime/types.ts` (line ~45-52)

- [ ] **Step 1: Add skillVersions to AgentRunResult**

In `mvp/src/services/agent-runtime/types.ts`, add to the `AgentRunResult` interface:

```typescript
skillVersions?: Array<{ name: string; version: string; scope: 'foundation' | 'learned' }>;
```

This is additive and backward-compatible — existing code that doesn't populate it will have `undefined`.

- [ ] **Step 2: Commit**

```bash
git add mvp/src/services/agent-runtime/types.ts
git commit -m "feat: add skillVersions to AgentRunResult for audit trails"
```

---

## Task 5: BaseConsultant Abstract Class

**Files:**
- Create: `mvp/src/services/agents/base-consultant.ts`
- Test: `mvp/src/services/agents/__tests__/base-consultant.test.ts`

- [ ] **Step 1: Write failing tests for BaseConsultant**

```typescript
// mvp/src/services/agents/__tests__/base-consultant.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseConsultant } from '../base-consultant.js';
import type { ConsultantConfig } from '../skills/types.js';
import type { AgentTool } from '../../agent-runtime/types.js';

// Concrete subclass for testing
class TestConsultant extends BaseConsultant {
  readonly agentType = 'test_agent' as const;
}

describe('BaseConsultant', () => {
  let mockModelClient: any;
  let mockModelRegistry: any;
  let mockSkillLoader: any;
  let config: ConsultantConfig;

  beforeEach(() => {
    mockModelClient = { chat: vi.fn() };
    mockModelRegistry = { resolveModel: vi.fn().mockResolvedValue(null) };
    mockSkillLoader = {
      loadFoundationSkills: vi.fn().mockReturnValue([
        { name: 'security', version: '1.0.0', scope: 'foundation', content: '### Security\nValidate inputs' },
      ]),
      loadLearnedSkills: vi.fn().mockResolvedValue([
        { name: 'pattern-1', version: 'learned', scope: 'learned', content: '### Learned\nAlways do X' },
      ]),
      resolveAllSkills: vi.fn().mockResolvedValue([
        { name: 'security', version: '1.0.0', scope: 'foundation', content: '### Security\nValidate inputs' },
        { name: 'pattern-1', version: 'learned', scope: 'learned', content: '### Learned\nAlways do X' },
      ]),
    };
    config = {
      agentType: 'test_agent',
      rolePrompt: 'You are a test agent.',
      roleSkillTargets: ['all'],
      tools: [],
      maxSteps: 10,
      confidenceThreshold: 0.85,
      defaultModel: { provider: 'google', modelId: 'gemini-2.0-flash' },
    };
  });

  describe('buildSystemPrompt', () => {
    it('composes role prompt + foundation skills + learned skills', async () => {
      const consultant = new TestConsultant(mockModelClient, mockModelRegistry, config, mockSkillLoader);
      const prompt = await consultant.buildSystemPrompt();
      expect(prompt).toContain('You are a test agent.');
      expect(prompt).toContain('## Firm Methodology');
      expect(prompt).toContain('### Security');
      expect(prompt).toContain('## Institutional Knowledge');
      expect(prompt).toContain('### Learned');
    });

    it('omits Institutional Knowledge section when no learned skills', async () => {
      mockSkillLoader.resolveAllSkills.mockResolvedValue([
        { name: 'security', version: '1.0.0', scope: 'foundation', content: '### Security\nValidate' },
      ]);
      const consultant = new TestConsultant(mockModelClient, mockModelRegistry, config, mockSkillLoader);
      const prompt = await consultant.buildSystemPrompt();
      expect(prompt).not.toContain('## Institutional Knowledge');
    });
  });

  describe('resolveModelConfig', () => {
    it('uses model registry when available', async () => {
      mockModelRegistry.resolveModel.mockResolvedValue({ provider: 'anthropic', modelId: 'claude-sonnet-4' });
      const consultant = new TestConsultant(mockModelClient, mockModelRegistry, config, mockSkillLoader);
      const model = await consultant.resolveModelConfig('tenant-1');
      expect(model).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4' });
    });

    it('falls back to default model', async () => {
      const consultant = new TestConsultant(mockModelClient, mockModelRegistry, config, mockSkillLoader);
      const model = await consultant.resolveModelConfig('tenant-1');
      expect(model).toEqual({ provider: 'google', modelId: 'gemini-2.0-flash' });
    });
  });

  describe('getSkillVersions', () => {
    it('returns skill versions for audit trail', async () => {
      const consultant = new TestConsultant(mockModelClient, mockModelRegistry, config, mockSkillLoader);
      const versions = await consultant.getSkillVersions();
      expect(versions).toContainEqual({ name: 'security', version: '1.0.0', scope: 'foundation' });
      expect(versions).toContainEqual({ name: 'pattern-1', version: 'learned', scope: 'learned' });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mvp && npx vitest run src/services/agents/__tests__/base-consultant.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement BaseConsultant**

```typescript
// mvp/src/services/agents/base-consultant.ts
import { AgentLoop } from '../agent-runtime/agent-loop.js';
import type { AgentContext, AgentRunResult, ModelClient } from '../agent-runtime/types.js';
import type { ModelRegistryService } from '../model-registry/model-registry.service.js';
import type { ConsultantConfig, ResolvedSkill } from './skills/types.js';
import type { SkillLoader } from './skills/loader.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger({ module: 'base-consultant' });
const MAX_SKILL_TOKENS = 1500;
// Rough estimate: 1 token ≈ 4 chars for English text
const CHARS_PER_TOKEN = 4;

export abstract class BaseConsultant {
  abstract readonly agentType: string;

  private cachedSkills: ResolvedSkill[] | null = null;

  constructor(
    protected modelClient: ModelClient,
    protected modelRegistry: ModelRegistryService | undefined,
    protected consultantConfig: ConsultantConfig,
    protected skillLoader: SkillLoader,
  ) {}

  async buildSystemPrompt(): Promise<string> {
    const skills = await this.loadSkills();

    const foundationSkills = skills.filter(s => s.scope === 'foundation');
    const learnedSkills = skills.filter(s => s.scope === 'learned');

    const sections: string[] = [this.consultantConfig.rolePrompt];

    if (foundationSkills.length > 0) {
      sections.push('\n## Firm Methodology\n');
      sections.push(...foundationSkills.map(s => s.content));
    }

    // Token budget enforcement: truncate learned skills if over budget
    // Foundation skills are never truncated. Learned skills are already
    // sorted by confidence desc, so we drop lowest-confidence first.
    const foundationChars = sections.join('\n').length - this.consultantConfig.rolePrompt.length;
    const remainingBudget = (MAX_SKILL_TOKENS * CHARS_PER_TOKEN) - foundationChars;

    if (learnedSkills.length > 0 && remainingBudget > 0) {
      const fittingSkills: ResolvedSkill[] = [];
      let usedChars = 0;
      for (const skill of learnedSkills) {
        if (usedChars + skill.content.length > remainingBudget) {
          log.warn('Truncating learned skills to fit token budget', {
            included: fittingSkills.length,
            dropped: learnedSkills.length - fittingSkills.length,
            agentType: this.consultantConfig.agentType,
          });
          break;
        }
        fittingSkills.push(skill);
        usedChars += skill.content.length;
      }
      if (fittingSkills.length > 0) {
        sections.push('\n## Institutional Knowledge\n');
        sections.push(...fittingSkills.map(s => s.content));
      }
    }

    return sections.join('\n');
  }

  async resolveModelConfig(tenantId: string) {
    if (this.modelRegistry) {
      try {
        const resolved = await this.modelRegistry.resolveModel(tenantId, this.consultantConfig.agentType);
        if (resolved) return resolved;
      } catch {
        // Fall through to default — resolveModel throws for unknown agent types
      }
    }
    return this.consultantConfig.defaultModel;
  }

  async getSkillVersions(): Promise<Array<{ name: string; version: string; scope: 'foundation' | 'learned' }>> {
    const skills = await this.loadSkills();
    return skills.map(s => ({ name: s.name, version: s.version, scope: s.scope }));
  }

  protected async runLoop(task: string, context: AgentContext): Promise<AgentRunResult> {
    const model = await this.resolveModelConfig(context.tenantId);
    const systemPrompt = await this.buildSystemPrompt();
    const skillVersions = await this.getSkillVersions();

    const loop = new AgentLoop(
      {
        agentType: this.consultantConfig.agentType,
        systemPrompt,
        tools: this.consultantConfig.tools,
        maxSteps: this.consultantConfig.maxSteps,
        confidenceThreshold: this.consultantConfig.confidenceThreshold,
        model,
      },
      this.modelClient,
    );

    const result = await loop.run(task, context);
    result.skillVersions = skillVersions;
    return result;
  }

  private async loadSkills(): Promise<ResolvedSkill[]> {
    if (this.cachedSkills) return this.cachedSkills;
    this.cachedSkills = await this.skillLoader.resolveAllSkills(this.consultantConfig.roleSkillTargets);
    return this.cachedSkills;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mvp && npx vitest run src/services/agents/__tests__/base-consultant.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mvp/src/services/agents/base-consultant.ts mvp/src/__tests__/services/agents/base-consultant.test.ts
git commit -m "feat: add BaseConsultant with skill-composed prompts and model resolution"
```

---

## Task 6: Migrate Agents to Extend BaseConsultant

**Files:**
- Modify: `mvp/src/services/agents/ba/ba.agent.ts`
- Modify: `mvp/src/services/agents/dev/dev.agent.ts`
- Modify: `mvp/src/services/agents/qa/qa.agent.ts`
- Modify: `mvp/src/services/agents/meeting-brain/meeting-brain.agent.ts`
- Modify: `mvp/src/services/agents/supervisor/supervisor.agent.ts`

- [ ] **Step 1: Run existing agent tests to confirm green baseline**

Run: `cd mvp && npx vitest run src/__tests__/ --reporter=verbose 2>&1 | tail -5`
Expected: Note current pass/fail counts as baseline

- [ ] **Step 2: Migrate BAAgent to extend BaseConsultant**

Read `mvp/src/services/agents/ba/ba.agent.ts`. Change:
1. Import `BaseConsultant` and `ConsultantConfig`
2. Replace `class BAAgent {` with `class BAAgent extends BaseConsultant {`
3. In constructor, call `super(modelClient, modelRegistry, { ... consultantConfig ... }, skillLoader)`
4. Add `skillLoader: SkillLoader` as a new constructor parameter
5. Replace the manual `AgentLoop` creation in `processTranscript()` with `this.runLoop(task, context)`
6. Remove the now-inherited `resolveModelConfig()` private method

Keep the existing `processTranscript()` method signature and logic for building `task` and `context` — only replace the AgentLoop instantiation with `this.runLoop()`.

- [ ] **Step 3: Migrate DevAgent, QAAgent, MeetingBrainAgent, SupervisorAgent**

Apply the same pattern to each agent. Key differences per agent (values verified against current codebase):
- **DevAgent**: `roleSkillTargets: ['all', 'dev']`, `defaultModel: anthropic/claude-sonnet-4`, `maxSteps: 50`, `confidenceThreshold: 0.9`
- **QAAgent**: `roleSkillTargets: ['all', 'qa']`, `defaultModel: anthropic/claude-sonnet-4`, `maxSteps: 30`, `confidenceThreshold: 0.9`
- **MeetingBrainAgent**: `roleSkillTargets: ['all']`, `defaultModel: google/gemini-2.0-flash`, `maxSteps: 25`, `confidenceThreshold: 0.85`
- **SupervisorAgent**: `roleSkillTargets: ['all']`, `defaultModel: anthropic/claude-sonnet-4`, `maxSteps: 15`, `confidenceThreshold: 0.85`. Note: Supervisor takes `(modelClient, engagementService, modelRegistry?, queueService?)` — pass only `modelClient` and `modelRegistry` to `super()`, keep `engagementService` and `queueService` as private fields in the subclass. Also: Supervisor defines `SYSTEM_PROMPT` as a local const (not in a separate prompts.ts) — reference it directly as `rolePrompt: SYSTEM_PROMPT`. Supervisor has two methods with different maxSteps (10 and 15) — use 15 as the default and allow `runLoop` to accept an optional `maxStepsOverride` param for the shorter path.

**IMPORTANT:** The `runLoop` method in BaseConsultant should accept an optional `overrides?: { maxSteps?: number }` parameter to handle agents like Supervisor that have per-method step limits.

- [ ] **Step 4: Update DI container and processors to pass SkillLoader to agents**

Agents are NOT instantiated in the DI container directly — they are created inside `mvp/src/services/queue/processors.ts` via the `ProcessorDependencies` interface. The fix:

1. In `mvp/src/lib/di-container.ts`: Create a `SkillLoader` instance (needs `prisma` and `redis`, both already available) and add it to the dependencies passed to `createProcessors()`.
2. In `mvp/src/services/queue/processors.ts`: Update the `ProcessorDependencies` interface to include `skillLoader: SkillLoader`. Pass it to each agent constructor where agents are instantiated (BA, Dev, QA, MeetingBrain, Supervisor).
3. Also update `processors.ts` imports: the existing `import { buildCodeGenerationPrompt, buildCodeReviewPrompt } from '../agents/coding-standards.js'` will need updating in Task 9 when those functions are moved.

- [ ] **Step 5: Run all tests to verify nothing broke**

Run: `cd mvp && npx vitest run`
Expected: Same pass/fail count as baseline (or better). If existing agent tests mock the constructor, update mocks to include `skillLoader` parameter.

- [ ] **Step 6: Commit**

```bash
git add mvp/src/services/agents/ mvp/src/lib/di-container.ts
git commit -m "feat: migrate all 5 agents to extend BaseConsultant with skill injection"
```

---

## Task 7: OutcomeObserver Service

**Files:**
- Create: `mvp/src/services/agents/outcome-observer.ts`
- Test: `mvp/src/services/agents/__tests__/outcome-observer.test.ts`
- Modify: `mvp/src/services/queue/processors.ts`
- Modify: `mvp/src/lib/di-container.ts`

- [ ] **Step 1: Write failing tests for OutcomeObserver**

```typescript
// mvp/src/services/agents/__tests__/outcome-observer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutcomeObserver } from '../outcome-observer.js';

describe('OutcomeObserver', () => {
  let mockPrisma: any;
  let observer: OutcomeObserver;

  beforeEach(() => {
    mockPrisma = {
      agentOutcome: { create: vi.fn().mockResolvedValue({ id: 'outcome-1' }) },
      agentTask: { findUnique: vi.fn() },
      clarificationRequest: { findMany: vi.fn().mockResolvedValue([]) },
    };
    observer = new OutcomeObserver(mockPrisma);
  });

  describe('record', () => {
    it('maps completed+approved task to approved outcome', async () => {
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-1', status: 'completed', approvedBy: 'user-1',
        agentType: 'ba_agent', confidence: 0.92, output: {},
      });
      mockPrisma.clarificationRequest.findMany.mockResolvedValue([]);

      await observer.recordFromTask('task-1');

      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ result: 'approved', agentType: 'ba_agent' }),
      });
    });

    it('maps completed task with answered clarifications to revised', async () => {
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-2', status: 'completed', approvedBy: null,
        agentType: 'dev_agent', confidence: 0.78, output: {},
      });
      mockPrisma.clarificationRequest.findMany.mockResolvedValue([
        { id: 'cr-1', status: 'answered', response: 'Use approach B' },
      ]);

      await observer.recordFromTask('task-2');

      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          result: 'revised',
          revisionFeedback: 'Use approach B',
        }),
      });
    });

    it('maps failed task to rejected', async () => {
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-3', status: 'failed', approvedBy: null,
        agentType: 'qa_agent', confidence: 0.4, error: 'Validation failed',
      });

      await observer.recordFromTask('task-3');

      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ result: 'rejected' }),
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mvp && npx vitest run src/services/agents/__tests__/outcome-observer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement OutcomeObserver**

```typescript
// mvp/src/services/agents/outcome-observer.ts
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger({ module: 'outcome-observer' });

type OutcomeResult = 'approved' | 'revised' | 'rejected';

export class OutcomeObserver {
  constructor(private prisma: any) {}

  async recordFromTask(taskId: string): Promise<void> {
    try {
      const task = await this.prisma.agentTask.findUnique({ where: { id: taskId } });
      if (!task) {
        log.warn('Task not found for outcome recording', { taskId });
        return;
      }

      const clarifications = await this.prisma.clarificationRequest.findMany({
        where: { taskId, status: 'answered' },
        orderBy: { respondedAt: 'desc' },
      });

      const result = this.mapResult(task, clarifications);
      const revisionFeedback = clarifications.length > 0
        ? clarifications.map((c: any) => c.response).filter(Boolean).join('\n')
        : undefined;

      await this.prisma.agentOutcome.create({
        data: {
          agentType: task.agentType,
          taskId: task.id,
          result,
          confidenceScore: task.confidence || 0,
          toolsUsed: task.output?.toolsUsed || null,
          stepCount: task.output?.stepCount || null,
          revisionFeedback,
          metadata: {
            retryCount: task.retryCount,
            approvedBy: task.approvedBy,
          },
        },
      });

      log.info('Outcome recorded', { taskId, agentType: task.agentType, result });
    } catch (err) {
      log.error('Failed to record outcome', { taskId, error: (err as Error).message });
    }
  }

  private mapResult(task: any, clarifications: any[]): OutcomeResult {
    if (task.status === 'failed') return 'rejected';
    if (task.status === 'completed' && task.approvedBy) return 'approved';
    if (task.status === 'completed' && clarifications.length > 0) return 'revised';
    // Default: completed without explicit approval = approved (auto-approved by confidence)
    if (task.status === 'completed') return 'approved';
    return 'rejected';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mvp && npx vitest run src/services/agents/__tests__/outcome-observer.test.ts`
Expected: PASS

- [ ] **Step 5: Hook OutcomeObserver into queue processors**

In `mvp/src/services/queue/processors.ts`, find the task completion points (where `AgentTask.status` is set to `completed` or `failed`). Add:

```typescript
// After task status is updated to completed/failed
await this.outcomeObserver.recordFromTask(task.id);
```

Register OutcomeObserver in `mvp/src/lib/di-container.ts` and inject into the queue processor.

- [ ] **Step 6: Run full test suite**

Run: `cd mvp && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add mvp/src/services/agents/outcome-observer.ts mvp/src/__tests__/services/agents/outcome-observer.test.ts mvp/src/services/queue/processors.ts mvp/src/lib/di-container.ts
git commit -m "feat: add OutcomeObserver with task-to-outcome mapping and queue processor hook"
```

---

## Task 8: MemoryOptimizer Outcome Analysis Extension

**Files:**
- Modify: `mvp/src/services/agents/memory-optimizer/tools.ts`
- Modify: `mvp/src/services/agents/memory-optimizer/memory-optimizer.agent.ts`

- [ ] **Step 1: Add 3 new tools to memory-optimizer/tools.ts**

Append to the `createMemoryOptimizerTools()` return array:

1. `read_outcome_batch` — Queries `agentOutcome` table for recent unanalyzed outcomes grouped by agentType and result. Input: `{ limit?: number }`. Returns: `{ outcomes: Array<{ agentType, result, confidence, toolsUsed, revisionFeedback }> }`.

2. `extract_skill_candidate` — Writes a new learned skill candidate to DB. Input: `{ name: string, content: string, target: string, evidence: string }`. Returns: `{ id: string, created: true }`.

3. `update_skill_confidence` — Recalculates confidence for a learned skill. Input: `{ skillId: string, newConfidence: number, additionalOutcomes: number }`. If confidence ≥ 0.8 and sourceOutcomes ≥ 10, runs a content sanitization check before promoting to `active` (rejects content containing company names, domain jargon, or specific tech stack references — flags for manual review instead). If confidence < 0.5, demotes. Invalidates Redis cache (all `skills:learned:*` keys) on status change. Returns: `{ id, newStatus, newConfidence }`.

- [ ] **Step 2: Add analyzeOutcomes() method to MemoryOptimizerAgent**

Add a new public method alongside existing `optimizeTenant()`:

```typescript
async analyzeOutcomes(): Promise<{
  patternsFound: number;
  candidatesCreated: string[];
  candidatesPromoted: string[];
  candidatesDemoted: string[];
}> {
  // Uses the same AgentLoop pattern but with OUTCOME_ANALYSIS_PROMPT
  // and the 3 new tools plus existing memory tools
}
```

- [ ] **Step 3: Add BullMQ job type and scheduling for outcome analysis**

In `mvp/src/services/queue/queue.service.ts`, add a new job type `OUTCOME_ANALYSIS` (or extend the existing `MEMORY_OPTIMIZER` job to accept a `mode` parameter: `'tenant_optimization' | 'outcome_analysis'`).

In `mvp/src/lib/di-container.ts`, add a recurring BullMQ job that triggers outcome analysis daily:
```typescript
await queue.add('outcome-analysis', { mode: 'outcome_analysis' }, {
  repeat: { pattern: '0 2 * * *' }, // Daily at 2am
});
```

Also add an outcome-count trigger: after every `OutcomeObserver.recordFromTask()`, check if unanalyzed outcomes ≥ 50 and trigger an immediate analysis job if so.

- [ ] **Step 4: Run full test suite**

Run: `cd mvp && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add mvp/src/services/agents/memory-optimizer/ mvp/src/services/queue/ mvp/src/lib/di-container.ts
git commit -m "feat: extend MemoryOptimizer with outcome analysis tools, scheduling, and skill promotion"
```

---

## Task 9: Deprecate coding-standards.ts

**Files:**
- Modify: `mvp/src/services/agents/coding-standards.ts`
- Modify: `mvp/src/services/agents/dev/tools.ts` (move helper functions)
- Modify: `mvp/src/services/agents/qa/tools.ts` (move helper functions)
- Modify: `mvp/src/services/queue/processors.ts` (update imports from coding-standards.ts)

- [ ] **Step 1: Move helper functions to agent tool files**

Move `buildCodeGenerationPrompt`, `buildSelfReviewPrompt` from `coding-standards.ts` to `dev/tools.ts`.
Move `buildCodeReviewPrompt`, `buildCoverageAnalysisPrompt` to `qa/tools.ts`.
The constants (`CODE_GENERATION_STANDARDS`, etc.) are now replaced by foundation skills — update any direct references to use the foundation skill content instead.

- [ ] **Step 2: Add deprecation notice to coding-standards.ts**

```typescript
/**
 * @deprecated Content migrated to services/agents/skills/foundation/.
 * Helper functions moved to dev/tools.ts and qa/tools.ts.
 * This file will be removed in a future release.
 */
```

- [ ] **Step 3: Run full test suite**

Run: `cd mvp && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add mvp/src/services/agents/
git commit -m "refactor: deprecate coding-standards.ts, migrate helpers to agent tool files"
```

---

## Task 10: Admin Kill Switch Endpoint

**Files:**
- Create: `mvp/src/routes/admin.learned-skills.routes.ts` (or add to existing admin routes)

- [ ] **Step 1: Add PATCH endpoint for learned skill status**

```typescript
// PATCH /admin/learned-skills/:id
// Body: { status: 'active' | 'demoted' }
// Requires super admin auth
// Invalidates Redis cache on change
```

- [ ] **Step 2: Run full test suite**

Run: `cd mvp && npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add mvp/src/routes/
git commit -m "feat: add admin endpoint for learned skill kill switch"
```

---

## Task 11: Integration Test — Full Skill Injection Cycle

**Files:**
- Create: `mvp/src/__tests__/integration/skill-injection.test.ts`

- [ ] **Step 1: Write integration test**

Test that a BAAgent instance (extending BaseConsultant) builds a system prompt that includes foundation skills. Mock the model client and verify the system prompt passed to `chat()` contains skill content.

- [ ] **Step 2: Run test**

Run: `cd mvp && npx vitest run src/__tests__/integration/skill-injection.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite one final time**

Run: `cd mvp && npx vitest run`
Expected: All tests pass, no regressions

- [ ] **Step 4: Commit**

```bash
git add mvp/src/__tests__/integration/skill-injection.test.ts
git commit -m "test: add integration test for full skill injection cycle"
```
