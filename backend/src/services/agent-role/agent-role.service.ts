/**
 * =============================================================================
 * AGENT ROLE SERVICE
 * =============================================================================
 *
 * Thin layer over the `agent_roles` table. Three responsibilities:
 *
 *   1. **Idempotent built-in seeding** — `seedBuiltins()` runs on every
 *      backend boot and upserts the 6 built-in roles. Running it twice
 *      is a no-op (safe for dev auto-reloads).
 *   2. **Resolver** — `resolve(tenantId, slug)` returns the tenant's
 *      override if present, otherwise the global built-in. This is the
 *      one method every consumer (orchestrator, processors, UI) should
 *      call — nobody should query `agent_roles` directly.
 *   3. **Listing** — `listForTenant(tenantId)` returns the effective
 *      merged view for a given tenant (overrides shadowing globals).
 *
 * @module services/agent-role
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';
import { BUILTIN_ROLES, type BuiltinRoleSlug } from './agent-role.types.js';

const logger = createChildLogger({ service: 'AgentRoleService' });

export interface AgentRoleDTO {
  id: string;
  tenantId: string | null;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  systemPromptTemplate: string | null;
  allowedTools: string[];
  defaultModelConfigId: string | null;
  monthlyBudgetTokens: number | null;
  defaultConcurrency: number;
  /** N5: org-chart parent (by slug). Null for top-level roles. */
  parentRoleSlug: string | null;
  isBuiltin: boolean;
  isActive: boolean;
  /** True when this row is a tenant override shadowing a global built-in. */
  isOverride: boolean;
}

/** Prisma-row → DTO (unchecked-cast the JSON field). */
function toDTO(row: any, isOverride = false): AgentRoleDTO {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    category: row.category,
    systemPromptTemplate: row.systemPromptTemplate,
    allowedTools: Array.isArray(row.allowedTools) ? (row.allowedTools as string[]) : [],
    defaultModelConfigId: row.defaultModelConfigId,
    monthlyBudgetTokens: row.monthlyBudgetTokens,
    defaultConcurrency: row.defaultConcurrency,
    parentRoleSlug: row.parentRoleSlug ?? null,
    isBuiltin: row.isBuiltin,
    isActive: row.isActive,
    isOverride,
  };
}

