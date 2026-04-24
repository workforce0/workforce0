/**
 * =============================================================================
 * USAGE SERVICE — AI Token & Cost Metering
 * =============================================================================
 *
 * Tracks per-tenant AI token consumption and estimated cost.
 * Every AI call (Gemini, OpenAI, Anthropic) should call `recordUsage()` so
 * we can meter spend and enforce budget limits.
 *
 * Budget enforcement: `checkBudget()` reads the tenant's spending cap from
 * the `settings.spendingCap` JSON field and compares it against monthly usage.
 *
 * Cost table is approximate — updated manually when provider pricing changes.
 *
 * @module services/usage
 */

import { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';

/** Approximate cost per 1M tokens by model family. */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gemini-2.0-flash': { input: 0.075, output: 0.30 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'claude-sonnet': { input: 3.00, output: 15.00 },
  'claude-opus': { input: 15.00, output: 75.00 },
};

/** Fallback tier when model name doesn't match any known entry. */
const DEFAULT_COST = { input: 1.0, output: 3.0 };

export interface RecordUsageInput {
  tenantId: string;
  agentType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  jobId?: string;
}

export interface MonthlyUsageSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  currentSpend: number;
  monthlyCap: number | null;
  percentUsed: number;
  remaining: number | null;
}

export class UsageService {
  private readonly logger = createChildLogger({ service: 'UsageService' });

  constructor(private prisma: PrismaClient) {}

  /**
   * Record a single AI invocation's token usage and estimated cost.
   * Designed to be fire-and-forget — callers should not block on this.
   */
  async recordUsage(data: RecordUsageInput): Promise<void> {
    const costUSD = this.calculateCost(data.model, data.inputTokens, data.outputTokens);

    try {
      await this.prisma.tenantUsage.create({
        data: {
          tenantId: data.tenantId,
          agentType: data.agentType,
          model: data.model,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          costUSD,
          jobId: data.jobId,
        },
      });

      this.logger.debug('Usage recorded', {
        tenantId: data.tenantId,
        model: data.model,
        tokens: data.inputTokens + data.outputTokens,
        costUSD: costUSD.toFixed(6),
      });
    } catch (error) {
      // Never let metering failures break the main flow
      this.logger.error('Failed to record usage', {
        error: (error as Error).message,
        tenantId: data.tenantId,
      });
    }
  }

