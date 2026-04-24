/**
 * =============================================================================
 * CHIEF OF STAFF SERVICE (M7.2)
 * =============================================================================
 *
 * The "chief_of_staff" role is the voice the user hears on Slack /
 * WhatsApp / Teams. Users never interact with the web UI after setup —
 * they invite the agents to a meeting, then everything happens via the
 * comms channel.
 *
 * This service is the orchestration brain behind that voice:
 *
 *   - planTicket()  — decomposes a parent ticket into executable child
 *                     tickets, picking skills + subagents from the
 *                     library. Writes an ExecutionPlan row, creates
 *                     child tickets, posts the plan to the comms
 *                     channel.
 *
 *   - recordChildDone() / recordChildFailed() — tracks progress on child
 *                     tickets. When a child fails, triggers a bounded
 *                     replan (cap = 2 replans, 3 attempts total).
 *                     Escalates to the user when the cap is hit OR when
 *                     the same error signature appears twice in a row.
 *
 *   - escalate() — posts an escalation-with-options message via
 *                  ApprovalFanoutService (reuses reply-to-approve
 *                  infrastructure). The user replies on their preferred
 *                  channel; chief_of_staff resumes or pivots.
 *
 * LLM strategy:
 *
 * The planner is designed to work with OR without an LLM. The fallback
 * (no configured model) is a deterministic "one-step plan" — useful for
 * tests, for bootstrap, and for tenants without BYOK keys set up yet.
 * When a model IS available, ModelRegistryService.pickCheapestModel()
 * returns the lowest-cost tenant-configured model (Haiku if Anthropic
 * is present, Gemini Flash if Gemini is, etc.) since the planner work
 * doesn't need Opus-level reasoning.
 *
 * @module services/chief-of-staff
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';
import type { LibraryService } from '../library/library.service.js';
import type { TicketService } from '../ticket/ticket.service.js';
import type { CommunicationRouter } from '../communication/router.js';

const logger = createChildLogger({ service: 'ChiefOfStaffService' });

/** Cap on total plan attempts per parent ticket. 1 initial + 2 replans. */
export const PLAN_ATTEMPT_CAP = 3;

/**
 * Shape of a single step inside an ExecutionPlan.steps[]. Kept loose so
 * the LLM planner can add optional fields (`dependsOn`, `subagentSlug`,
 * etc.) without a schema migration.
 */
export interface PlanStep {
  /** Short, human-readable title. Used in channel summary + ticket title. */
  title: string;
  /** Longer description — becomes the child ticket's description field. */
  description: string;
  /** Role that owns this step. Usually a BA/Dev/QA role, or a subagent. */
  roleSlug: string;
  /** Optional subagent slug — if present, overrides the role's default prompt. */
  subagentSlug?: string;
  /** Skill package slugs to inject into the executor's prompt. */
  skills?: string[];
  /** Step indices this step depends on (for basic DAG-like flows). */
  dependsOn?: number[];
}

export interface PlannerContext {
  tenantId: string;
  parentTicket: {
    id: string;
    title: string;
    description: string;
    roleSlug: string;
    payload?: Record<string, unknown>;
    projectId?: string | null;
    goalId?: string | null;
  };
  /** Tenant's engagement id, used only for channel message grouping. */
  engagementId?: string;
  /** Current attempt number (1 = initial, 2/3 = replans). */
  attempt: number;
  /** Replan reason, populated on attempts > 1. */
  replanReason?: string;
  /** Same-error signature from the last failed attempt, if any. */
  lastErrorSignature?: string | null;
}

/**
 * Deterministic fallback plan — used when no LLM is available or when
 * the LLM planner fails. Produces a single step that hands the ticket
 * back to its original role. This is the safest possible plan: it
 * preserves existing behavior when skills orchestration isn't set up.
 */
export function buildFallbackPlan(ctx: PlannerContext): { steps: PlanStep[]; summary: string } {
  const step: PlanStep = {
    title: ctx.parentTicket.title,
    description: ctx.parentTicket.description,
    roleSlug: ctx.parentTicket.roleSlug === 'chief_of_staff' ? 'ba_agent' : ctx.parentTicket.roleSlug,
    skills: [],
  };
  const summary =
    ctx.attempt === 1
      ? `Got it — routing this straight to the ${step.roleSlug} without extra tooling.`
      : `Retrying (attempt ${ctx.attempt}) — same route, fresh context.`;
  return { steps: [step], summary };
}

/**
 * Heuristic error-signature hash. Trims volatile tokens (stack trace
 * paths, node IDs, UUIDs) so two runs that fail "the same way" produce
 * the same key. Used by the same-error escalation rule.
 */
