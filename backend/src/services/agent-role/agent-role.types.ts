/**
 * =============================================================================
 * AGENT ROLE — shared types + built-in seed data
 * =============================================================================
 *
 * The six built-in roles every Workforce0 install starts with. These are
 * the same agents that shipped hardcoded before M1; moving them into a
 * data table means users can add a 7th role from the UI without touching
 * code.
 *
 * Built-ins are inserted with `tenantId=NULL` (global). A tenant can
 * override any of them by inserting a tenant-scoped row with the same
 * `slug` — the resolver in AgentRoleService returns the tenant-scoped
 * row when present, else the global built-in.
 *
 * @module services/agent-role/types
 */

/** The canonical role slugs used across the orchestrator + queue. */
export type BuiltinRoleSlug =
  | 'ba_agent'
  | 'architect'
  | 'dev_agent'
  | 'qa_agent'
  | 'supervisor'
  | 'memory_optimizer'
  | 'chief_of_staff';

export interface BuiltinRoleSeed {
  slug: BuiltinRoleSlug;
  displayName: string;
  description: string;
  category: 'consultant' | 'execution' | 'meta';
  systemPromptTemplate: string | null;
  allowedTools: string[];
  defaultConcurrency: number;
  /** Sensible default monthly cap. Null = unlimited; tenants can tighten. */
  monthlyBudgetTokens: number | null;
  /** N5: default parent in the org chart (null = top-level). */
  parentRoleSlug: BuiltinRoleSlug | null;
}

/**
 * Canonical built-ins. Ordered by position in the product flow.
 *
 * Default org-chart reports-to lines (can be changed per-tenant from
 * the Roles page):
 *
 *   supervisor   (top)
 *     ├── ba_agent           (consulting)
 *     │    └── architect     (downstream of BA)
 *     ├── dev_agent          (execution)
 *     ├── qa_agent           (execution)
 *     └── memory_optimizer   (meta / ops)
 *
 * The supervisor is the only root by default; changing a parent only
 * affects the UI view (and future routing features) — nothing enforces
 * the hierarchy at the orchestration layer yet.
 */
export const BUILTIN_ROLES: ReadonlyArray<BuiltinRoleSeed> = [
  {
    slug: 'supervisor',
    displayName: 'Supervisor',
    description:
      'Orchestrates the pipeline and surfaces blockers. Picks the next agent to route work to when an engagement hits an ambiguous fork.',
    category: 'meta',
    systemPromptTemplate: null,
    allowedTools: [],
    defaultConcurrency: 1,
    monthlyBudgetTokens: 500_000,
    parentRoleSlug: null,
  },
  {
    slug: 'chief_of_staff',
    displayName: 'Chief of Staff',
    description:
      'The voice the user hears on Slack / WhatsApp / Teams. Receives incoming tickets, picks skills + subagents from the library to decompose the work, posts a plan summary to the comms channel, broadcasts progress, and escalates when stuck.',
    category: 'meta',
    // See ChiefOfStaffService.buildPrompt() — prompt is assembled at runtime
    // from library state, so this row is metadata only.
    systemPromptTemplate: null,
    allowedTools: [],
    defaultConcurrency: 2,
    monthlyBudgetTokens: 500_000,
    parentRoleSlug: 'supervisor',
  },
  {
    slug: 'ba_agent',
    displayName: 'Business Analyst',
    description:
      'Turns meeting transcripts into structured product briefs: objectives, requirements, acceptance criteria, risks. Escalates low-confidence runs to the AI Council for multi-model review.',
    category: 'consultant',
    // BA has complex prompt assembly in code (council + transcript slices + memory recall).
    // Leaving this null means the in-code prompt wins; the table is purely metadata.
    systemPromptTemplate: null,
    allowedTools: [],
    defaultConcurrency: 3,
    monthlyBudgetTokens: 2_000_000,
    parentRoleSlug: 'supervisor',
  },
  {
    slug: 'architect',
    displayName: 'Architect',
    description:
      'Produces an implementation-ready design from an approved brief: components, APIs, data model, risks, and implementation order.',
    category: 'consultant',
    systemPromptTemplate: null,
    allowedTools: [],
    defaultConcurrency: 2,
    monthlyBudgetTokens: 1_000_000,
    parentRoleSlug: 'ba_agent',
  },
  {
    slug: 'dev_agent',
    displayName: 'Developer',
    description:
      'Implements approved briefs as pull requests. Runs on the user-side daemon that invokes the user\'s own Claude Code / Cursor / Codex CLI — no tokens spent by the server.',
    category: 'execution',
    systemPromptTemplate: null,
    allowedTools: ['Edit', 'Write', 'Bash', 'Read', 'Grep', 'Glob'],
    defaultConcurrency: 2,
    monthlyBudgetTokens: null, // daemon uses user's subscription; no server budget
    parentRoleSlug: 'supervisor',
  },
  {
    slug: 'qa_agent',
    displayName: 'Quality Assurance',
    description:
      'Verifies tests pass, runs security scans, and gates merges. Dispatches to the user-side daemon the same way Dev does.',
    category: 'execution',
    systemPromptTemplate: null,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
    defaultConcurrency: 3,
    monthlyBudgetTokens: null,
    parentRoleSlug: 'supervisor',
  },
  {
    slug: 'memory_optimizer',
    displayName: 'Memory Optimizer',
    description:
      'Runs nightly to consolidate per-tenant memory: promotes patterns, prunes low-value facts, distills approved trajectories into candidate skills.',
    category: 'meta',
    systemPromptTemplate: null,
    allowedTools: [],
    defaultConcurrency: 1,
    monthlyBudgetTokens: 1_000_000,
    parentRoleSlug: 'supervisor',
  },
];