export class AgentRoleService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Idempotently insert the 6 built-in roles (tenantId=NULL). Safe to
   * call on every boot — missing rows get created, existing rows are
   * left alone so user overrides on budgets/prompts stick.
   */
  async seedBuiltins(): Promise<{ inserted: number; existing: number }> {
    let inserted = 0;
    let existing = 0;

    for (const role of BUILTIN_ROLES) {
      // Use `findFirst` rather than `findUnique` because the unique key
      // is `(tenantId, slug)` and Prisma's findUnique requires non-null
      // on every part of a composite unique — tenantId=NULL blocks it.
      const found = await (this.prisma as any).agentRole.findFirst({
        where: { tenantId: null, slug: role.slug },
        select: { id: true },
      });

      if (found) {
        existing++;
        continue;
      }

      await (this.prisma as any).agentRole.create({
        data: {
          tenantId: null,
          slug: role.slug,
          displayName: role.displayName,
          description: role.description,
          category: role.category,
          systemPromptTemplate: role.systemPromptTemplate,
          allowedTools: role.allowedTools,
          defaultConcurrency: role.defaultConcurrency,
          monthlyBudgetTokens: role.monthlyBudgetTokens,
          parentRoleSlug: role.parentRoleSlug,
          isBuiltin: true,
          isActive: true,
        },
      });
      inserted++;
    }

    logger.info('Built-in agent roles seeded', { inserted, existing, total: BUILTIN_ROLES.length });
    return { inserted, existing };
  }

  /**
   * Resolve a role for a given tenant + slug. Returns the tenant-scoped
   * override when present, else the global built-in, else null.
   *
   * Single query: fetch both candidates and pick the override first.
   */
  async resolve(tenantId: string, slug: BuiltinRoleSlug | string): Promise<AgentRoleDTO | null> {
    const rows = (await (this.prisma as any).agentRole.findMany({
      where: {
        slug,
        isActive: true,
        OR: [{ tenantId }, { tenantId: null }],
      },
    })) as any[];

    const override = rows.find((r) => r.tenantId === tenantId);
    if (override) return toDTO(override, true);

    const builtin = rows.find((r) => r.tenantId === null);
    return builtin ? toDTO(builtin, false) : null;
  }

  /**
   * Return the effective role list for a tenant: every active global
   * built-in, with tenant overrides replacing the matching built-in.
   * Result is deduped by slug — override wins regardless of row order.
   */
  async listForTenant(tenantId: string): Promise<AgentRoleDTO[]> {
    const rows = (await (this.prisma as any).agentRole.findMany({
      where: {
        isActive: true,
        OR: [{ tenantId }, { tenantId: null }],
      },
    })) as any[];

    // Deterministic dedupe: always prefer the override row, never rely
    // on a database order. Two passes — overrides first to claim the
    // slug, then globals fill the rest.
    const bySlug = new Map<string, AgentRoleDTO>();
    for (const row of rows) {
      if (row.tenantId === tenantId) bySlug.set(row.slug, toDTO(row, true));
    }
    for (const row of rows) {
      if (row.tenantId === null && !bySlug.has(row.slug)) {
        bySlug.set(row.slug, toDTO(row, false));
      }
    }
    return [...bySlug.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /** Upsert a tenant-scoped override. Used by the UI. */
  async upsertOverride(input: {
    tenantId: string;
    slug: string;
    displayName?: string;
    description?: string;
    systemPromptTemplate?: string | null;
    allowedTools?: string[];
    monthlyBudgetTokens?: number | null;
    defaultConcurrency?: number;
    /** N5: org-chart parent slug (null for top-level). `undefined` leaves it unchanged. */
    parentRoleSlug?: string | null;
    isActive?: boolean;
    /** M6: attach a note to the version snapshot so admins can scan the log. */
    changeNote?: string;
    changedBy?: string;
  }): Promise<AgentRoleDTO> {
    const existing = await (this.prisma as any).agentRole.findFirst({
      where: { tenantId: input.tenantId, slug: input.slug },
    });

    let result: any;
    if (existing) {
      result = await (this.prisma as any).agentRole.update({
        where: { id: existing.id },
        data: {
          displayName: input.displayName ?? existing.displayName,
          description: input.description ?? existing.description,
          systemPromptTemplate: input.systemPromptTemplate === undefined
            ? existing.systemPromptTemplate
            : input.systemPromptTemplate,
          allowedTools: input.allowedTools ?? existing.allowedTools,
          monthlyBudgetTokens: input.monthlyBudgetTokens === undefined
            ? existing.monthlyBudgetTokens
            : input.monthlyBudgetTokens,
          defaultConcurrency: input.defaultConcurrency ?? existing.defaultConcurrency,
          parentRoleSlug: input.parentRoleSlug === undefined
            ? existing.parentRoleSlug
            : input.parentRoleSlug,
          isActive: input.isActive ?? existing.isActive,
        },
      });
    } else {
      // Creating a tenant override — pull display/desc defaults from the
      // matching built-in if the caller omitted them.
      const builtin = BUILTIN_ROLES.find((r) => r.slug === input.slug);
      result = await (this.prisma as any).agentRole.create({
        data: {
          tenantId: input.tenantId,
          slug: input.slug,
          displayName: input.displayName ?? builtin?.displayName ?? input.slug,
          description: input.description ?? builtin?.description ?? '',
          category: builtin?.category ?? 'consultant',
          systemPromptTemplate: input.systemPromptTemplate ?? builtin?.systemPromptTemplate ?? null,
          allowedTools: input.allowedTools ?? builtin?.allowedTools ?? [],
          monthlyBudgetTokens: input.monthlyBudgetTokens ?? builtin?.monthlyBudgetTokens ?? null,
          defaultConcurrency: input.defaultConcurrency ?? builtin?.defaultConcurrency ?? 2,
          parentRoleSlug: input.parentRoleSlug ?? null,
          isBuiltin: false,
          isActive: input.isActive ?? true,
        },
      });
    }

    // M6: snapshot every mutation. Doing it after the write means the
    // snapshot reflects the committed state. Best-effort — a failed
    // snapshot insert should not roll back the user's config change.
    try {
      await this.recordVersion(input.tenantId, input.slug, result, input.changeNote, input.changedBy);
    } catch (err) {
      logger.warn('Failed to record AgentRoleVersion snapshot', { slug: input.slug, error: (err as Error).message });
    }

    return toDTO(result, true);
  }

  /**
   * M6: list version history for a role, newest-first. Includes both
   * the tenant override history and any global-builtin changes (latter
   * rarely mutate; snapshots get written on override creation, not on
   * resolve).
   */
  async listVersions(tenantId: string, slug: string): Promise<Array<{
    id: string;
    version: number;
    snapshot: Record<string, unknown>;
    note: string | null;
    createdBy: string | null;
    createdAt: Date;
  }>> {
    const rows = (await (this.prisma as any).agentRoleVersion.findMany({
      where: { tenantId, slug },
      orderBy: { version: 'desc' },
      take: 50,
    })) as any[];
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      snapshot: r.snapshot as Record<string, unknown>,
      note: r.note ?? null,
      createdBy: r.createdBy ?? null,
      createdAt: r.createdAt,
    }));
  }

  /**
   * M6: restore a prior snapshot. Applies the snapshot fields to the
   * current role row (upsert-style), and writes a new version snapshot
   * marking the rollback so the history stays append-only.
   *
   * Rollback is NEVER destructive — the new snapshot means you can
   * always undo the rollback itself.
   */
  async rollback(
    tenantId: string,
    slug: string,
    versionId: string,
    opts: { changedBy?: string; note?: string } = {},
  ): Promise<AgentRoleDTO | null> {
    const version = await (this.prisma as any).agentRoleVersion.findFirst({
      where: { id: versionId, tenantId, slug },
    });
    if (!version) return null;

    const snap = version.snapshot as Record<string, any>;
    const restored = await this.upsertOverride({
      tenantId,
      slug,
      displayName: snap.displayName,
      description: snap.description,
      systemPromptTemplate: snap.systemPromptTemplate,
      allowedTools: snap.allowedTools,
      monthlyBudgetTokens: snap.monthlyBudgetTokens,
      defaultConcurrency: snap.defaultConcurrency,
      isActive: snap.isActive,
      changedBy: opts.changedBy,
      changeNote: opts.note ?? `Rolled back to version ${version.version}`,
    });
    logger.info('AgentRole rolled back', { tenantId, slug, versionId, toVersion: version.version });
    return restored;
  }

  private async recordVersion(
    tenantId: string | null,
    slug: string,
    snapshot: Record<string, unknown>,
    note: string | undefined,
    createdBy: string | undefined,
  ): Promise<void> {
    // Next version number per (tenantId, slug). Race-safe enough at this
    // cadence — role edits are not high-throughput.
    const last = await (this.prisma as any).agentRoleVersion.findFirst({
      where: { tenantId, slug },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const next = (last?.version ?? 0) + 1;
    await (this.prisma as any).agentRoleVersion.create({
      data: {
        tenantId,
        slug,
        version: next,
        snapshot,
        note: note ?? null,
        createdBy: createdBy ?? null,
      },
    });
  }
}
