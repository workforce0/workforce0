/**
 * =============================================================================
 * USAGE SERVICE — Edge Case & Error Handling Tests
 * =============================================================================
 *
 * Tests AI token metering and cost calculation:
 *   - recordUsage creates records with calculated cost
 *   - recordUsage handles unknown model (fallback cost)
 *   - recordUsage silently fails (never throws)
 *   - getMonthlyUsage aggregation
 *   - getMonthlyUsageByAgent grouping
 *   - calculateCost for each known model family
 *   - Edge: zero tokens, very large token counts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageService } from '../../services/usage/usage.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    tenantUsage: {
      create: vi.fn().mockResolvedValue({}),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsageService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: UsageService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new UsageService(prisma as any);
  });

  // =========================================================================
  // recordUsage()
  // =========================================================================
  describe('recordUsage()', () => {
    it('creates a usage record with calculated cost for known model', async () => {
      await service.recordUsage({
        tenantId: 'tenant-1',
        agentType: 'ba_agent',
        model: 'gemini-2.0-flash',
        inputTokens: 1000,
        outputTokens: 500,
        jobId: 'job-1',
      });

      expect(prisma.tenantUsage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          agentType: 'ba_agent',
          model: 'gemini-2.0-flash',
          inputTokens: 1000,
          outputTokens: 500,
          jobId: 'job-1',
          costUSD: expect.any(Number),
        }),
      });

      // gemini-2.0-flash: input=$0.075/1M, output=$0.30/1M
      // cost = (1000 * 0.075 + 500 * 0.30) / 1_000_000 = 0.000225
      const callData = prisma.tenantUsage.create.mock.calls[0][0].data;
      expect(callData.costUSD).toBeCloseTo(0.000225, 8);
    });

    it('uses fallback cost for unknown model', async () => {
      await service.recordUsage({
        tenantId: 'tenant-1',
        agentType: 'ba_agent',
        model: 'llama-4-ultra-unknown',
        inputTokens: 1000,
        outputTokens: 500,
      });

      // DEFAULT_COST: input=$1.0/1M, output=$3.0/1M
      // cost = (1000 * 1.0 + 500 * 3.0) / 1_000_000 = 0.0025
      const callData = prisma.tenantUsage.create.mock.calls[0][0].data;
      expect(callData.costUSD).toBeCloseTo(0.0025, 8);
    });

    it('silently fails and does NOT throw on Prisma error', async () => {
      prisma.tenantUsage.create.mockRejectedValue(
        new Error('Unique constraint violation'),
      );

      // This should NOT throw
      await expect(
        service.recordUsage({
          tenantId: 'tenant-1',
          agentType: 'ba_agent',
          model: 'gemini-2.0-flash',
          inputTokens: 100,
          outputTokens: 50,
        }),
      ).resolves.toBeUndefined();
    });

    it('handles zero tokens correctly (cost should be 0)', async () => {
      await service.recordUsage({
        tenantId: 'tenant-1',
        agentType: 'ba_agent',
        model: 'gpt-4o',
        inputTokens: 0,
        outputTokens: 0,
      });

      const callData = prisma.tenantUsage.create.mock.calls[0][0].data;
      expect(callData.costUSD).toBe(0);
    });

    it('handles very large token counts without overflow', async () => {
      await service.recordUsage({
        tenantId: 'tenant-1',
        agentType: 'dev_agent',
        model: 'claude-opus',
        inputTokens: 1_000_000_000, // 1 billion
        outputTokens: 500_000_000,  // 500 million
      });

      // claude-opus: input=$15.00/1M, output=$75.00/1M
      // cost = (1B * 15 + 500M * 75) / 1M = 15000 + 37500 = 52500
      const callData = prisma.tenantUsage.create.mock.calls[0][0].data;
      expect(callData.costUSD).toBeCloseTo(52500, 0);
      expect(Number.isFinite(callData.costUSD)).toBe(true);
    });

    it('records jobId as undefined when not provided', async () => {
      await service.recordUsage({
        tenantId: 'tenant-1',
        agentType: 'ba_agent',
        model: 'gpt-4o-mini',
        inputTokens: 100,
        outputTokens: 50,
      });

      const callData = prisma.tenantUsage.create.mock.calls[0][0].data;
      expect(callData.jobId).toBeUndefined();
    });
  });

  // =========================================================================
  // calculateCost (via recordUsage) — per-model verification
  // =========================================================================
  describe('calculateCost (per model family)', () => {
    const models: Array<{
      model: string;
      inputRate: number;
      outputRate: number;
    }> = [
      { model: 'gemini-2.0-flash', inputRate: 0.075, outputRate: 0.30 },
      { model: 'gemini-2.5-flash', inputRate: 0.15, outputRate: 0.60 },
      { model: 'gpt-4o-mini', inputRate: 0.15, outputRate: 0.60 },
      { model: 'gpt-4o', inputRate: 2.50, outputRate: 10.00 },
      { model: 'claude-sonnet', inputRate: 3.00, outputRate: 15.00 },
      { model: 'claude-opus', inputRate: 15.00, outputRate: 75.00 },
    ];

    for (const { model, inputRate, outputRate } of models) {
      it(`calculates correct cost for ${model}`, async () => {
        const inputTokens = 10_000;
        const outputTokens = 5_000;

        await service.recordUsage({
          tenantId: 't',
          agentType: 'a',
          model,
          inputTokens,
          outputTokens,
        });

        const expectedCost =
          (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;

        const callData = prisma.tenantUsage.create.mock.calls[0][0].data;
        expect(callData.costUSD).toBeCloseTo(expectedCost, 10);

        // Reset for next iteration
        prisma.tenantUsage.create.mockClear();
      });
    }

    it('matches model name case-insensitively', async () => {
      await service.recordUsage({
        tenantId: 't',
        agentType: 'a',
        model: 'GEMINI-2.0-FLASH',
        inputTokens: 1000,
        outputTokens: 500,
      });

      // Should use gemini-2.0-flash rates, not fallback
      const callData = prisma.tenantUsage.create.mock.calls[0][0].data;
      const expectedCost = (1000 * 0.075 + 500 * 0.30) / 1_000_000;
      expect(callData.costUSD).toBeCloseTo(expectedCost, 10);
    });

    it('matches partial model names (e.g. "gpt-4o" matches "gpt-4o-2024-01")', async () => {
      await service.recordUsage({
        tenantId: 't',
        agentType: 'a',
        model: 'gpt-4o-2024-01-preview',
        inputTokens: 1000,
        outputTokens: 500,
      });

      // Should match "gpt-4o" key since lowerModel.includes('gpt-4o') is true
      // But it also includes 'gpt-4o-mini' — depends on ordering.
      // Since Object.entries iterates in insertion order and 'gpt-4o-mini' comes
      // before 'gpt-4o', and 'gpt-4o-2024-01-preview'.includes('gpt-4o-mini') is false,
      // it should match 'gpt-4o'
      const callData = prisma.tenantUsage.create.mock.calls[0][0].data;
      const expectedCost = (1000 * 2.50 + 500 * 10.00) / 1_000_000;
      expect(callData.costUSD).toBeCloseTo(expectedCost, 10);
    });
  });

  // =========================================================================
  // getMonthlyUsage()
  // =========================================================================
  describe('getMonthlyUsage()', () => {
    it('returns aggregated usage for the current month', async () => {
      prisma.tenantUsage.aggregate.mockResolvedValue({
        _sum: {
          inputTokens: 50000,
          outputTokens: 25000,
          costUSD: 1.50,
        },
      });

      const result = await service.getMonthlyUsage('tenant-1');

      expect(result).toEqual({
        totalCost: 1.50,
        totalInputTokens: 50000,
        totalOutputTokens: 25000,
        totalTokens: 75000,
      });
    });

    it('returns zeros when no usage exists', async () => {
      prisma.tenantUsage.aggregate.mockResolvedValue({
        _sum: {
          inputTokens: null,
          outputTokens: null,
          costUSD: null,
        },
      });

      const result = await service.getMonthlyUsage('new-tenant');

      expect(result).toEqual({
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      });
    });

    it('filters by current month start date', async () => {
      prisma.tenantUsage.aggregate.mockResolvedValue({
        _sum: { inputTokens: null, outputTokens: null, costUSD: null },
      });

      await service.getMonthlyUsage('tenant-1');

      const callArgs = prisma.tenantUsage.aggregate.mock.calls[0][0];
      const monthStart = callArgs.where.createdAt.gte as Date;

      // Should be the first day of the current month
      expect(monthStart.getDate()).toBe(1);
      expect(monthStart.getHours()).toBe(0);
      expect(monthStart.getMinutes()).toBe(0);
    });

    it('scopes to the correct tenantId', async () => {
      prisma.tenantUsage.aggregate.mockResolvedValue({
        _sum: { inputTokens: null, outputTokens: null, costUSD: null },
      });

      await service.getMonthlyUsage('specific-tenant-42');

      expect(prisma.tenantUsage.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'specific-tenant-42',
          }),
        }),
      );
    });
  });

  // =========================================================================
  // getMonthlyUsageByAgent()
  // =========================================================================
  describe('getMonthlyUsageByAgent()', () => {
    it('groups usage by agent type correctly', async () => {
      prisma.tenantUsage.groupBy.mockResolvedValue([
        {
          agentType: 'ba_agent',
          _sum: { inputTokens: 30000, outputTokens: 10000, costUSD: 0.80 },
        },
        {
          agentType: 'dev_agent',
          _sum: { inputTokens: 50000, outputTokens: 20000, costUSD: 1.50 },
        },
      ]);

      const result = await service.getMonthlyUsageByAgent('tenant-1');

      expect(result).toEqual([
        { agentType: 'ba_agent', totalCost: 0.80, totalTokens: 40000 },
        { agentType: 'dev_agent', totalCost: 1.50, totalTokens: 70000 },
      ]);
    });

    it('returns empty array when no usage exists', async () => {
      prisma.tenantUsage.groupBy.mockResolvedValue([]);

      const result = await service.getMonthlyUsageByAgent('new-tenant');

      expect(result).toEqual([]);
    });

    it('handles null sums gracefully (defaults to 0)', async () => {
      prisma.tenantUsage.groupBy.mockResolvedValue([
        {
          agentType: 'qa_agent',
          _sum: { inputTokens: null, outputTokens: null, costUSD: null },
        },
      ]);

      const result = await service.getMonthlyUsageByAgent('tenant-1');

      expect(result).toEqual([
        { agentType: 'qa_agent', totalCost: 0, totalTokens: 0 },
      ]);
    });

    it('filters by current month start date', async () => {
      prisma.tenantUsage.groupBy.mockResolvedValue([]);

      await service.getMonthlyUsageByAgent('tenant-1');

      const callArgs = prisma.tenantUsage.groupBy.mock.calls[0][0];
      const monthStart = callArgs.where.createdAt.gte as Date;

      expect(monthStart.getDate()).toBe(1);
    });
  });

  // =========================================================================
  // getSpendingCap()
  // =========================================================================
  describe('getSpendingCap()', () => {
    it('returns the cap from tenant settings', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        settings: { spendingCap: 100 },
      });

      const cap = await service.getSpendingCap('tenant-1');
      expect(cap).toBe(100);
    });

    it('returns null when no cap is set', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        settings: {},
      });

      const cap = await service.getSpendingCap('tenant-1');
      expect(cap).toBeNull();
    });

    it('returns null when cap is zero', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        settings: { spendingCap: 0 },
      });

      const cap = await service.getSpendingCap('tenant-1');
      expect(cap).toBeNull();
    });

    it('returns null when cap is a non-number', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        settings: { spendingCap: 'unlimited' },
      });

      const cap = await service.getSpendingCap('tenant-1');
      expect(cap).toBeNull();
    });

    it('returns null when tenant not found', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      const cap = await service.getSpendingCap('nonexistent');
      expect(cap).toBeNull();
    });
  });

  // =========================================================================
  // checkBudget()
  // =========================================================================
  describe('checkBudget()', () => {
    it('allows when no cap is set', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ settings: {} });
      prisma.tenantUsage.aggregate.mockResolvedValue({
        _sum: { inputTokens: 50000, outputTokens: 25000, costUSD: 5.00 },
      });

      const result = await service.checkBudget('tenant-1');

      expect(result.allowed).toBe(true);
      expect(result.monthlyCap).toBeNull();
      expect(result.currentSpend).toBe(5.00);
      expect(result.remaining).toBeNull();
    });

    it('allows when under the cap', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ settings: { spendingCap: 100 } });
      prisma.tenantUsage.aggregate.mockResolvedValue({
        _sum: { inputTokens: 50000, outputTokens: 25000, costUSD: 50.00 },
      });

      const result = await service.checkBudget('tenant-1');

      expect(result.allowed).toBe(true);
      expect(result.monthlyCap).toBe(100);
      expect(result.currentSpend).toBe(50.00);
      expect(result.percentUsed).toBe(50);
      expect(result.remaining).toBe(50);
    });

    it('blocks when over the cap', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ settings: { spendingCap: 100 } });
      prisma.tenantUsage.aggregate.mockResolvedValue({
        _sum: { inputTokens: 500000, outputTokens: 250000, costUSD: 120.00 },
      });

      const result = await service.checkBudget('tenant-1');

      expect(result.allowed).toBe(false);
      expect(result.monthlyCap).toBe(100);
      expect(result.currentSpend).toBe(120.00);
      expect(result.percentUsed).toBe(100); // capped at 100
      expect(result.remaining).toBe(0);
    });

    it('blocks when exactly at the cap', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ settings: { spendingCap: 50 } });
      prisma.tenantUsage.aggregate.mockResolvedValue({
        _sum: { inputTokens: 100000, outputTokens: 50000, costUSD: 50.00 },
      });

      const result = await service.checkBudget('tenant-1');

      // currentSpend (50) is NOT less than cap (50) → blocked
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('reports correct percentUsed approaching cap', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ settings: { spendingCap: 200 } });
      prisma.tenantUsage.aggregate.mockResolvedValue({
        _sum: { inputTokens: 100000, outputTokens: 50000, costUSD: 170.00 },
      });

      const result = await service.checkBudget('tenant-1');

      expect(result.allowed).toBe(true);
      expect(result.percentUsed).toBe(85);
      expect(result.remaining).toBe(30);
    });
  });
});
