# Skill Registry + Self-Improving Agent Consultants

**Date:** 2026-03-19
**Status:** Approved
**Author:** AI-assisted design

## Overview

Workforce0 is a "company of consultants." AI agents join meetings, gather requirements, and deliver end products autonomously. This design introduces a **skill system** that gives every consultant battle-tested professional competencies (sourced from ECC patterns) and enables the firm to **self-improve** by learning from outcomes.

Skills are automatic — agents don't "choose" to use them. They're baked into the consultant's DNA, like how a senior developer at a top consulting firm doesn't "decide to use TDD" — they just do it because that's how the firm operates.

## Architecture: Inheritance + Skill Layers

### Agent Inheritance

```
BaseConsultant (firm-wide training every employee gets)
  ├── BAConsultant (+api_design, +database_migrations, +prd_patterns)
  ├── DevConsultant (+tdd_workflow, +security_review, +backend_patterns, +docker_patterns)
  ├── QAConsultant (+e2e_testing, +security_scan, +test_coverage)
  ├── MeetingBrainConsultant (no role-specific skills — uses 'all' only)
  └── SupervisorConsultant (no role-specific skills — uses 'all' only)
```

The codebase has 5 agents: BA, Dev, QA, MeetingBrain, and Supervisor (plus MemoryOptimizer which is a system agent, not a consultant). All follow the same AgentLoop pattern but have **different constructor signatures**:

- BA and QA take `(modelClient, prisma, commsRouter, memoryService, modelRegistry?)`
- Dev and MeetingBrain take `(modelClient, prisma, memoryService, modelRegistry?)`
- Supervisor takes `(modelClient, engagementService, modelRegistry?, queueService?)`

To accommodate this, **BaseConsultant only takes what it actually needs** for skill composition and loop management. Role-specific dependencies stay in subclass constructors:

```typescript
// BaseConsultant takes ONLY skill/loop concerns
constructor(
  protected modelClient: ModelClient,
  protected modelRegistry: ModelRegistryService | undefined,
  protected consultantConfig: ConsultantConfig,  // rolePrompt, skills, tools, thresholds
)

// Subclasses keep their own deps
class BAAgent extends BaseConsultant {
  constructor(modelClient, prisma, commsRouter, memoryService, modelRegistry?) {
    super(modelClient, modelRegistry, {
      rolePrompt: BA_SYSTEM_PROMPT,
      roleSkillTargets: ['all', 'ba'],
      tools: createBATools({ prisma, commsRouter, memoryService }),
      maxSteps: 25, confidenceThreshold: 0.85,
      defaultModel: { provider: 'google', modelId: 'gemini-2.0-flash-thinking' },
    });
  }
}
```

MemoryOptimizer does NOT extend BaseConsultant — it's a system agent that analyzes outcomes, not a client-facing consultant. It stays standalone but gains new tools for outcome batch analysis.

### Skill Layers

```
Layer 1: Foundation Skills (code, immutable, confidence=1.0)
   ECC patterns baked in at build time.
   Security rules, TDD, coding standards, API design.
   Updated only via code deploys.

Layer 2: Learned Skills (DB, auto-updated, confidence=0.8+)
   Extracted from outcomes. Promoted after 10+ confirmations.
   "PRDs with rollback steps get approved 2x more often."
   Loaded at agent init, cached in Redis.

Layer 3: Engagement Memory (existing MemoryService, per-tenant)
   Tenant preferences, conventions, patterns.
   NOT skills — contextual knowledge. Already implemented.
```

### System Prompt Composition

`BaseConsultant.buildSystemPrompt()` composes the full prompt:

```
[Role Base Prompt]              ← Existing agent prompt (BA_SYSTEM_PROMPT, etc.)

## Firm Methodology
[Foundation skills: all]        ← ECC patterns every consultant knows

## Role Expertise
[Foundation skills: role]       ← Role-specific ECC patterns

## Institutional Knowledge
[Learned skills: all + role]    ← Self-improved patterns from outcomes
```

