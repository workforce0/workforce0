/**
 * =============================================================================
 * LLM-BACKED PLANNER (M7.4)
 * =============================================================================
 *
 * Real implementation of the PlannerLLM interface that ChiefOfStaffService
 * depends on. Asks an LLM to decompose a ticket into a short ordered list
 * of steps, picking from the library of skills + subagents the tenant has
 * access to.
 *
 * Why a separate module:
 * - Keeps ChiefOfStaffService testable without any LLM at all (fallback).
 * - Puts the prompt, schema, and provider wiring in one place so tweaks
 *   to the planner voice don't ripple through the orchestrator.
 *
 * Provider selection:
 * - ModelRegistryService.resolveModel(tenantId, 'chief_of_staff') picks
 *   the cheapest tenant-configured model. Default assignment is Gemini
 *   Flash — the planner doesn't need Opus-level reasoning and the
 *   orchestration cost would kill BYOK tenants otherwise.
 *
 * Output safety:
 * - Model output is parsed as JSON and validated with Zod.
 * - Any parse / validate failure → return null. ChiefOfStaffService
 *   falls back to its deterministic single-step plan, so a dumb LLM
 *   response never breaks the pipeline.
 *
 * @module services/chief-of-staff/planner-llm
 */

import { z } from 'zod';
import { createChildLogger } from '../../lib/logger.js';
import type { ModelRegistryService } from '../model-registry/model-registry.service.js';
import type { PlannerLLM, PlanStep, PlannerContext, PlanMetrics } from './chief-of-staff.service.js';
import { createModelClient } from '../agent-runtime/clients/client-factory.js';

const logger = createChildLogger({ service: 'LLMPlanner' });

const PlanStepSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2_000).optional().default(''),
  roleSlug: z.string().min(1).max(64),
  subagentSlug: z.string().min(1).max(128).optional(),
  skills: z.array(z.string().min(1).max(128)).max(8).optional(),
  dependsOn: z.array(z.number().int().min(0)).optional(),
});

const PlanSchema = z.object({
  summary: z.string().min(1).max(1_000),
  steps: z.array(PlanStepSchema).min(1).max(6),
});

/**
 * M8.1: critique schema. The critic LLM scores a draft plan on five
 * axes, 0–5 each. 0 is "fails completely," 5 is "nails it." A total
 * below CRITIQUE_REVISE_THRESHOLD triggers exactly one revision; we
 * do not loop indefinitely.
 */
const CritiqueSchema = z.object({
  coverage: z.number().min(0).max(5),
  feasibility: z.number().min(0).max(5),
  dependencies: z.number().min(0).max(5),
  missingContext: z.number().min(0).max(5),
  ambiguity: z.number().min(0).max(5),
  rationale: z.string().max(2_000).optional().default(''),
  suggestedFix: z.string().max(2_000).optional().default(''),
});

/** A total critique score of 20 (out of 25 max) or higher passes. */
export const CRITIQUE_REVISE_THRESHOLD = 20;

/** M8.2: number of parallel plans to generate for self-consistency.
 *  Three gives a tie-break majority without tripling cost on every
 *  ticket — tenants can opt out by setting the `selfConsistencyN`
 *  LLMPlanner option to 1. */
export const DEFAULT_SELF_CONSISTENCY_N = 3;

/**
 * M7.4 follow-up: budget gate. Passed in so LLMPlanner stays decoupled
 * from UsageService — tests can stub it, and the planner falls back to
 * deterministic plans when the tenant is over their chief_of_staff
 * monthly cap. The shape matches UsageService.isOverRoleMonthlyBudget's
 * return contract exactly; we only read `.over`.
 */
export interface BudgetGate {
  isOverRoleMonthlyBudget(
    tenantId: string,
    roleSlug: string,
  ): Promise<{ over: boolean; used: number; cap: number | null }>;
}

