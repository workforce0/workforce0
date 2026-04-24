/**
 * =============================================================================
 * SKILLS SERVICE — Hermes-inspired user-message injection
 * =============================================================================
 *
 * Ported (algorithm only) from NousResearch/hermes-agent
 * `agent/skill_commands.py` + `agent/skill_utils.py`.
 *
 * Skills are markdown playbooks a user can invoke with a `/slug` command.
 * When invoked, the body is injected into the conversation as a USER
 * message (with a `[SYSTEM: …]` activation note), NEVER as a system-prompt
 * mutation. That keeps the Anthropic prompt cache warm across turns —
 * see AGENTS.md § "Skills as User-Message Injection" for the full rule.
 *
 * Workforce0-specific differences vs Hermes:
 *   - Stored in Postgres, not filesystem (`~/.hermes/skills/`)
 *   - Multi-tenant: scoped by tenantId
 *   - Managed via in-app UI, not CLI (exec-first principle in CLAUDE.md)
 *
 * @module services/skills
 */

import matter from 'gray-matter';
import type { PrismaClient, Skill } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  platforms?: string[];
  metadata?: {
    workforce0?: {
      config?: Array<{ key: string; description?: string; default?: string; prompt?: string }>;
      requires_tools?: string[];
    };
  };
  [key: string]: unknown;
}

export interface SkillInvocation {
  /** The user-message text to inject into the conversation. */
  activationMessage: string;
  /** Supporting files the model can reference via a `/skill_view` tool. */
  supportingFiles: Array<{ name: string; content: string }>;
  /** The underlying skill record (for logging/audit). */
  skill: Skill;
}

export interface SkillConfigEntry {
  key: string;
  description?: string;
  default?: string;
  prompt?: string;
}

export interface ParsedSkill {
  slug: string;
  name: string;
  description: string;
  body: string;
  platforms: string[];
  configSchema?: SkillConfigEntry[];
}

/**
 * Slug normalization — matches Hermes `skill_commands.py:253-258`.
 * Lowercase, underscores+spaces → dashes, strip non-[a-z0-9-], collapse.
 */
export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parse a raw `SKILL.md`-style markdown file into a skill payload ready
 * to persist. Uses gray-matter for frontmatter; falls back to
 * line-by-line `key: value` parsing if the document has no `---` fence
 * (matching Hermes `skill_utils.py:52-86`).
 */
export function parseSkillMarkdown(source: string, defaultName: string = 'untitled-skill'): ParsedSkill {
  // Try YAML frontmatter first
  let frontmatter: SkillFrontmatter = {};
  let body = source;

  try {
    const parsed = matter(source);
    frontmatter = parsed.data as SkillFrontmatter;
    body = parsed.content.trim();
  } catch {
    // gray-matter will only throw on malformed YAML — a missing frontmatter
    // fence is fine (it returns empty data). Swallow and fall through.
  }

  // Fallback: if no frontmatter produced a name, try line-by-line
  // `key: value` header until first blank line (matches Hermes
  // skill_utils.py:52-86 fallback semantics).
  if (!frontmatter.name) {
    const lines = source.split('\n');
    const fallback: SkillFrontmatter = {};
    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!.trim();
      if (line === '') {
        i += 1;
        break;
      }
      const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line);
      if (!match) break;
      (fallback as any)[match[1]!.trim()] = match[2]!.trim();
      i += 1;
    }
    if (fallback.name) {
      frontmatter = fallback;
      body = lines.slice(i).join('\n').trim();
    }
  }

  const name = frontmatter.name ?? defaultName;
  return {
    slug: normalizeSlug(name),
    name,
    description: frontmatter.description ?? '',
    body,
    platforms: frontmatter.platforms ?? [],
    configSchema: frontmatter.metadata?.workforce0?.config,
  };
}

export class SkillsService {
  private readonly logger = createChildLogger({ service: 'SkillsService' });

  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string, includeDisabled = false): Promise<Skill[]> {
    return this.prisma.skill.findMany({
      where: { tenantId, ...(includeDisabled ? {} : { disabled: false }) },
      orderBy: { name: 'asc' },
    });
  }

  async getBySlug(tenantId: string, slug: string): Promise<Skill | null> {
    return this.prisma.skill.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
    });
  }

  async create(input: {
    tenantId: string;
    source: string;
    createdBy?: string;
    fallbackName?: string;
  }): Promise<Skill> {
    const parsed = parseSkillMarkdown(input.source, input.fallbackName ?? '');
    if (!parsed.name || !parsed.slug) {
      throw new Error(
        'Skill is missing a name — add `name: something` to the frontmatter.',
      );
    }
    const skill = await this.prisma.skill.create({
      data: {
        tenantId: input.tenantId,
        slug: parsed.slug,
        name: parsed.name,
        description: parsed.description,
        body: parsed.body,
        platforms: parsed.platforms,
        configSchema: (parsed.configSchema ?? null) as any,
        createdBy: input.createdBy,
      },
    });
    this.logger.info('Skill created', { tenantId: input.tenantId, slug: parsed.slug });
    return skill;
  }

  async update(
    tenantId: string,
    id: string,
    input: {
      source?: string;
      disabled?: boolean;
    },
  ): Promise<Skill> {
    const existing = await this.prisma.skill.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Skill not found');

    const data: Record<string, unknown> = {};
    if (input.disabled !== undefined) data.disabled = input.disabled;
    if (input.source !== undefined) {
      const parsed = parseSkillMarkdown(input.source, existing.name);
      data.slug = parsed.slug;
      data.name = parsed.name;
      data.description = parsed.description;
      data.body = parsed.body;
      data.platforms = parsed.platforms;
      data.configSchema = (parsed.configSchema ?? null) as any;
    }

    return this.prisma.skill.update({ where: { id }, data });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.prisma.skill.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Skill not found');
    await this.prisma.skill.delete({ where: { id } });
  }

  /**
   * Build the user-message payload that activates the skill.
   *
   * This is the MONEY METHOD — the whole reason skills exist in Workforce0.
   * The returned `activationMessage` is what the agent loop should push as
   * the next user turn. NEVER merge it into the system prompt.
   */
  async invoke(
    tenantId: string,
    slug: string,
    opts: { userInstruction?: string; config?: Record<string, string> } = {},
  ): Promise<SkillInvocation | null> {
    const skill = await this.getBySlug(tenantId, slug);
    if (!skill || skill.disabled) return null;

    const lines: string[] = [
      `[SYSTEM: The user has invoked the "${skill.name}" skill, indicating they want you to follow its instructions. The full skill content is loaded below.]`,
      '',
      skill.body.trim(),
    ];

    if (opts.config && Object.keys(opts.config).length > 0) {
      lines.push('', '[Skill config (from user settings):');
      for (const [k, v] of Object.entries(opts.config)) {
        lines.push(`  ${k} = ${v || '(not set)'}`);
      }
      lines.push(']');
    }

    const files = (skill.supportingFiles as Array<{ name: string; content: string }> | null) ?? [];
    if (files.length > 0) {
      lines.push('', '[This skill has supporting files you can reference:]');
      for (const f of files) lines.push(`- ${f.name}`);
    }

    if (opts.userInstruction) {
      lines.push('', `The user's accompanying instruction: ${opts.userInstruction}`);
    }

    return {
      activationMessage: lines.join('\n'),
      supportingFiles: files,
      skill,
    };
  }
}