Existing agent prompts stay unchanged. Skills are appended as additional sections. No breaking changes to prompts, tools, or the AgentLoop.

## Skill Format

```typescript
interface Skill {
  id: string;
  name: string;
  content: string;              // The actual knowledge (markdown)
  scope: 'foundation' | 'learned';
  target: 'all' | 'ba' | 'dev' | 'qa';
  confidence: number;           // 0.0-1.0 (foundation always 1.0)
  source: string;               // 'ecc:tdd-workflow' or 'outcome:prd-approval-pattern'
  outcomeCount: number;         // How many outcomes confirmed this
  createdAt: Date;
  updatedAt: Date;
}
```

### Foundation Skills (Layer 1)

Stored in code as constants. Version controlled. Deployed with the app.

```
skills/foundation/
├── all/
│   ├── security.ts             # OWASP, input validation, secret management
│   ├── coding-standards.ts     # Immutability, file org, error handling
│   └── quality-gates.ts        # Confidence thresholds, review triggers
├── ba/
│   ├── api-design.ts           # REST conventions, pagination, error responses
│   ├── database-migrations.ts  # Safe schema changes, rollback steps
│   └── prd-patterns.ts         # Requirements structure, acceptance criteria
├── dev/
│   ├── tdd-workflow.ts         # RED-GREEN-REFACTOR, 80% coverage
│   ├── security-review.ts     # Code-level security patterns
│   ├── backend-patterns.ts     # Service layer, repository, caching
│   └── docker-patterns.ts      # Multi-stage builds, health checks
└── qa/
    ├── e2e-testing.ts          # Playwright POM, flaky test handling
    ├── test-coverage.ts        # Coverage strategies, what to test
    └── security-scan.ts        # Vulnerability detection patterns
```

Each file exports a simple constant:

```typescript
export const TDD_WORKFLOW: FoundationSkill = {
  name: 'tdd-workflow',
  target: 'dev',
  content: `
### Test-Driven Development
1. Write a failing test that defines the expected behavior
2. Write the minimal code to make the test pass
3. Refactor while keeping tests green
4. Target 80%+ coverage (unit + integration + E2E)
5. Never fix tests to match broken code — fix the code
  `,
};
```

**Prompt budget:** Foundation skills are 50-150 words each. 3 `all` skills + 4 role skills adds ~700-1000 tokens. Well within budget for any model. `buildSystemPrompt()` includes a token count check — if total skill injection exceeds 1500 tokens, it logs a warning and truncates least-critical learned skills first (foundation skills are never truncated).

**Migration from existing coding-standards.ts:** The file `services/agents/coding-standards.ts` already exports `CODE_GENERATION_STANDARDS`, `CODE_REVIEW_STANDARDS`, and `COVERAGE_ANALYSIS_STANDARDS`. These overlap with the proposed foundation skills. During implementation, this content is **migrated into the foundation skills system** — the existing file is deprecated and its consumers (Dev and QA prompts) switch to pulling from the foundation skills via BaseConsultant. The four helper functions (`buildCodeGenerationPrompt`, `buildCodeReviewPrompt`, `buildSelfReviewPrompt`, `buildCoverageAnalysisPrompt`) are moved into the respective agent tool files (`dev/tools.ts`, `qa/tools.ts`) as local utilities, since they are prompt builders specific to those tools. This avoids duplicate competing standards.

### Learned Skills (Layer 2)

Stored in DB. Loaded at agent init. Cached in Redis (30min TTL).

```sql
CREATE TABLE learned_skill (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  content       TEXT NOT NULL,
  target        TEXT NOT NULL CHECK (target IN ('all', 'ba', 'dev', 'qa')),
  confidence    FLOAT NOT NULL DEFAULT 0.3,
  source_outcomes INT NOT NULL DEFAULT 0,
  positive_rate FLOAT,
  negative_rate FLOAT,
  status        TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'demoted')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Learning Loop (Self-Improvement)

### Feedback Cycle

```
Agent completes task
       ↓
