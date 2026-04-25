// mvp/src/services/agents/__tests__/base-consultant.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseConsultant } from '../base-consultant.js';
import type { ConsultantConfig } from '../skills/types.js';

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
      defaultModel: { provider: 'google', modelId: 'gemini-3.1-flash' },
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

    // M7.7: skill injection from chief_of_staff's ticket.payload.skills
    describe('M7.7 — active skills (chief of staff) injection', () => {
      const ctx = {
        tenantId: 't1',
        engagementId: 'e1',
        agentType: 'test_agent',
        traceId: 'tr-1',
        memory: {},
        ticketId: 'tkt-1',
      };

      it('does not add the Active Skills section when no libraryService is configured', async () => {
        const consultant = new TestConsultant(mockModelClient, mockModelRegistry, config, mockSkillLoader);
        const prompt = await consultant.buildSystemPrompt(ctx);
        expect(prompt).not.toContain('Active Skills');
      });

      it('does not add the section when context has no ticketId', async () => {
        const lib = { buildSkillPreamble: vi.fn(async () => 'SKILL_PREAMBLE') };
        const prismaStub = { ticket: { findFirst: vi.fn() } };
        const consultant = new TestConsultant(
          mockModelClient,
          mockModelRegistry,
          config,
          mockSkillLoader,
          undefined,
          lib as any,
          prismaStub as any,
        );
        const promptNoCtx = await consultant.buildSystemPrompt();
        expect(promptNoCtx).not.toContain('Active Skills');
        expect(lib.buildSkillPreamble).not.toHaveBeenCalled();
      });

      it('does not add the section when the ticket has no skills in payload', async () => {
        const lib = { buildSkillPreamble: vi.fn(async () => '') };
        const prismaStub = {
          ticket: { findFirst: vi.fn(async () => ({ id: 'tkt-1', payload: { skills: [] } })) },
        };
        const consultant = new TestConsultant(
          mockModelClient,
          mockModelRegistry,
          config,
          mockSkillLoader,
          undefined,
          lib as any,
          prismaStub as any,
        );
        const prompt = await consultant.buildSystemPrompt(ctx);
        expect(prompt).not.toContain('Active Skills');
      });

      it('prepends the library preamble when the ticket carries skill slugs', async () => {
        const lib = {
          buildSkillPreamble: vi.fn(async (_t: string, slugs: string[]) =>
            `<skills>${slugs.join(',')}</skills>`,
          ),
        };
        const prismaStub = {
          ticket: {
            findFirst: vi.fn(async () => ({
              id: 'tkt-1',
              payload: { skills: ['pr-review', 'api-designer'] },
            })),
          },
        };
        const consultant = new TestConsultant(
          mockModelClient,
          mockModelRegistry,
          config,
          mockSkillLoader,
          undefined,
          lib as any,
          prismaStub as any,
        );
        const prompt = await consultant.buildSystemPrompt(ctx);
        expect(prompt).toContain('## Active Skills (chief of staff)');
        expect(prompt).toContain('<skills>pr-review,api-designer</skills>');
        expect(lib.buildSkillPreamble).toHaveBeenCalledWith('t1', ['pr-review', 'api-designer']);
      });

      it('is non-fatal when the ticket lookup throws (degrades gracefully)', async () => {
        const lib = { buildSkillPreamble: vi.fn() };
        const prismaStub = {
          ticket: { findFirst: vi.fn(async () => { throw new Error('db down'); }) },
        };
        const consultant = new TestConsultant(
          mockModelClient,
          mockModelRegistry,
          config,
          mockSkillLoader,
          undefined,
          lib as any,
          prismaStub as any,
        );
        const prompt = await consultant.buildSystemPrompt(ctx);
        // Should still return a valid prompt (no skills section, no throw).
        expect(prompt).toContain('You are a test agent.');
        expect(prompt).not.toContain('Active Skills');
      });
    });
  });

  describe('resolveModelConfig', () => {
    it('uses model registry when available', async () => {
      mockModelRegistry.resolveModel.mockResolvedValue({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
      const consultant = new TestConsultant(mockModelClient, mockModelRegistry, config, mockSkillLoader);
      const model = await consultant.resolveModelConfig('tenant-1');
      expect(model).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
    });

    it('falls back to default model', async () => {
      const consultant = new TestConsultant(mockModelClient, mockModelRegistry, config, mockSkillLoader);
      const model = await consultant.resolveModelConfig('tenant-1');
      expect(model).toEqual({ provider: 'google', modelId: 'gemini-3.1-flash' });
    });

    it('falls back to default when resolveModel throws', async () => {
      mockModelRegistry.resolveModel.mockRejectedValue(new Error('Unknown agent type'));
      const consultant = new TestConsultant(mockModelClient, mockModelRegistry, config, mockSkillLoader);
      const model = await consultant.resolveModelConfig('tenant-1');
      expect(model).toEqual({ provider: 'google', modelId: 'gemini-3.1-flash' });
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