export function errorSignature(error: string | null | undefined): string | null {
  if (!error) return null;
  return error
    .replace(/\/[^\s:]+:\d+:\d+/g, '<loc>') // strip file paths with line:col
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d+\.\d+\.\d+\.\d+(?::\d+)?\b/g, '<addr>') // ip[:port] → <addr>
    .replace(/\b\d{4,}\b/g, '<n>') // strip long numeric ids
    .slice(0, 200)
    .trim()
    .toLowerCase();
}

/**
 * M8.3: metrics emitted alongside a plan so the audit UI can show
 * decomposition quality. All fields optional — the deterministic
 * fallback emits none; the LLM planner emits all three.
 */
export interface PlanMetrics {
  /** Total critique score, 0..25. Null when no critique ran. */
  critiqueScore?: number | null;
  /** True when the critic triggered a single revision round. */
  revised?: boolean;
  /** How many parallel drafts self-consistency evaluated. */
  candidateCount?: number;
  /** PG.13: ProjectGraph.contentHash at the moment this plan pulled
   *  god-node landmarks into its prompt. Null when no graph was
   *  read (project has no graph, or godNodeProvider absent, or the
   *  fallback plan ran). Used by the audit UI to badge plans built
   *  against a now-stale graph. */
  graphContentHash?: string | null;
}

/**
 * Dependency shape for the LLM planner. The actual model call is
 * abstracted so we can swap Gemini / Anthropic / OpenAI / local daemon
 * behind one interface.
 */
export interface PlannerLLM {
  /**
   * Generate a plan given a library of skills + subagents and the
   * parent ticket context. Returning `null` means "I couldn't produce a
   * valid plan; use the fallback."
   */
  plan(args: {
    context: PlannerContext;
    availableSkills: Array<{ slug: string; description: string }>;
    availableSubagents: Array<{ slug: string; description: string; category?: string | null }>;
  }): Promise<{ steps: PlanStep[]; summary: string; metrics?: PlanMetrics } | null>;
}

/**
 * M7.5: minter for per-escalation tokens. Kept behind an interface so
 * ChiefOfStaffService doesn't import EscalationService (which in turn
 * depends on ChiefOfStaffService — the circle is broken at the DI layer
 * where the setter is wired after both instances exist).
 */
export interface EscalationTokenMinter {
  createToken(parentTicketId: string, tenantId: string): Promise<string>;
}