OutcomeObserver records outcome
       ↓
Was output approved/rejected/revised?
       ↓
Extract pattern with confidence score
       ↓
Store as candidate (confidence starts low)
       ↓
Same pattern confirmed across 10+ outcomes?
       ↓
Promote to learned skill (injected into future prompts)
```

### OutcomeObserver

A lightweight service (NOT an agent, no LLM per-call):

```typescript
interface Outcome {
  agentType: string;
  taskId: string;
  result: 'approved' | 'revised' | 'rejected';
  agentOutput: string;
  revisionFeedback?: string;
  confidenceScore: number;
  metadata: Record<string, unknown>;
}
```

**Mapping existing AgentTask.status to Outcome.result:**

| AgentTask.status | Condition | Outcome.result |
|---|---|---|
| `completed` | `approvedBy != null` | `approved` |
| `completed` | has ≥1 `ClarificationRequest` with `status = 'answered'` linked to task | `revised` |
| `failed` | any | `rejected` |
| `awaiting_approval` | subsequently rejected by human | `rejected` |

**Revision feedback source:** The existing AgentTask model has no `revisionNotes` field. Revision feedback is sourced from `ClarificationRequest` records linked to the task — these already capture human feedback text. For the initial implementation, `revisionFeedback` is populated from the most recent ClarificationRequest response. A future migration may add a dedicated `revisionNotes` field to AgentTask for richer feedback.

### Pattern Extraction — Two Modes

**Fast path (no LLM):** Structural signal tracking. "Dev Agent outputs with `self_review` tool called last have 91% approval rate vs 74% without." Tracks tool usage order, step count, confidence correlation.

**Deep path (LLM, batched):** Periodically (daily or after N outcomes), the existing MemoryOptimizer agent is extended to analyze outcome batches. Reads clusters of approved vs rejected outputs and extracts qualitative patterns.

### Confidence Lifecycle

```
Observation (confidence 0.3, needs 5+ confirmations)
    ↓ confirmed by more outcomes
Candidate (confidence 0.5-0.7, not yet injected)
    ↓ confirmed by 10+ outcomes across multiple tenants
Learned Skill (confidence 0.8+, injected into prompts)
    ↓ contradicted by new outcomes
Demoted (confidence drops, removed from prompts at <0.5)
```

### Promotion Rules

- Pattern needs **≥10 confirming outcomes** and **confidence ≥0.8** to become active
- Patterns appearing for only one tenant stay in Layer 3 (tenant memory), not promoted
- Patterns correlated with rejections get automatically demoted
- **Learned skills can only ADD methodology — they never contradict or override foundation skills**

## Integration: What Changes, What Doesn't

### New Files (7 areas)

```
mvp/src/services/agents/base-consultant.ts
mvp/src/services/agents/skills/types.ts
mvp/src/services/agents/skills/foundation/ (10 skill files)
mvp/src/services/agents/skills/loader.ts
mvp/src/services/agents/outcome-observer.ts
mvp/prisma/migrations/XXXX_add_learned_skills/
```

### Modified Files (8)

```
mvp/src/services/agents/ba/ba.agent.ts              → extends BaseConsultant
mvp/src/services/agents/dev/dev.agent.ts            → extends BaseConsultant
mvp/src/services/agents/qa/qa.agent.ts              → extends BaseConsultant
mvp/src/services/agents/meeting-brain/
    meeting-brain.agent.ts                           → extends BaseConsultant
mvp/src/services/agents/supervisor/
    supervisor.agent.ts                              → extends BaseConsultant
mvp/src/services/agents/memory-optimizer/
    memory-optimizer.agent.ts                        → Extended with outcome analysis tools
