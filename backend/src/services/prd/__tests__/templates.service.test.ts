import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_TEMPLATES, seedDefaultTemplates, getTemplatesForTenant } from '../templates.service.js';

describe('PRD Templates Service', () => {
  describe('DEFAULT_TEMPLATES', () => {
    it('has 6 default templates', () => {
      expect(DEFAULT_TEMPLATES).toHaveLength(6);
    });

    it('includes Feature Request as default', () => {
      const fr = DEFAULT_TEMPLATES.find(t => t.name === 'Feature Request');
      expect(fr).toBeDefined();
      expect(fr!.isDefault).toBe(true);
      expect(fr!.sections.length).toBeGreaterThan(0);
    });

    it('includes Bug Report template', () => {
      const br = DEFAULT_TEMPLATES.find(t => t.name === 'Bug Report');
      expect(br).toBeDefined();
      expect(br!.sections.some(s => s.name === 'reproductionSteps')).toBe(true);
    });

    it('includes Technical Debt template', () => {
      const td = DEFAULT_TEMPLATES.find(t => t.name === 'Technical Debt');
      expect(td).toBeDefined();
    });

    it('includes Process Change template', () => {
      const pc = DEFAULT_TEMPLATES.find(t => t.name === 'Process Change');
      expect(pc).toBeDefined();
    });

    it('includes Continuous Improvement template', () => {
      const ci = DEFAULT_TEMPLATES.find(t => t.name === 'Continuous Improvement');
      expect(ci).toBeDefined();
      expect((ci as any).industry).toBe('manufacturing');
      expect(ci!.sections.some(s => s.name === 'rootCauseAnalysis')).toBe(true);
      expect(ci!.sections.some(s => s.name === 'verificationMethod')).toBe(true);
    });

    it('includes Safety Incident Report template', () => {
      const sir = DEFAULT_TEMPLATES.find(t => t.name === 'Safety Incident Report');
      expect(sir).toBeDefined();
      expect((sir as any).industry).toBe('manufacturing');
      expect(sir!.sections.some(s => s.name === 'incidentDescription')).toBe(true);
      expect(sir!.sections.some(s => s.name === 'severity')).toBe(true);
    });

    it('all templates have required sections', () => {
      for (const template of DEFAULT_TEMPLATES) {
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.sections.length).toBeGreaterThan(0);
        for (const section of template.sections) {
          expect(section.name).toBeTruthy();
          expect(section.label).toBeTruthy();
          expect(typeof section.required).toBe('boolean');
        }
      }
    });
  });

  describe('seedDefaultTemplates', () => {
    it('creates templates when they do not exist', async () => {
      const prisma = {
        pRDTemplate: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
      };

      await seedDefaultTemplates(prisma);
      expect(prisma.pRDTemplate.create).toHaveBeenCalledTimes(6);
    });

    it('skips existing templates', async () => {
      const prisma = {
        pRDTemplate: {
          findFirst: vi.fn().mockResolvedValue({ id: 'existing' }),
          create: vi.fn(),
        },
      };

      await seedDefaultTemplates(prisma);
      expect(prisma.pRDTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe('getTemplatesForTenant', () => {
    it('queries system and tenant templates', async () => {
      const prisma = {
        pRDTemplate: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };

      await getTemplatesForTenant(prisma, 'tenant-1');
      expect(prisma.pRDTemplate.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: null }, { tenantId: 'tenant-1' }],
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
    });
  });
});
