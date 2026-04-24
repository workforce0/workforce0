// mvp/src/services/agents/base-consultant.ts
import { AgentLoop } from '../agent-runtime/agent-loop.js';
import type { AgentContext, AgentRunResult, ModelClient } from '../agent-runtime/types.js';
import type { ModelRegistryService } from '../model-registry/model-registry.service.js';
import type { PromptPipeline } from '../agent-runtime/prompt-pipeline.js';
import type { ConsultantConfig, ResolvedSkill } from './skills/types.js';
import type { SkillLoader } from './skills/loader.js';
import type { LibraryService } from '../library/library.service.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger({ module: 'base-consultant' });
const MAX_SKILL_TOKENS = 1500;
const CHARS_PER_TOKEN = 4;

export abstract class BaseConsultant {
  abstract readonly agentType: string;

  private cachedSkills: ResolvedSkill[] | null = null;
  protected modelClient: ModelClient;

  /**
   * Hermes III integration point. When a PromptPipeline is provided, wrap
   * the modelClient once at construction time so every chat() the agent
   * makes gets redaction + prompt caching + trajectory recording for free.
   * Existing call sites that don't pass pipeline get the raw client —
   * zero breaking changes.
   */
  constructor(
    modelClient: ModelClient,
    protected modelRegistry: ModelRegistryService | undefined,
    protected consultantConfig: ConsultantConfig,
    protected skillLoader: SkillLoader | undefined,
    pipeline?: PromptPipeline,
    /** M7.7: injected by the DI container so ticket-scoped skills
     *  can be prepended to the prompt. Optional — unit tests and
     *  bootstrap paths run without it and skip the injection. */
    protected libraryService?: LibraryService,
    /** M7.7: minimal Prisma surface for fetching the ticket payload.
     *  Typed loose to dodge the generated-client import in files that
     *  only need the `ticket.findFirst` method. */
    protected prismaForSkills?: { ticket: { findFirst: (args: unknown) => Promise<any> } },
  ) {
    this.modelClient = pipeline ? pipeline.wrap(modelClient) : modelClient;
  }

  /** Expose tools for external inspection (e.g. tests, introspection). */
  get tools() {
    return this.consultantConfig.tools;
  }

  async buildSystemPrompt(context?: AgentContext): Promise<string> {
    const skills = await this.loadSkills();

    const foundationSkills = skills.filter(s => s.scope === 'foundation');
    const learnedSkills = skills.filter(s => s.scope === 'learned');

    const sections: string[] = [this.consultantConfig.rolePrompt];

    // M7.7: prepend chief_of_staff-chosen skills when present. These
    // come from the current ticket's payload.skills[] and are loaded
    // via LibraryService. Silently no-op when nothing's configured so
    // legacy paths don't change.
    const planSkillPreamble = await this.buildPlanSkillPreamble(context);
    if (planSkillPreamble) {
      sections.push('\n## Active Skills (chief of staff)\n');
      sections.push(planSkillPreamble);
    }

    if (foundationSkills.length > 0) {
      sections.push('\n## Firm Methodology\n');
      sections.push(...foundationSkills.map(s => s.content));
    }

    // Token budget enforcement: truncate learned skills if over budget
    const foundationChars = sections.join('\n').length - this.consultantConfig.rolePrompt.length;
    const remainingBudget = (MAX_SKILL_TOKENS * CHARS_PER_TOKEN) - foundationChars;

    if (learnedSkills.length > 0 && remainingBudget > 0) {
      const fittingSkills: ResolvedSkill[] = [];
      let usedChars = 0;
      for (const skill of learnedSkills) {
        if (usedChars + skill.content.length > remainingBudget) {
          log.warn('Truncating learned skills to fit token budget', {
            included: fittingSkills.length,
            dropped: learnedSkills.length - fittingSkills.length,
            agentType: this.consultantConfig.agentType,
          });
          break;
        }
        fittingSkills.push(skill);
        usedChars += skill.content.length;
      }
      if (fittingSkills.length > 0) {
        sections.push('\n## Institutional Knowledge\n');
        sections.push(...fittingSkills.map(s => s.content));
      }
    }

    return sections.join('\n');
  }

  async resolveModelConfig(tenantId: string) {
    if (this.modelRegistry) {
      try {
        const resolved = await this.modelRegistry.resolveModel(tenantId, this.consultantConfig.agentType as any);
        if (resolved) return resolved;
      } catch {
        // Fall through to default — resolveModel throws for unknown agent types
      }
    }
    return this.consultantConfig.defaultModel;
  }

  async getSkillVersions(): Promise<Array<{ name: string; version: string; scope: 'foundation' | 'learned' }>> {
    const skills = await this.loadSkills();
    return skills.map(s => ({ name: s.name, version: s.version, scope: s.scope }));
  }

  protected async runLoop(task: string, context: AgentContext, overrides?: { maxSteps?: number }): Promise<AgentRunResult> {
    const model = await this.resolveModelConfig(context.tenantId);
    const systemPrompt = await this.buildSystemPrompt(context);
    const skillVersions = await this.getSkillVersions();

    const loop = new AgentLoop(
      {
        agentType: this.consultantConfig.agentType,
        systemPrompt,
        tools: this.consultantConfig.tools,
        maxSteps: overrides?.maxSteps ?? this.consultantConfig.maxSteps,
        confidenceThreshold: this.consultantConfig.confidenceThreshold,
        model,
      },
      this.modelClient,
    );

    const result = await loop.run(task, context);
    result.skillVersions = skillVersions;
    return result;
  }

  private async loadSkills(): Promise<ResolvedSkill[]> {
    if (this.cachedSkills) return this.cachedSkills;
    if (!this.skillLoader) {
      this.cachedSkills = [];
      return this.cachedSkills;
    }
    this.cachedSkills = await this.skillLoader.resolveAllSkills(this.consultantConfig.roleSkillTargets);
    return this.cachedSkills;
  }

  /**
   * M7.7: look up the ticket for this run (if any), read its
   * `payload.skills[]`, and resolve to a skill-injection preamble via
   * LibraryService. Returns an empty string whenever anything is missing
   * or empty — callers concatenate unconditionally.
   */
  private async buildPlanSkillPreamble(context?: AgentContext): Promise<string> {
    if (!context?.ticketId) return '';
    if (!this.libraryService || !this.prismaForSkills) return '';
    try {
      const ticket = await this.prismaForSkills.ticket.findFirst({
        where: { id: context.ticketId, tenantId: context.tenantId },
        select: { id: true, payload: true },
      });
      const skills = (ticket?.payload?.skills ?? []) as unknown as string[];
      if (!Array.isArray(skills) || skills.length === 0) return '';
      return await this.libraryService.buildSkillPreamble(context.tenantId, skills);
    } catch (err) {
      log.warn('M7 skill preamble lookup failed (non-fatal)', {
        ticketId: context.ticketId,
        error: (err as Error).message,
      });
      return '';
    }
  }
}
