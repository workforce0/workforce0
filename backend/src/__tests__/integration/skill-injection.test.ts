/**
 * =============================================================================
 * INTEGRATION TEST — Full Skill Injection Cycle
 * =============================================================================
 *
 * Verifies that a real agent (BAAgent extending BaseConsultant) builds a system
 * prompt that includes foundation skills from the SkillLoader, and that skill
 * version metadata is correctly populated.
 *
 * External dependencies (Prisma, Redis) are mocked at a minimal level — no
 * learned skills are returned — so only the built-in foundation skills surface.
 */

import { describe, it, expect, vi } from 'vitest';
import { BAAgent } from '../../services/agents/ba/ba.agent.js';
import { SkillLoader } from '../../services/agents/skills/loader.js';

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

function makeMockPrisma() {
  return {
    learnedSkill: { findMany: vi.fn().mockResolvedValue([]) },
    meeting: { findUnique: vi.fn().mockResolvedValue(null) },
    agentTask: { findUnique: vi.fn().mockResolvedValue(null) },
  };
}

function makeMockRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  };
}

function makeMockModelClient(captureRef?: { systemPrompt: string }) {
  return {
    chat: vi.fn().mockImplementation(async (params: any) => {
      if (captureRef) {
        captureRef.systemPrompt = params.systemPrompt;
      }
      return {
        content: 'Confidence: 0.9\nDone.',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Skill Injection Integration', () => {
  it('BAAgent system prompt includes foundation skills', async () => {
    const mockPrisma = makeMockPrisma();
    const mockRedis = makeMockRedis();
    const skillLoader = new SkillLoader(mockPrisma, mockRedis);

    const agent = new BAAgent(
      makeMockModelClient() as any,
      mockPrisma as any,
      undefined as any,      // commsRouter — not needed for prompt-building
      { getContext: vi.fn().mockResolvedValue([]) } as any, // memoryService
      undefined,             // modelRegistry
      skillLoader,
    );

    const prompt = await agent.buildSystemPrompt();

    // Should include the BA base role prompt (contains "Business Analyst Agent")
    expect(prompt).toContain('Business Analyst Agent');

    // Should include the "## Firm Methodology" section header added by BaseConsultant
    expect(prompt).toContain('## Firm Methodology');

    // ── firm-wide foundation skills (target: 'all') ──────────────────────────
    // from all/security.ts
    expect(prompt).toContain('### Security Standards');
    // from all/coding-standards.ts
    expect(prompt).toContain('### Coding Standards');
    // from all/quality-gates.ts
    expect(prompt).toContain('### Quality Gates');

    // ── BA-specific foundation skills (target: 'ba') ─────────────────────────
    // from ba/api-design.ts
    expect(prompt).toContain('### API Design Standards');
    // from ba/database-migrations.ts
    expect(prompt).toContain('### Database Migration Standards');
    // from ba/prd-patterns.ts
    expect(prompt).toContain('### PRD Structure Patterns');

    // ── Dev and QA skills must NOT appear ────────────────────────────────────
    // from dev/tdd-workflow.ts
    expect(prompt).not.toContain('### TDD Workflow Standards');
    // from qa/e2e-testing.ts — "Page Object Model" is a unique phrase in that skill
    expect(prompt).not.toContain('Page Object Model');
  });

  it('skillVersions are populated with all-target and ba-target foundation skills', async () => {
    const mockPrisma = makeMockPrisma();
    const mockRedis = makeMockRedis();
    const skillLoader = new SkillLoader(mockPrisma, mockRedis);

    const agent = new BAAgent(
      makeMockModelClient() as any,
      mockPrisma as any,
      undefined as any,
      { getContext: vi.fn().mockResolvedValue([]) } as any,
      undefined,
      skillLoader,
    );

    const versions = await agent.getSkillVersions();

    // 3 'all' skills + 3 'ba' skills = 6 foundation skills minimum
    expect(versions.length).toBeGreaterThanOrEqual(6);

    // All returned entries must be foundation-scoped (no learned skills in mocks)
    expect(versions.every(v => v.scope === 'foundation')).toBe(true);

    // 'all' target skills
    expect(versions.some(v => v.name === 'security')).toBe(true);
    expect(versions.some(v => v.name === 'coding-standards')).toBe(true);
    expect(versions.some(v => v.name === 'quality-gates')).toBe(true);

    // 'ba' target skills
    expect(versions.some(v => v.name === 'api-design')).toBe(true);
    expect(versions.some(v => v.name === 'database-migrations')).toBe(true);
    expect(versions.some(v => v.name === 'prd-patterns')).toBe(true);

    // Dev-only skills must NOT appear
    expect(versions.some(v => v.name === 'tdd-workflow')).toBe(false);
    expect(versions.some(v => v.name === 'backend-patterns')).toBe(false);

    // QA-only skills must NOT appear
    expect(versions.some(v => v.name === 'e2e-testing')).toBe(false);

    // Every foundation skill should have version '1.0.0'
    expect(versions.every(v => v.version === '1.0.0')).toBe(true);
  });
});
