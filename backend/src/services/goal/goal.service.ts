/**
 * =============================================================================
 * GOAL SERVICE — M2: goal ancestry
 * =============================================================================
 *
 * Every piece of agent work should know WHY it's happening. This service
 * owns the Goal table and exposes:
 *
 *   - CRUD for user-facing goal management (create, list, get, update)
 *   - `resolveForTask(tenantId, taskId)` — walks task → engagement to
 *     find the effective goal, even when task.goalId is null
 *   - `ensureForEngagement(tenantId, engagement)` — auto-creates a goal
 *     from meeting.title when an engagement lands without one. Idempotent
 *   - `renderContextBlock(goal)` — formats a goal for inclusion in agent
 *     prompts. Consumers prepend this above their transcript/PRD/etc.
 *
 * Hierarchy is supported via `parentGoalId` but not enforced — consumers
 * can build a flat list or a tree as needed. `listAncestors()` walks up
 * the tree when a prompt wants the full "company goal → project goal"
 * lineage.
 *
 * @module services/goal
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'GoalService' });

export interface GoalDTO {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  outcome: string;
  parentGoalId: string | null;
  status: string;
  targetDate: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(row: any): GoalDTO {
  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    description: row.description,
    outcome: row.outcome,
    parentGoalId: row.parentGoalId ?? null,
    status: row.status,
    targetDate: row.targetDate ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateGoalInput {
  tenantId: string;
  title: string;
  description?: string;
  outcome?: string;
  parentGoalId?: string | null;
  targetDate?: Date | null;
  createdBy?: string;
}

export class GoalService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateGoalInput): Promise<GoalDTO> {
    const row = await (this.prisma as any).goal.create({
      data: {
        tenantId: input.tenantId,
        title: input.title,
        description: input.description ?? '',
        outcome: input.outcome ?? '',
        parentGoalId: input.parentGoalId ?? null,
        targetDate: input.targetDate ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
    logger.info('Goal created', { tenantId: input.tenantId, goalId: row.id, title: input.title });
    return toDTO(row);
  }

  async findById(tenantId: string, goalId: string): Promise<GoalDTO | null> {
    const row = await (this.prisma as any).goal.findFirst({
      where: { id: goalId, tenantId },
    });
    return row ? toDTO(row) : null;
  }

  async listForTenant(
    tenantId: string,
    opts: { status?: string; projectId?: string | null } = {},
  ): Promise<GoalDTO[]> {
    const rows = (await (this.prisma as any).goal.findMany({
      where: {
        tenantId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })) as any[];
    return rows.map(toDTO);
  }

  async update(
    tenantId: string,
    goalId: string,
    patch: Partial<Omit<GoalDTO, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<GoalDTO | null> {
    const existing = await this.findById(tenantId, goalId);
    if (!existing) return null;
    const row = await (this.prisma as any).goal.update({
      where: { id: goalId },
      data: patch,
    });
    return toDTO(row);
  }

  /**
   * Walk up the parent chain. Returns [root, ..., self] so prompt builders
   * can render "Company goal → Project goal → This ticket" top-down.
   * Cycle-safe via an id set; terminates after 10 hops either way.
   */
  async listAncestors(tenantId: string, goalId: string): Promise<GoalDTO[]> {
    const seen = new Set<string>();
    const chain: GoalDTO[] = [];
    let current: GoalDTO | null = await this.findById(tenantId, goalId);
    while (current && !seen.has(current.id) && chain.length < 10) {
      seen.add(current.id);
      chain.push(current);
      if (!current.parentGoalId) break;
      current = await this.findById(tenantId, current.parentGoalId);
    }
    return chain.reverse();
  }

  /**
   * Auto-create a goal from an engagement's metadata when none is set.
   * Called on meeting ingestion so every engagement has a seed "why".
   * Idempotent: if goalId is already set, returns the existing row.
   */
  async ensureForEngagement(
    tenantId: string,
    engagement: { id: string; goalId: string | null; title: string | null; meetingId: string | null },
  ): Promise<GoalDTO | null> {
    if (engagement.goalId) return this.findById(tenantId, engagement.goalId);

    const title = (engagement.title || 'Untitled meeting').slice(0, 200);
    const goal = await this.create({
      tenantId,
      title,
      description: `Auto-created from engagement ${engagement.id}. Edit in the Goals UI to refine the outcome statement agents use when working on this.`,
      outcome: `Deliver on what was discussed in "${title}".`,
    });

    await (this.prisma as any).engagement.update({
      where: { id: engagement.id },
      data: { goalId: goal.id },
    });

    logger.info('Auto-created goal for engagement', {
      tenantId,
      engagementId: engagement.id,
      goalId: goal.id,
    });
    return goal;
  }

  /**
   * Resolve the effective goal for a task. Tries task.goalId first,
   * then walks to the task's engagement via meetingId → engagement.goalId.
   * Returns null when nothing is wired yet (prompts fall back silently).
   */
  async resolveForTask(
    tenantId: string,
    task: { id: string; goalId?: string | null; meetingId?: string | null },
  ): Promise<GoalDTO | null> {
    if (task.goalId) return this.findById(tenantId, task.goalId);
    if (!task.meetingId) return null;
    const engagement = await (this.prisma as any).engagement.findFirst({
      where: { tenantId, meetingId: task.meetingId },
      select: { goalId: true },
    });
    if (!engagement?.goalId) return null;
    return this.findById(tenantId, engagement.goalId);
  }

  /**
   * Render a goal (or a chain) as a text block agents can paste verbatim
   * into their system prompts. Deliberately short — the point is to
   * inject a single sentence of "why" without bloating context.
   */
  static renderContextBlock(goals: GoalDTO | GoalDTO[]): string {
    const chain = Array.isArray(goals) ? goals : [goals];
    if (chain.length === 0) return '';
    const rendered = chain
      .map((g, i) => {
        const indent = '  '.repeat(i);
        return `${indent}- ${g.title}${g.outcome ? ` — ${g.outcome}` : ''}`;
      })
      .join('\n');
    return `Working toward:\n${rendered}`;
  }
}