  /**
   * Tokens this tenant has burned for a given agent role in the current
   * calendar month. Used by M3's per-role monthly budget gate. The filter
   * keys on `agentType` in `tenant_usage`, which we already record on
   * every `recordUsage()` call.
   */
  async getMonthlyTokensForAgent(tenantId: string, agentType: string): Promise<number> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const result = await this.prisma.tenantUsage.aggregate({
      where: {
        tenantId,
        agentType,
        createdAt: { gte: monthStart },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
      },
    });
    const input = result._sum.inputTokens ?? 0;
    const output = result._sum.outputTokens ?? 0;
    return input + output;
  }

  /**
   * M3: check whether a role has blown its monthly token cap. Reads the
   * cap from `agent_roles` (tenant override beats global built-in) and
   * compares against this month's usage for that role's agentType slug.
   *
   * Fail-safe: when no cap is set, or the role row is missing, returns
   * `{ over: false, cap: null }`. Callers should gate ONLY on
   * `result.over === true` so an unconfigured role never blocks work.
   */
  async isOverRoleMonthlyBudget(
    tenantId: string,
    roleSlug: string,
  ): Promise<{ over: boolean; used: number; cap: number | null }> {
    // Read role with tenant-override precedence — tenant row (non-null)
    // wins over global (null) thanks to `ORDER BY tenantId DESC NULLS LAST`
    // (Postgres default for DESC).
    const role = (await (this.prisma as any).agentRole.findFirst({
      where: {
        slug: roleSlug,
        isActive: true,
        OR: [{ tenantId }, { tenantId: null }],
      },
      orderBy: { tenantId: 'desc' },
      select: { monthlyBudgetTokens: true },
    })) as { monthlyBudgetTokens: number | null } | null;

    const cap = role?.monthlyBudgetTokens ?? null;
    if (cap == null || cap <= 0) return { over: false, used: 0, cap: null };

    const used = await this.getMonthlyTokensForAgent(tenantId, roleSlug);
    return { over: used >= cap, used, cap };
  }

  /**
   * Total tokens (input+output) this tenant has burned since midnight UTC
   * today. Used by the conversation orchestrator's budget kill-switch
   * and by cheap dashboards. Independent of cost — the cap is expressed
   * in tokens, not dollars, so BYOK deployments without a pricing table
   * can still rate-limit themselves.
   */
  async getDailyTokens(tenantId: string): Promise<number> {
    const now = new Date();
    // Midnight UTC boundary keeps tenants aligned across time zones —
    // callers who want "local day" can override the query.
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const result = await this.prisma.tenantUsage.aggregate({
      where: {
        tenantId,
        createdAt: { gte: dayStart },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
      },
    });

    const input = result._sum.inputTokens ?? 0;
    const output = result._sum.outputTokens ?? 0;
    return input + output;
  }

  /**
   * Read the tenant's daily token cap from settings JSON. Returns null
   * when unset. A value of 0 or negative is treated as "no cap" so
   * operators can't accidentally lock themselves out by typoing `0`.
   */
  async getDailyTokenBudget(tenantId: string): Promise<number | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings as Record<string, unknown>) || {};
    const cap = settings.dailyTokenBudget;
    if (typeof cap === 'number' && cap > 0) return cap;
    return null;
  }

  /**
   * True if this tenant has already burned through its daily token
   * budget. Safe for hot paths — a single aggregate + a single findUnique.
   * Falls safe (returns false) when no cap is set.
   */
  async isOverDailyTokenBudget(tenantId: string): Promise<boolean> {
    const cap = await this.getDailyTokenBudget(tenantId);
    if (cap === null) return false;
    const used = await this.getDailyTokens(tenantId);
    if (used >= cap) {
      this.logger.warn('Daily token budget exceeded', { tenantId, used, cap });
      return true;
    }
    return false;
  }

  /**
   * Get aggregated usage for the current calendar month.
   */
  async getMonthlyUsage(tenantId: string): Promise<MonthlyUsageSummary> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const result = await this.prisma.tenantUsage.aggregate({
      where: {
        tenantId,
        createdAt: { gte: monthStart },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        costUSD: true,
      },
    });

    const totalInputTokens = result._sum.inputTokens ?? 0;
    const totalOutputTokens = result._sum.outputTokens ?? 0;

    return {
      totalCost: result._sum.costUSD ?? 0,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    };
  }

  /**
   * Get usage breakdown by agent type for a tenant in the current month.
   */
  async getMonthlyUsageByAgent(tenantId: string): Promise<
    Array<{ agentType: string; totalCost: number; totalTokens: number }>
  > {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const results = await this.prisma.tenantUsage.groupBy({
      by: ['agentType'],
      where: {
        tenantId,
        createdAt: { gte: monthStart },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        costUSD: true,
      },
    });

    return results.map((r) => ({
      agentType: r.agentType,
      totalCost: r._sum.costUSD ?? 0,
      totalTokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0),
    }));
  }

  /**
   * Check whether a tenant is within their spending cap.
   * Returns allowed=true if no cap is set or spend is under the cap.
   */
  async checkBudget(tenantId: string): Promise<BudgetCheckResult> {
    const cap = await this.getSpendingCap(tenantId);
    const usage = await this.getMonthlyUsage(tenantId);

    if (cap === null || cap <= 0) {
      return {
        allowed: true,
        currentSpend: usage.totalCost,
        monthlyCap: null,
        percentUsed: 0,
        remaining: null,
      };
    }

    const percentUsed = Math.min((usage.totalCost / cap) * 100, 100);
    const remaining = Math.max(cap - usage.totalCost, 0);
    const allowed = usage.totalCost < cap;

    if (!allowed) {
      this.logger.warn('Spending cap exceeded', {
        tenantId,
        currentSpend: usage.totalCost.toFixed(2),
        monthlyCap: cap,
      });
    } else if (percentUsed >= 80) {
      this.logger.info('Approaching spending cap', {
        tenantId,
        percentUsed: percentUsed.toFixed(1),
        remaining: remaining.toFixed(2),
      });
    }

    return { allowed, currentSpend: usage.totalCost, monthlyCap: cap, percentUsed, remaining };
  }

  /**
   * Read the tenant's monthly spending cap from settings JSON.
   * Returns null if no cap is configured.
   */
  async getSpendingCap(tenantId: string): Promise<number | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    const settings = (tenant?.settings as Record<string, any>) || {};
    const cap = settings.spendingCap;

    if (typeof cap === 'number' && cap > 0) return cap;
    return null;
  }

  /**
   * Calculate estimated USD cost based on model name and token counts.
   */
  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const lowerModel = model.toLowerCase();
    // Sort keys longest-first so "gpt-4o-mini" matches before "gpt-4o"
    const sortedEntries = Object.entries(MODEL_COSTS).sort((a, b) => b[0].length - a[0].length);
    const tier =
      sortedEntries.find(([key]) => lowerModel.includes(key))?.[1] ??
      DEFAULT_COST;

    return (inputTokens * tier.input + outputTokens * tier.output) / 1_000_000;
  }
}
