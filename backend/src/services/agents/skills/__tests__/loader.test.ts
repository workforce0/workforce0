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
      expect(skills.length).toBeGreaterThanOrEqual(3);
      expect(skills.every(s => s.scope === 'foundation' || s.scope === 'learned')).toBe(true);
    });
  });
});
