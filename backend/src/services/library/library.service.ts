/**
 * =============================================================================
 * LIBRARY SERVICE (M7.1) — vendor skills + subagents → DB
 * =============================================================================
 *
 * Reads `vendor/skills/` (anthropics/skills) and `vendor/subagents/`
 * (VoltAgent/awesome-claude-code-subagents) on boot and upserts each
 * file into `SkillPackage` / `SubagentDefinition` rows with tenantId=NULL
 * (the global library). A content hash on every row lets us skip
 * upserts when nothing has changed — cheap to run on every boot.
 *
 * The chief_of_staff planner (M7.2) queries these rows when deciding
 * how to decompose a ticket into sub-tickets.
 *
 * Design choices:
 *   - Vendor content is always read from the filesystem, never the
 *     network. OSS self-hosted deployments often run behind a firewall.
 *   - tenantId=NULL for vendor rows. Tenants inherit the global library
 *     and can add their own rows (or override by slug) if they want.
 *   - Failures are logged but non-fatal. One bad skill file must never
 *     stop the backend from booting.
 *
 * @module services/library
 */

import { readdir, readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'LibraryService' });

/**
 * Resolve the vendor/ directory. In dev we live at backend/, so we walk
 * one level up. Overridable via env for custom deployments.
 */
function resolveVendorRoot(): string {
  if (process.env.WF0_VENDOR_ROOT) return process.env.WF0_VENDOR_ROOT;
  // backend/src/services/library/library.service.ts → ../../../../vendor
  // but Prisma builds lose __dirname semantics, so prefer process.cwd()
  // which is `backend/` during `npm run dev`.
  return join(process.cwd(), '..', 'vendor');
}

interface Frontmatter {
  name?: string;
  description?: string;
  tools?: string;
  model?: string;
}

/**
 * Minimal YAML frontmatter parser — just the keys we need. The vendor
 * files follow a consistent `key: value` pattern with optional quoting.
 * We avoid a yaml dep because this is a dead-simple, well-known subset.
 */
export function parseFrontmatter(src: string): { frontmatter: Frontmatter; body: string } {
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: src };

  const [, fm, body] = match;
  const result: Frontmatter = {};
  for (const raw of fm.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    // strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // multi-line values are rare in these files; ignore for now
    (result as any)[key] = value;
  }
  return { frontmatter: result, body };
}

/**
 * Parse a `tools:` frontmatter string into an array. Upstream files use
 * comma-separated lists ("Read, Write, Bash") but also sometimes YAML
 * arrays — handle both.
 */
export function parseToolList(raw: string | undefined): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    // JSON-style array
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      // fall through to comma split
    }
  }
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export interface SeedStats {
  skillsScanned: number;
  skillsUpserted: number;
  subagentsScanned: number;
  subagentsUpserted: number;
  errors: string[];
}

export class LibraryService {
  constructor(private readonly prisma: PrismaClient, private readonly vendorRoot: string = resolveVendorRoot()) {}

  /**
   * Scan vendor/skills and vendor/subagents and upsert everything into
   * the global library (tenantId=NULL). Idempotent; safe to run every
   * boot. Returns a summary the di-container logs on startup.
   */
  async seedFromVendor(): Promise<SeedStats> {
    const stats: SeedStats = {
      skillsScanned: 0,
      skillsUpserted: 0,
      subagentsScanned: 0,
      subagentsUpserted: 0,
      errors: [],
    };

    // We continue on vendor/missing so fresh clones / packaged Docker
    // images without vendor/ just log a warning and boot clean.
    const skillsRoot = join(this.vendorRoot, 'skills', 'skills');
    const subagentsRoot = join(this.vendorRoot, 'subagents', 'categories');

    await this.scanSkills(skillsRoot, stats);
    await this.scanSubagents(subagentsRoot, stats);

    logger.info('Library seed complete', stats);
    return stats;
  }