export class ChiefOfStaffService {
  private tokenMinter?: EscalationTokenMinter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly library: LibraryService,
    private readonly tickets: TicketService,
    private readonly comms?: CommunicationRouter,
    private readonly llm?: PlannerLLM,
  ) {}

  /** Wired post-construction by the DI container after EscalationService exists. */
  setTokenMinter(minter: EscalationTokenMinter): void {
    this.tokenMinter = minter;
  }

  /**
   * Produce a plan for the given parent ticket. Does NOT create child
   * tickets — caller is responsible for that after reviewing the
   * returned plan. This separation keeps the LLM path testable without
   * side effects.
   */
  async buildPlan(ctx: PlannerContext): Promise<{ steps: PlanStep[]; summary: string }> {
    if (!this.llm) {
      logger.debug('No planner LLM configured, using fallback plan', { ticketId: ctx.parentTicket.id });
      return buildFallbackPlan(ctx);
    }

    try {
      const availableSkills = (await this.library.listCompatibleSkills(ctx.tenantId, [])).map((s: any) => ({
        slug: s.slug,
        description: s.description,
      }));
      const availableSubagents = (await this.library.listSubagents(ctx.tenantId)).map((s: any) => ({
        slug: s.slug,
        description: s.description,
        category: s.category,
      }));

      const plan = await this.llm.plan({ context: ctx, availableSkills, availableSubagents });
      if (!plan || plan.steps.length === 0) {
        logger.warn('Planner returned no plan; falling back', { ticketId: ctx.parentTicket.id });
        return buildFallbackPlan(ctx);
      }
      return plan;
    } catch (err) {
      logger.error('Planner LLM call failed; falling back', {
        ticketId: ctx.parentTicket.id,
        error: (err as Error).message,
      });
      return buildFallbackPlan(ctx);
    }
  }

  /**
   * End-to-end: plan + persist + fan out child tickets + broadcast
   * summary to the comms channel. Called when a `chief_of_staff` ticket
   * is claimed (directly by the pull queue), or when any other ticket
   * opts in via payload.decompose === true.
   */
  async planTicket(ctx: PlannerContext): Promise<{ planId: string; childTicketIds: string[] }> {
    if (ctx.attempt > PLAN_ATTEMPT_CAP) {
      throw new Error(
        `ChiefOfStaff: attempt cap (${PLAN_ATTEMPT_CAP}) exceeded for ticket ${ctx.parentTicket.id}`,
      );
    }

    const built = await this.buildPlan(ctx);
    const { steps, summary } = built;
    const metrics = (built as { metrics?: PlanMetrics }).metrics ?? {};

    // Supersede any earlier active plan for this parent.
    await (this.prisma as any).executionPlan.updateMany({
      where: { parentTicketId: ctx.parentTicket.id, status: 'active' },
      data: { status: 'superseded' },
    });

    const plan = await (this.prisma as any).executionPlan.create({
      data: {
        tenantId: ctx.tenantId,
        parentTicketId: ctx.parentTicket.id,
        attempt: ctx.attempt,
        steps: steps as any,
        channelSummary: summary,
        status: 'active',
        replanReason: ctx.replanReason ?? null,
        // M8.3: decomposition-quality metrics persist on the plan row
        // so the audit UI can surface score, revision flag, and the
        // number of candidates self-consistency evaluated.
        critiqueScore: metrics.critiqueScore ?? null,
        revised: metrics.revised ?? false,
        candidateCount: metrics.candidateCount ?? 1,
        graphContentHash: metrics.graphContentHash ?? null,
      },
    });

    // Materialize each step as a child ticket. Children inherit project
    // + goal from the parent so project-level isolation (P1) still works.
    const childIds: string[] = [];
    for (const step of steps) {
      const child = await this.tickets.create({
        tenantId: ctx.tenantId,
        roleSlug: step.roleSlug,
        title: step.title,
        description: step.description,
        parentTicketId: ctx.parentTicket.id,
        payload: {
          // The executor reads these at prompt-assembly time.
          skills: step.skills ?? [],
          subagentSlug: step.subagentSlug ?? null,
          planId: plan.id,
        },
        projectId: ctx.parentTicket.projectId ?? null,
        goalId: ctx.parentTicket.goalId ?? null,
      });
      childIds.push(child.id);
    }

    // Broadcast the plan to the tenant's preferred channel. Never block
    // the pipeline on a channel failure — the exec UI still has the
    // plan even if Slack is down.
    await this.broadcast(ctx, 'plan_summary', summary);

    logger.info('Plan created', {
      ticketId: ctx.parentTicket.id,
      planId: plan.id,
      attempt: ctx.attempt,
      steps: steps.length,
    });

    return { planId: plan.id, childTicketIds: childIds };
  }

  /**
   * Post an arbitrary orchestration event to the comms channel. No-op
   * when CommunicationRouter isn't configured. Non-fatal on send errors.
   */
  async broadcast(
    ctx: Pick<PlannerContext, 'tenantId' | 'engagementId'>,
    messageType: 'plan_summary' | 'progress_update' | 'escalation',
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.comms) return;
    try {
      await this.comms.send({
        tenantId: ctx.tenantId,
        engagementId: ctx.engagementId,
        // Founder is the default recipient for chief_of_staff broadcasts;
        // CommunicationRouter falls back if no founder team member exists.
        recipientRole: 'founder',
        messageType: messageType as any,
        content,
        metadata,
      });
    } catch (err) {
      logger.warn('Channel broadcast failed (non-fatal)', {
        tenantId: ctx.tenantId,
        messageType,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Record a child-ticket success. Posts a progress update; when all
   * children are done, posts a completion summary and marks the plan
   * 'done'.
   */
  async recordChildDone(parentTicketId: string, childTicketId: string, childTitle: string): Promise<void> {
    const plan = await (this.prisma as any).executionPlan.findFirst({
      where: { parentTicketId, status: 'active' },
    });
    if (!plan) return;

    // Do we still have open children?
    const remaining = await (this.prisma as any).ticket.count({
      where: {
        parentTicketId,
        status: { notIn: ['done', 'failed', 'cancelled'] },
      },
    });

    if (remaining === 0) {
      await (this.prisma as any).executionPlan.update({
        where: { id: plan.id },
        data: { status: 'done' },
      });
      await this.broadcast(
        { tenantId: plan.tenantId },
        'progress_update',
        `✅ Completed: "${childTitle}". All ${plan.steps.length} steps done.`,
      );
    } else {
      await this.broadcast(
        { tenantId: plan.tenantId },
        'progress_update',
        `✅ "${childTitle}" done. ${remaining} step${remaining === 1 ? '' : 's'} remaining.`,
      );
    }
  }

  /**
   * Record a child-ticket failure. Applies the bounded replan rule:
   *   - If attempt cap not yet hit → replan with the failure as context.
   *   - If the failure signature matches the last one → escalate
   *     immediately regardless of cap (stuck, not transient).
   *   - If cap is hit → escalate.
   */
  async recordChildFailed(args: {
    parentTicketId: string;
    childTicketId: string;
    childTitle: string;
    error: string;
  }): Promise<{ action: 'replanned' | 'escalated' | 'noop'; planId?: string }> {
    const { parentTicketId, error } = args;
    const plan = await (this.prisma as any).executionPlan.findFirst({
      where: { parentTicketId, status: 'active' },
      orderBy: { attempt: 'desc' },
    });
    if (!plan) return { action: 'noop' };

    const newSignature = errorSignature(error);
    const priorSignature = plan.replanReason ? errorSignature(plan.replanReason) : null;

    // Same-error-twice → escalate regardless of cap.
    if (newSignature && priorSignature && newSignature === priorSignature) {
      await this.escalate({
        tenantId: plan.tenantId,
        parentTicketId,
        reason: `Same error twice in a row: ${error.slice(0, 300)}`,
      });
      return { action: 'escalated' };
    }

    // Cap hit → escalate.
    if (plan.attempt >= PLAN_ATTEMPT_CAP) {
      await this.escalate({
        tenantId: plan.tenantId,
        parentTicketId,
        reason: `Hit replan cap (${PLAN_ATTEMPT_CAP} attempts). Last error: ${error.slice(0, 300)}`,
      });
      return { action: 'escalated' };
    }

    // Replan.
    const parent = await (this.prisma as any).ticket.findUnique({ where: { id: parentTicketId } });
    if (!parent) return { action: 'noop' };

    const nextAttempt = plan.attempt + 1;
    const { planId } = await this.planTicket({
      tenantId: parent.tenantId,
      parentTicket: parent,
      attempt: nextAttempt,
      replanReason: error,
      lastErrorSignature: priorSignature,
    });
    await this.broadcast(
      { tenantId: plan.tenantId },
      'progress_update',
      `⚠️ Step failed: "${args.childTitle}". Replanning (attempt ${nextAttempt} of ${PLAN_ATTEMPT_CAP}).`,
    );
    return { action: 'replanned', planId };
  }

  /**
   * Send an escalation message to the user's preferred channel and
   * mark the active plan as 'failed'. The user can reply
   * YES / NO / PAUSE / RETRY via the same reply-to-approve machinery
   * ApprovalFanoutService already powers — handled one level up.
   */
  async escalate(args: {
    tenantId: string;
    parentTicketId: string;
    reason: string;
  }): Promise<void> {
    await (this.prisma as any).executionPlan.updateMany({
      where: { parentTicketId: args.parentTicketId, status: 'active' },
      data: { status: 'failed' },
    });

    const parent = await (this.prisma as any).ticket.findUnique({
      where: { id: args.parentTicketId },
    });
    const title = parent?.title ?? 'your request';

    // M7.5: mint (or reuse) an escalation token so the user's reply on
    // any channel can be matched back to THIS parent ticket. Channels
    // carry replies as text, not state — the token is the stateful
    // handle. Falls back to a tokenless message if the minter isn't
    // wired yet (tests / partial init).
    let token: string | null = null;
    if (this.tokenMinter) {
      try {
        token = await this.tokenMinter.createToken(args.parentTicketId, args.tenantId);
      } catch (err) {
        logger.warn('Token mint failed — escalating without a token', {
          error: (err as Error).message,
        });
      }
    }

    const actions = token
      ? [
          `  RETRY ${token}   — I try again with a fresh plan`,
          `  PAUSE ${token}   — hold until you decide`,
          `  CANCEL ${token}  — drop this work`,
        ].join('\n')
      : 'Reply in the app — I couldn\'t mint a reply token.';

    const content = [
      `🚨 I'm stuck on "${title}" and need your call.`,
      '',
      `Why: ${args.reason}`,
      '',
      'Reply with one of:',
      actions,
    ].join('\n');

    await this.broadcast(
      { tenantId: args.tenantId },
      'escalation',
      content,
      { parentTicketId: args.parentTicketId, escalationToken: token },
    );

    logger.info('Escalated to user', {
      tenantId: args.tenantId,
      parentTicketId: args.parentTicketId,
      tokenIssued: !!token,
    });
  }
}
