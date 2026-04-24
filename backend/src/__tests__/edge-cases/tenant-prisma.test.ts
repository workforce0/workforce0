/**
 * =============================================================================
 * TENANT-SCOPED PRISMA — Edge Case & Error Handling Tests
 * =============================================================================
 *
 * Tests the createTenantScopedPrisma function:
 *   - Rejects empty/non-string tenantId
 *   - Exports correct TENANT_SCOPED_MODELS list
 *   - Validates that the extension mechanism is set up correctly
 */

import { describe, it, expect } from 'vitest';
import {
  createTenantScopedPrisma,
  TENANT_SCOPED_MODELS,
} from '../../lib/tenant-prisma.js';

describe('tenant-prisma', () => {
  // =========================================================================
  // createTenantScopedPrisma() — input validation
  // =========================================================================
  describe('createTenantScopedPrisma() input validation', () => {
    it('throws when tenantId is empty string', () => {
      expect(() =>
        createTenantScopedPrisma({} as any, ''),
      ).toThrow('createTenantScopedPrisma requires a non-empty tenantId string');
    });

    it('throws when tenantId is undefined', () => {
      expect(() =>
        createTenantScopedPrisma({} as any, undefined as any),
      ).toThrow('createTenantScopedPrisma requires a non-empty tenantId string');
    });

    it('throws when tenantId is null', () => {
      expect(() =>
        createTenantScopedPrisma({} as any, null as any),
      ).toThrow('createTenantScopedPrisma requires a non-empty tenantId string');
    });

    it('throws when tenantId is a number', () => {
      expect(() =>
        createTenantScopedPrisma({} as any, 123 as any),
      ).toThrow('createTenantScopedPrisma requires a non-empty tenantId string');
    });
  });

  // =========================================================================
  // TENANT_SCOPED_MODELS
  // =========================================================================
  describe('TENANT_SCOPED_MODELS', () => {
    it('contains the expected tenant-scoped model names', () => {
      expect(TENANT_SCOPED_MODELS).toContain('engagement');
      expect(TENANT_SCOPED_MODELS).toContain('meeting');
      expect(TENANT_SCOPED_MODELS).toContain('pRD');
      expect(TENANT_SCOPED_MODELS).toContain('agentTask');
      expect(TENANT_SCOPED_MODELS).toContain('agentConfig');
      expect(TENANT_SCOPED_MODELS).toContain('teamMember');
      expect(TENANT_SCOPED_MODELS).toContain('notification');
    });

    it('does NOT contain system-level models', () => {
      const models = TENANT_SCOPED_MODELS as readonly string[];
      expect(models).not.toContain('tenant');
      expect(models).not.toContain('user');
      expect(models).not.toContain('invitation');
      expect(models).not.toContain('transcript');
    });

    it('is a non-empty array', () => {
      expect(TENANT_SCOPED_MODELS.length).toBeGreaterThan(0);
    });
  });
});