  private async scanSkills(root: string, stats: SeedStats): Promise<void> {
    const entries = await safeReaddir(root);
    for (const entry of entries) {
      const skillDir = join(root, entry);
      let isDir: boolean;
      try {
        isDir = statSync(skillDir).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;

      const skillFile = join(skillDir, 'SKILL.md');
      let raw: string;
      try {
        raw = await readFile(skillFile, 'utf8');
      } catch {
        continue;
      }

      stats.skillsScanned += 1;
      try {
        const { frontmatter, body } = parseFrontmatter(raw);
        const slug = (frontmatter.name ?? entry).trim();
        if (!slug) {
          stats.errors.push(`skill ${entry}: missing name`);
          continue;
        }
        const contentHash = sha256(raw);

        // tenantId is nullable, so findUnique on (tenantId, slug) breaks
        // under Postgres NULL semantics. Use findFirst + create/update.
        const existing = await (this.prisma as any).skillPackage.findFirst({
          where: { tenantId: null, slug },
          select: { id: true, contentHash: true },
        });
        if (existing?.contentHash === contentHash) continue;

        if (existing) {
          await (this.prisma as any).skillPackage.update({
            where: { id: existing.id },
            data: {
              contentHash,
              description: frontmatter.description ?? '',
              body,
              metadata: { path: `vendor/skills/skills/${entry}/SKILL.md` },
            },
          });
        } else {
          await (this.prisma as any).skillPackage.create({
            data: {
              tenantId: null,
              slug,
              source: 'vendor',
              contentHash,
              description: frontmatter.description ?? '',
              body,
              requiredTools: [],
              status: 'active',
              metadata: { path: `vendor/skills/skills/${entry}/SKILL.md` },
            },
          });
        }
        stats.skillsUpserted += 1;
      } catch (err) {
        stats.errors.push(`skill ${entry}: ${(err as Error).message}`);
      }
    }
  }

  private async scanSubagents(root: string, stats: SeedStats): Promise<void> {
    const categories = await safeReaddir(root);
    for (const category of categories) {
      const categoryDir = join(root, category);
      let isDir: boolean;
      try {
        isDir = statSync(categoryDir).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;

      const files = await safeReaddir(categoryDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        if (file === 'README.md' || file === 'CONTRIBUTING.md' || file === 'CLAUDE.md') continue;

        const filePath = join(categoryDir, file);
        let raw: string;
        try {
          raw = await readFile(filePath, 'utf8');
        } catch {
          continue;
        }

        stats.subagentsScanned += 1;
        try {
          const { frontmatter, body } = parseFrontmatter(raw);
          const slug = (frontmatter.name ?? file.replace(/\.md$/, '')).trim();
          if (!slug) {
            stats.errors.push(`subagent ${category}/${file}: missing name`);
            continue;
          }
          const contentHash = sha256(raw);

          const existing = await (this.prisma as any).subagentDefinition.findFirst({
            where: { tenantId: null, slug },
            select: { id: true, contentHash: true },
          });
          if (existing?.contentHash === contentHash) continue;

          if (existing) {
            await (this.prisma as any).subagentDefinition.update({
              where: { id: existing.id },
              data: {
                contentHash,
                description: frontmatter.description ?? '',
                systemPrompt: body,
                allowedTools: parseToolList(frontmatter.tools),
                preferredModel: frontmatter.model ?? null,
                category,
                metadata: { path: `vendor/subagents/categories/${category}/${file}` },
              },
            });
          } else {
            await (this.prisma as any).subagentDefinition.create({
              data: {
                tenantId: null,
                slug,
                source: 'vendor',
                contentHash,
                description: frontmatter.description ?? '',
                systemPrompt: body,
                allowedTools: parseToolList(frontmatter.tools),
                preferredModel: frontmatter.model ?? null,
                category,
                status: 'active',
                metadata: { path: `vendor/subagents/categories/${category}/${file}` },
              },
            });
          }
          stats.subagentsUpserted += 1;
        } catch (err) {
          stats.errors.push(`subagent ${category}/${file}: ${(err as Error).message}`);
        }
      }
    }
  }

  /**
   * Return the subset of skills whose `requiredTools` are all available
   * in the given toolset. Used by the chief_of_staff planner to filter
   * skills that reference tools the executor doesn't have.
   */
  async listCompatibleSkills(
    tenantId: string,
    availableTools: string[],
  ): Promise<any[]> {
    const available = new Set(availableTools.map((t) => t.toLowerCase()));
    const rows = (await (this.prisma as any).skillPackage.findMany({
      where: {
        status: 'active',
        OR: [{ tenantId }, { tenantId: null }],
      },
      orderBy: { slug: 'asc' },
    })) as any[];
    return rows.filter((r) => {
      const req = Array.isArray(r.requiredTools) ? r.requiredTools : [];
      if (req.length === 0) return true; // unrestricted
      return req.every((t: string) => available.has(String(t).toLowerCase()));
    });
  }

  async listSubagents(tenantId: string): Promise<any[]> {
    return (await (this.prisma as any).subagentDefinition.findMany({
      where: {
        status: 'active',
        OR: [{ tenantId }, { tenantId: null }],
      },
      orderBy: [{ category: 'asc' }, { slug: 'asc' }],
    })) as any[];
  }

  async getSkillBySlug(tenantId: string, slug: string): Promise<any | null> {
    const tenantRow = await (this.prisma as any).skillPackage.findFirst({
      where: { tenantId, slug },
    });
    if (tenantRow) return tenantRow;
    return (await (this.prisma as any).skillPackage.findFirst({
      where: { tenantId: null, slug },
    })) ?? null;
  }

  async getSubagentBySlug(tenantId: string, slug: string): Promise<any | null> {
    const tenantRow = await (this.prisma as any).subagentDefinition.findFirst({
      where: { tenantId, slug },
    });
    if (tenantRow) return tenantRow;
    return (await (this.prisma as any).subagentDefinition.findFirst({
      where: { tenantId: null, slug },
    })) ?? null;
  }

  /**
   * Build a skill-injection preamble an executor can prepend to its
   * system prompt. Resolves every slug against the tenant's effective
   * library (tenant-scoped row wins over global), silently drops
   * unknown slugs, and wraps each skill in a delimiter so the LLM can
   * tell them apart.
   *
   * Returns an empty string when skillSlugs is empty or nothing
   * resolves — safe to concatenate unconditionally.
   */
  async buildSkillPreamble(tenantId: string, skillSlugs: string[]): Promise<string> {
    if (!skillSlugs || skillSlugs.length === 0) return '';
    const bodies: string[] = [];
    for (const slug of skillSlugs) {
      const row = await this.getSkillBySlug(tenantId, slug);
      if (!row) continue;
      bodies.push(`<skill name="${row.slug}">\n${row.body}\n</skill>`);
    }
    if (bodies.length === 0) return '';
    return [
      '<!-- active skills injected by chief_of_staff planner -->',
      '<skills>',
      bodies.join('\n\n'),
      '</skills>',
      '',
    ].join('\n');
  }
}