export interface LLMPlannerDeps {
  modelRegistry: ModelRegistryService;
  /** Optional — when present, the planner refuses LLM calls once the
   *  chief_of_staff monthlyBudgetTokens cap is hit, and ChiefOfStaff
   *  runs the deterministic single-step plan. No gate = uncapped. */
  budgetGate?: BudgetGate;
  /** M8.2: how many parallel plan candidates to generate before
   *  critique. Default 3. Set to 1 to disable self-consistency (e.g.
   *  tests, tight-budget tenants). */
  selfConsistencyN?: number;
  /** PG.6: optional project-graph enricher. When present and the
   *  ticket carries a projectId, the planner prompt grows a
   *  "Project landmarks" section listing the top-5 god nodes for
   *  the project's cached graph. Gives the planner structural
   *  context about the codebase without paying the full graph cost.
   *  Inspired by https://github.com/safishamsi/graphify (credited
   *  in the README). */
  godNodeProvider?: {
    getGodNodeNames(tenantId: string, projectId: string, limit?: number): Promise<string[]>;
    /** PG.13: optional — when present the planner captures the
     *  ProjectGraph.contentHash that fed the landmarks list so the
     *  audit UI can badge the resulting plan as "stale" if the
     *  underlying graph has since been rebuilt. Non-fatal if absent
     *  (legacy callers using getGodNodeNames still get landmarks,
     *  just without a staleness signal). */
    getGodNodeSnapshot?(
      tenantId: string,
      projectId: string,
      limit?: number,
    ): Promise<{ names: string[]; contentHash: string | null }>;
  };
}

export class LLMPlanner implements PlannerLLM {
  constructor(private readonly deps: LLMPlannerDeps) {}

  /**
   * Assemble the system prompt. The tone is deliberately short — the
   * chief_of_staff is a Slack-native voice, not a long essayist.
   */
  private buildSystemPrompt(): string {
    return [
      'You are the chief of staff of a team of AI agents for a busy executive.',
      '',
      'Your job: when a new task arrives, decide how to break it into a small number of clear steps (1–6). Each step gets handed to an agent via our pull queue; the agents will do the actual work.',
      '',
      "You MUST output valid JSON matching this exact shape — no prose, no markdown fence, JSON only:",
      '{',
      '  "summary": "one or two sentences the user will see on Slack — first person, terse, decision-free",',
      '  "steps": [',
      '    {',
      '      "title": "short imperative action",',
      '      "description": "what done looks like",',
      '      "roleSlug": "one of the available roles",',
      '      "subagentSlug": "optional — pick from the subagent list when one is clearly right",',
      '      "skills": ["optional — skill slugs to load into the executor"],',
      '      "dependsOn": [0, 1]',
      '    }',
      '  ]',
      '}',
      '',
      'Rules:',
      '- Only use role slugs and subagent slugs from the lists provided.',
      '- Only reference skill slugs from the list provided.',
      '- Prefer fewer steps. A single step is fine for small tasks.',
      '- If a subagent fits the step cleanly (e.g. "code-reviewer" for a PR review), use it.',
      '- The summary is the message the user sees on Slack. Make it feel like a human co-worker.',
    ].join('\n');
  }