mvp/src/services/agents/coding-standards.ts          → Deprecated, content migrated to foundation skills
mvp/prisma/schema.prisma                             → Add LearnedSkill + AgentOutcome models
```

### NOT Modified (preserved)

```
mvp/src/services/agent-runtime/agent-loop.ts   ← AgentConfig unchanged
mvp/src/services/agent-runtime/types.ts        ← Interfaces unchanged
mvp/src/services/agents/*/prompts.ts           ← Existing prompts kept as-is
mvp/src/services/agents/*/tools.ts             ← Tool factories untouched
mvp/src/services/ai/ai-council.ts              ← Council is separate
mvp/src/services/memory/memory.service.ts      ← Memory categories untouched
```

### Agent Class Change (Minimal)

Before:
```typescript
export class BAAgent {
  readonly agentType = 'ba_agent' as const;
  readonly tools: AgentTool[];
  constructor(private modelClient, private prisma, ...) {
    this.tools = createBATools({ prisma, commsRouter, memoryService });
  }
  async processTranscript(...) {
    const loop = new AgentLoop({
      systemPrompt: BA_SYSTEM_PROMPT,
      tools: this.tools, maxSteps: 25, confidenceThreshold: 0.85, model,
    }, this.modelClient);
    return loop.run(task, context);
  }
}
```

After:
```typescript
export class BAAgent extends BaseConsultant {
  readonly agentType = 'ba_agent' as const;
  constructor(modelClient, prisma, commsRouter, memoryService, modelRegistry?) {
    super(modelClient, modelRegistry, {
      agentType: 'ba_agent',
      rolePrompt: BA_SYSTEM_PROMPT,
      roleSkillTargets: ['all', 'ba'],
      tools: createBATools({ prisma, commsRouter, memoryService }),
      maxSteps: 25,
      confidenceThreshold: 0.85,
      defaultModel: { provider: 'google', modelId: 'gemini-2.0-flash-thinking' },
    });
  }
  async processTranscript(...) {
    return this.runLoop(task, context);
  }
}
```

### OutcomeObserver Hook Point

Added at the existing task completion boundary in queue processors:

```typescript
await outcomeObserver.record({
  agentType: result.agentType,
  taskId,
  result: task.status,
  agentOutput: result.output,
  revisionFeedback: task.revisionNotes,
  confidenceScore: result.confidence,
});
```

## Multi-Model Independence

This design is **model-agnostic**. Skills are plain text injected into system prompts — they work identically with Gemini, Claude, GPT, or any future model. No coupling to any provider's API.

The skill system wraps around the existing architecture:
- AgentLoop is unchanged (still takes AgentConfig with a string systemPrompt)
- Model clients are unchanged (still receive the systemPrompt as a string)
- AI Council is unchanged (operates separately from agent skills)

## BaseConsultant: resolveModelConfig Consolidation

Every agent has an identical private `resolveModelConfig()` method with only the default model differing. BaseConsultant consolidates this:

```typescript
abstract class BaseConsultant {
  protected async resolveModelConfig(tenantId: string) {
    if (this.modelRegistry) {
      const resolved = await this.modelRegistry.resolveModel(tenantId, this.agentType);
      if (resolved) return resolved;
    }
    return this.consultantConfig.defaultModel;  // Passed in constructor
  }
}
```

Each subclass specifies its default model in the constructor config (e.g., `google/gemini-2.0-flash-thinking` for BA, `anthropic/claude-sonnet-4` for Dev). No more duplicated resolution logic.

## MemoryOptimizer: Outcome Analysis Extension

The existing MemoryOptimizer agent is extended with new tools for the "deep path" learning:

**New tools added to `createMemoryOptimizerTools()`:**

1. `read_outcome_batch` — Queries the `agent_outcome` table for recent outcomes grouped by agent type and result. Returns clusters of approved vs rejected outputs with metadata (tools used, step count, confidence).

2. `extract_skill_candidate` — Takes an observed pattern (from analyzing outcome clusters) and writes it to the `learned_skill` table as a `candidate` with initial confidence. Input: `{ name, content, target, evidence }`. Output: created skill ID.

3. `update_skill_confidence` — Recalculates confidence for existing candidates based on new outcome data. Promotes to `active` at ≥0.8, demotes at <0.5.

**Execution schedule:** MemoryOptimizer runs via BullMQ scheduled job (daily or after every 50 new outcomes, whichever comes first). The existing `optimizeTenant()` method is kept; a new `analyzeOutcomes()` method handles firm-wide skill learning.

**Output format:** The agent produces a structured JSON response:

```typescript
interface OutcomeAnalysisResult {
  patternsFound: number;
  candidatesCreated: Array<{ name: string; target: string; confidence: number }>;
  candidatesPromoted: string[];  // IDs promoted to active
  candidatesDemoted: string[];   // IDs demoted
}
```

## Skill Versioning

Each foundation skill carries a version string in its export:

```typescript
export const TDD_WORKFLOW: FoundationSkill = {
  name: 'tdd-workflow',
  version: '1.0.0',
  target: 'dev',
  content: `...`,
};
```

`AgentRunResult` is extended with a `skillVersions` field that records which skills (and versions) were injected for that run:

```typescript
interface AgentRunResult {
  // ... existing fields ...
  skillVersions: Array<{ name: string; version: string; scope: 'foundation' | 'learned' }>;
}
```

This enables debugging ("which skill versions were active when this bad output was produced?") and audit trails.

## Cross-Tenant Privacy in Learned Skills

Learned skills are global (no `tenantId`) by design — the firm has one methodology. To prevent tenant-specific knowledge leaking:

1. **Pattern extraction strips specifics.** The MemoryOptimizer prompt instructs: "Extract the general methodology pattern, not the domain-specific content. 'Always include compliance steps' is too specific. 'Always include regulatory/compliance considerations relevant to the client domain' is general."

2. **Content review gate.** Before a candidate is promoted to `active`, its content is validated against a simple heuristic: no company names, no domain jargon, no specific tech stack references. Patterns that fail are flagged for manual review rather than auto-promoted.

## Testing Strategy

### Unit Tests
- `BaseConsultant.buildSystemPrompt()` — verify prompt composition order, token budget enforcement, truncation behavior
- `SkillLoader` — verify correct skills loaded per role, foundation vs learned separation
- `OutcomeObserver.record()` — verify status mapping (AgentTask.status → Outcome.result)
- `OutcomeObserver` confidence calculations — verify promotion/demotion thresholds

### Integration Tests
- Agent with skills produces valid AgentRunResult with skillVersions populated
- Learned skill promotion: create 10+ outcomes → verify candidate reaches active status
- Learned skill demotion: create contradicting outcomes → verify confidence drops below 0.5
- Token budget: inject many skills → verify truncation kicks in and warning is logged

### E2E Tests
- Full cycle: agent runs → outcome recorded → MemoryOptimizer analyzes → skill promoted → next agent run includes the new skill

## Rollback & Kill Switch

**Automatic demotion:** Learned skills that correlate with increased rejections get demoted automatically (confidence < 0.5 → removed from prompts).

**Manual kill switch:** An admin API endpoint to immediately change a learned skill's status:

```
PATCH /admin/learned-skills/:id  { status: 'demoted' }
```

This immediately removes it from all future agent prompts (Redis cache is invalidated on status change).

**Foundation skill rollback:** Since foundation skills are in code, rolling back is a standard code revert + deploy. The version field in AgentRunResult makes it easy to identify which skill version caused issues.

## Key Constraints

1. Foundation skills are immutable at runtime — updated only via code deploys
2. Learned skills never contradict foundation skills — they only add
3. Uniform methodology — all tenants get the same skill set (no per-tenant customization)
4. Prompt budget — total skill injection stays under 1500 tokens (enforced by buildSystemPrompt)
5. Learning requires ≥10 outcomes to promote — no premature optimization
6. MemoryOptimizer deep analysis is batched (daily or per 50 outcomes), not per-task
7. Cross-tenant content sanitization before any skill promotion
8. All agent runs record which skill versions were injected (auditability)