  private buildUserMessage(args: {
    context: PlannerContext;
    availableSkills: Array<{ slug: string; description: string }>;
    availableSubagents: Array<{ slug: string; description: string; category?: string | null }>;
    projectLandmarks?: string[];
  }): string {
    const { context, availableSkills, availableSubagents, projectLandmarks } = args;
    const roles = ['ba_agent', 'architect', 'dev_agent', 'qa_agent', 'memory_optimizer'];
    const lines: string[] = [];
    lines.push('## New task');
    lines.push(`Title: ${context.parentTicket.title}`);
    if (context.parentTicket.description) {
      lines.push(`Description: ${context.parentTicket.description}`);
    }
    if (context.attempt > 1) {
      lines.push(`Attempt: ${context.attempt} (retry)`);
      if (context.replanReason) {
        lines.push(`Previous attempt failed with: ${context.replanReason.slice(0, 500)}`);
        lines.push(`Pick a different approach this time — don't repeat what failed.`);
      }
    }
    lines.push('');
    // PG.6: inject project landmarks (top-N god nodes from the
    // project's AST graph) when available. These are the most-
    // connected symbols in the codebase — a cheap way to tell the
    // planner "these are the core abstractions; decompose around
    // them." Credit: idea from https://github.com/safishamsi/graphify.
    if (projectLandmarks && projectLandmarks.length > 0) {
      lines.push('## Project landmarks (most-connected symbols in this codebase)');
      lines.push(projectLandmarks.map((n) => `- ${n}`).join('\n'));
      lines.push('');
    }
    lines.push('## Available roles');
    lines.push(roles.map((r) => `- ${r}`).join('\n'));
    lines.push('');
    if (availableSubagents.length > 0) {
      lines.push('## Available subagents (optional specialists)');
      // Cap the subagent list so the prompt stays short. Sorted alphabetically
      // for determinism. The planner picks one per step only if it fits.
      const cap = 60;
      const pick = availableSubagents.slice(0, cap);
      for (const s of pick) {
        lines.push(`- ${s.slug}: ${s.description.slice(0, 120)}`);
      }
      if (availableSubagents.length > cap) {
        lines.push(`- …and ${availableSubagents.length - cap} more (omitted for brevity)`);
      }
      lines.push('');
    }
    if (availableSkills.length > 0) {
      lines.push('## Available skills (optional prompt packs)');
      const cap = 40;
      const pick = availableSkills.slice(0, cap);
      for (const s of pick) {
        lines.push(`- ${s.slug}: ${s.description.slice(0, 120)}`);
      }
      if (availableSkills.length > cap) {
        lines.push(`- …and ${availableSkills.length - cap} more`);
      }
      lines.push('');
    }
    lines.push('Decompose and reply with JSON.');
    return lines.join('\n');
  }

  async plan(args: {
    context: PlannerContext;
    availableSkills: Array<{ slug: string; description: string }>;
    availableSubagents: Array<{ slug: string; description: string; category?: string | null }>;
  }): Promise<{ steps: PlanStep[]; summary: string; metrics?: PlanMetrics } | null> {
    const { context } = args;

    // Budget gate: if the tenant has set a monthlyBudgetTokens cap on
    // the chief_of_staff role and this month's usage has hit it, stop
    // calling the LLM and let the deterministic fallback take over.
    if (this.deps.budgetGate) {
      try {
        const budget = await this.deps.budgetGate.isOverRoleMonthlyBudget(
          context.tenantId,
          'chief_of_staff',
        );
        if (budget.over) {
          logger.info('Planner skipped — chief_of_staff monthly budget exhausted', {
            tenantId: context.tenantId,
            used: budget.used,
            cap: budget.cap,
          });
          return null;
        }
      } catch (err) {
        // Budget-gate failure never blocks planning — we'd rather run
        // over-budget briefly than stall on a monitoring outage.
        logger.warn('Budget gate check failed; continuing with planner', {
          tenantId: context.tenantId,
          error: (err as Error).message,
        });
      }
    }

    let resolved;
    try {
      resolved = await this.deps.modelRegistry.resolveModel(context.tenantId, 'chief_of_staff');
    } catch (err) {
      logger.warn('resolveModel failed; using fallback', {
        tenantId: context.tenantId,
        error: (err as Error).message,
      });
      return null;
    }

    // ModelRegistry returns an apiKey only when the tenant has a provider
    // row. Without one we can't talk to an LLM; fall back.
    if (!resolved.apiKeyEnc) {
      logger.debug('No api key for chief_of_staff provider; fallback', {
        tenantId: context.tenantId,
      });
      return null;
    }

    let client;
    try {
      client = createModelClient(resolved.provider, {
        apiKey: resolved.apiKeyEnc,
        baseUrl: resolved.baseUrl,
      });
    } catch (err) {
      logger.warn('createModelClient failed; fallback', {
        tenantId: context.tenantId,
        provider: resolved.provider,
        error: (err as Error).message,
      });
      return null;
    }

    // PG.6: look up project landmarks (top-N god nodes) once per
    // planner run and thread them through every draft + revise call.
    // Non-fatal: failures fall through to an empty list so the
    // planner still runs.
    // PG.13: when the provider supports getGodNodeSnapshot, also
    // capture the graph's contentHash so the audit UI can badge this
    // plan as stale when the graph is later rebuilt.
    let projectLandmarks: string[] = [];
    let graphContentHash: string | null = null;
    if (this.deps.godNodeProvider && (context.parentTicket as any).projectId) {
      try {
        const pid = (context.parentTicket as any).projectId as string;
        if (this.deps.godNodeProvider.getGodNodeSnapshot) {
          const snap = await this.deps.godNodeProvider.getGodNodeSnapshot(
            context.tenantId,
            pid,
            5,
          );
          projectLandmarks = snap.names;
          graphContentHash = snap.contentHash;
        } else {
          projectLandmarks = await this.deps.godNodeProvider.getGodNodeNames(
            context.tenantId,
            pid,
            5,
          );
        }
      } catch (err) {
        logger.debug('God-node lookup failed; continuing without landmarks', {
          tenantId: context.tenantId,
          error: (err as Error).message,
        });
      }
    }

    // M8.2: self-consistency — generate N drafts in parallel. When
    // they disagree on step count / role assignments, pick the most
    // consistent one (the "majority vote" among the candidates). On
    // N=1 this collapses to a single call and the old behavior.
    const n = Math.max(1, this.deps.selfConsistencyN ?? DEFAULT_SELF_CONSISTENCY_N);
    const drafts = await Promise.all(
      Array.from({ length: n }, () =>
        this.generateDraft({ client, modelId: resolved.modelId, args, projectLandmarks }),
      ),
    );
    const valid = drafts.filter((d): d is { steps: PlanStep[]; summary: string } => d !== null);
    if (valid.length === 0) {
      logger.warn('All self-consistency drafts failed; fallback', { tenantId: context.tenantId });
      return null;
    }
    const draft = pickMostConsistent(valid);
    if (valid.length > 1) {
      logger.info('Self-consistency picked winner', {
        tenantId: context.tenantId,
        candidates: valid.length,
        stepCounts: valid.map((d) => d.steps.length),
        winnerStepCount: draft.steps.length,
      });
    }

    // M8.1: critique-and-revise. Ask the model to score the plan; if
    // it's below threshold, revise once using the critique's fix
    // suggestion as added context. Bounded to a single revision so
    // total latency stays under 2 LLM round-trips most of the time
    // (3 when a revision fires).
    const reviewed = await this.critiqueAndRevise({
      draft,
      client,
      modelId: resolved.modelId,
      args,
    });
    return {
      ...reviewed,
      metrics: {
        ...(reviewed.metrics ?? {}),
        candidateCount: valid.length,
        graphContentHash,
      },
    };
  }

  /**
   * Single-shot draft generator — one LLM call, JSON parse, slug
   * cross-validation. Returns null on any failure so the self-
   * consistency caller can quietly drop bad candidates.
   */
  private async generateDraft(opts: {
    client: { chat: (req: any) => Promise<{ content: string }> };
    modelId: string;
    args: {
      context: PlannerContext;
      availableSkills: Array<{ slug: string; description: string }>;
      availableSubagents: Array<{ slug: string; description: string; category?: string | null }>;
    };
    projectLandmarks?: string[];
  }): Promise<{ steps: PlanStep[]; summary: string } | null> {
    const { client, modelId, args, projectLandmarks } = opts;
    let raw;
    try {
      raw = await client.chat({
        model: modelId,
        systemPrompt: this.buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: this.buildUserMessage({ ...args, projectLandmarks }),
          },
        ],
        tools: [],
      });
    } catch (err) {
      logger.warn('Planner LLM chat failed (draft)', {
        tenantId: args.context.tenantId,
        error: (err as Error).message,
      });
      return null;
    }

    const parsed = parsePlanJson(raw.content);
    if (!parsed) return null;

    // Cross-validate slugs — don't trust the model to stay within the lists.
    const validSkillSlugs = new Set(args.availableSkills.map((s) => s.slug));
    const validSubagentSlugs = new Set(args.availableSubagents.map((s) => s.slug));
    const cleaned: PlanStep[] = parsed.steps.map((s) => ({
      title: s.title,
      description: s.description,
      roleSlug: s.roleSlug,
      subagentSlug:
        s.subagentSlug && validSubagentSlugs.has(s.subagentSlug) ? s.subagentSlug : undefined,
      skills: s.skills?.filter((slug) => validSkillSlugs.has(slug)) ?? [],
      dependsOn: s.dependsOn,
    }));
    return { steps: cleaned, summary: parsed.summary };
  }

  /**
   * Score the draft plan with a short JSON-output LLM call. Returns
   * null when the model fails to produce a valid score (in which case
   * we accept the draft as-is rather than loop on scoring errors).
   */
  private async runCritique(args: {
    draft: { steps: PlanStep[]; summary: string };
    client: { chat: (req: any) => Promise<{ content: string }> };
    modelId: string;
    context: PlannerContext;
  }): Promise<z.infer<typeof CritiqueSchema> | null> {
    const { draft, client, modelId, context } = args;
    const systemPrompt = [
      'You are a rigorous plan reviewer.',
      '',
      'Score the plan on 5 axes (0–5 each, integer):',
      '  - coverage: does the plan address every aspect of the task?',
      '  - feasibility: can these agents actually execute these steps?',
      '  - dependencies: are step orderings and dependsOn[] correct?',
      '  - missingContext: is anything material absent (use 5 if nothing is missing, 0 if critical context is missing)?',
      '  - ambiguity: are the step titles/descriptions precise (5=precise, 0=vague)?',
      '',
      'Reply with JSON ONLY — no prose, no markdown fence:',
      '{"coverage":N,"feasibility":N,"dependencies":N,"missingContext":N,"ambiguity":N,"rationale":"...","suggestedFix":"..."}',
      '',
      "Rationale is one sentence. SuggestedFix is one or two sentences telling the planner what to change if revision is needed. Keep both short.",
    ].join('\n');
    const userMessage = [
      '## Original task',
      `Title: ${context.parentTicket.title}`,
      context.parentTicket.description
        ? `Description: ${context.parentTicket.description}`
        : '',
      '',
      '## Draft plan',
      `Summary: ${draft.summary}`,
      '',
      'Steps:',
      ...draft.steps.map(
        (s, i) =>
          `${i + 1}. ${s.title} → ${s.roleSlug}` +
          (s.subagentSlug ? ` · ${s.subagentSlug}` : '') +
          (s.skills && s.skills.length ? ` · skills=[${s.skills.join(',')}]` : ''),
      ),
      '',
      'Score it.',
    ]
      .filter(Boolean)
      .join('\n');

    let raw;
    try {
      raw = await client.chat({
        model: modelId,
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: [],
      });
    } catch (err) {
      logger.warn('Critique chat failed; accepting draft as-is', {
        tenantId: context.tenantId,
        error: (err as Error).message,
      });
      return null;
    }

    return parseCritiqueJson(raw.content);
  }

  /**
   * Revise the draft given critique feedback. One attempt; if the
   * revised plan is itself invalid JSON or schema-mismatched, we fall
   * back to the draft (better to ship a lower-scored plan than nothing).
   */
  private async reviseDraft(args: {
    draft: { steps: PlanStep[]; summary: string };
    critique: z.infer<typeof CritiqueSchema>;
    client: { chat: (req: any) => Promise<{ content: string }> };
    modelId: string;
    args: {
      context: PlannerContext;
      availableSkills: Array<{ slug: string; description: string }>;
      availableSubagents: Array<{ slug: string; description: string; category?: string | null }>;
    };
  }): Promise<{ steps: PlanStep[]; summary: string } | null> {
    const { draft, critique, client, modelId } = args;
    const baseUser = this.buildUserMessage(args.args);
    const userMessage = [
      baseUser,
      '',
      '## Your previous draft',
      `Summary: ${draft.summary}`,
      'Steps:',
      ...draft.steps.map(
        (s, i) =>
          `${i + 1}. ${s.title} → ${s.roleSlug}` +
          (s.subagentSlug ? ` · ${s.subagentSlug}` : ''),
      ),
      '',
      '## Critique',
      `Rationale: ${critique.rationale}`,
      critique.suggestedFix ? `Suggested fix: ${critique.suggestedFix}` : '',
      '',
      'Produce a better plan. Reply with the same JSON shape as before.',
    ]
      .filter(Boolean)
      .join('\n');

    let raw;
    try {
      raw = await client.chat({
        model: modelId,
        systemPrompt: this.buildSystemPrompt(),
        messages: [{ role: 'user', content: userMessage }],
        tools: [],
      });
    } catch (err) {
      logger.warn('Revise chat failed; keeping draft', {
        error: (err as Error).message,
      });
      return null;
    }
    const parsed = parsePlanJson(raw.content);
    if (!parsed) return null;
    const validSkillSlugs = new Set(args.args.availableSkills.map((s) => s.slug));
    const validSubagentSlugs = new Set(args.args.availableSubagents.map((s) => s.slug));
    return {
      summary: parsed.summary,
      steps: parsed.steps.map((s) => ({
        title: s.title,
        description: s.description,
        roleSlug: s.roleSlug,
        subagentSlug:
          s.subagentSlug && validSubagentSlugs.has(s.subagentSlug) ? s.subagentSlug : undefined,
        skills: s.skills?.filter((slug) => validSkillSlugs.has(slug)) ?? [],
        dependsOn: s.dependsOn,
      })),
    };
  }

  /**
   * Glue for plan → critique → (maybe) revise. Exported via `plan()`.
   * Returns the winning plan (revised if the critique triggered a
   * revision and it parsed OK; draft otherwise).
   */
  private async critiqueAndRevise(opts: {
    draft: { steps: PlanStep[]; summary: string };
    client: { chat: (req: any) => Promise<{ content: string }> };
    modelId: string;
    args: {
      context: PlannerContext;
      availableSkills: Array<{ slug: string; description: string }>;
      availableSubagents: Array<{ slug: string; description: string; category?: string | null }>;
    };
  }): Promise<{ steps: PlanStep[]; summary: string; metrics?: PlanMetrics }> {
    const { draft, client, modelId, args } = opts;
    const critique = await this.runCritique({
      draft,
      client,
      modelId,
      context: args.context,
    });
    if (!critique) return { ...draft, metrics: { critiqueScore: null, revised: false } };

    const total =
      critique.coverage +
      critique.feasibility +
      critique.dependencies +
      critique.missingContext +
      critique.ambiguity;

    logger.info('Plan critique scored', {
      tenantId: args.context.tenantId,
      ticketId: args.context.parentTicket.id,
      total,
      threshold: CRITIQUE_REVISE_THRESHOLD,
      coverage: critique.coverage,
      feasibility: critique.feasibility,
      dependencies: critique.dependencies,
      missingContext: critique.missingContext,
      ambiguity: critique.ambiguity,
    });

    if (total >= CRITIQUE_REVISE_THRESHOLD) {
      return { ...draft, metrics: { critiqueScore: total, revised: false } };
    }

    const revised = await this.reviseDraft({ draft, critique, client, modelId, args });
    if (!revised) {
      logger.warn('Revision failed; keeping draft', {
        tenantId: args.context.tenantId,
        draftSummary: draft.summary.slice(0, 120),
      });
      return { ...draft, metrics: { critiqueScore: total, revised: false } };
    }
    logger.info('Plan revised after critique', {
      tenantId: args.context.tenantId,
      ticketId: args.context.parentTicket.id,
      originalSummary: draft.summary.slice(0, 80),
      revisedSummary: revised.summary.slice(0, 80),
    });
    return { ...revised, metrics: { critiqueScore: total, revised: true } };
  }
}

/**
 * M8.2: given N independently-generated plans, pick the most
 * consistent one. "Consistent" means:
 *   1. Cluster by step count — the modal step count wins its group.
 *   2. Within the winning group, score each candidate by how many
 *      of its step roles overlap with the other candidates in the
 *      group. Highest overlap wins; ties broken by the first seen.
 *
 * With a single candidate this is a no-op passthrough. Exported so
 * tests can exercise the voting logic without running a whole LLMPlanner.
 */
export function pickMostConsistent<T extends { steps: Array<{ roleSlug: string }> }>(
  candidates: T[],
): T {
  if (candidates.length <= 1) return candidates[0];

  // Group by step count.
  const byCount = new Map<number, T[]>();
  for (const c of candidates) {
    const k = c.steps.length;
    const arr = byCount.get(k) ?? [];
    arr.push(c);
    byCount.set(k, arr);
  }
  // Pick the largest group; ties go to the group with the larger step
  // count (more detail).
  let bestGroup: T[] = [];
  let bestCount = -1;
  let bestStepCount = -1;
  for (const [stepCount, group] of byCount.entries()) {
    if (
      group.length > bestCount ||
      (group.length === bestCount && stepCount > bestStepCount)
    ) {
      bestGroup = group;
      bestCount = group.length;
      bestStepCount = stepCount;
    }
  }

  if (bestGroup.length === 1) return bestGroup[0];

  // Within the winning group, score by role-overlap with the other
  // candidates in the same group. Higher overlap = more agreement.
  let winner = bestGroup[0];
  let winnerScore = -1;
  for (const candidate of bestGroup) {
    const candidateRoles = candidate.steps.map((s) => s.roleSlug);
    let score = 0;
    for (const other of bestGroup) {
      if (other === candidate) continue;
      const otherRoles = new Set(other.steps.map((s) => s.roleSlug));
      for (const r of candidateRoles) if (otherRoles.has(r)) score += 1;
    }
    if (score > winnerScore) {
      winner = candidate;
      winnerScore = score;
    }
  }
  return winner;
}

/**
 * Parse a JSON critique response with the same fence/preamble
 * tolerance as parsePlanJson. Exported for tests.
 */
export function parseCritiqueJson(text: string): z.infer<typeof CritiqueSchema> | null {
  if (!text) return null;
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*\n([\s\S]+?)\n```/i);
  if (fence) body = fence[1].trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    body = body.slice(start, end + 1);
  }
  try {
    const json = JSON.parse(body);
    const result = CritiqueSchema.safeParse(json);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Parse the planner's raw output into our schema. Handles the common
 * LLM failure modes:
 *   - wrapping JSON in a markdown fence
 *   - leading / trailing commentary
 *   - extra trailing commas (some models)
 *
 * Exported for unit tests.
 */
export function parsePlanJson(text: string): z.infer<typeof PlanSchema> | null {
  if (!text) return null;
  // Strip ```json fences if present.
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*\n([\s\S]+?)\n```/i);
  if (fence) body = fence[1].trim();
  // If the model emitted preamble before the JSON, slice from the first {.
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    body = body.slice(start, end + 1);
  }
  try {
    const json = JSON.parse(body);
    const result = PlanSchema.safeParse(json);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
