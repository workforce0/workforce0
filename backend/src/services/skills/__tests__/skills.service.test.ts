import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SkillsService, parseSkillMarkdown, normalizeSlug } from '../skills.service.js';

function makePrisma() {
  const rows = new Map<string, any>();
  return {
    rows,
    skill: {
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        let out = Array.from(rows.values()).filter((s) => s.tenantId === where.tenantId);
        if (where.disabled === false) out = out.filter((s) => !s.disabled);
        if (orderBy?.name === 'asc') out.sort((a, b) => a.name.localeCompare(b.name));
        return out;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.tenantId_slug) {
          return (
            Array.from(rows.values()).find(
              (s) => s.tenantId === where.tenantId_slug.tenantId && s.slug === where.tenantId_slug.slug,
            ) ?? null
          );
        }
        return rows.get(where.id) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return Array.from(rows.values()).find((s) => s.id === where.id && s.tenantId === where.tenantId) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `skill-${rows.size + 1}`, disabled: false, ...data, createdAt: new Date(), updatedAt: new Date() };
        rows.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.id);
        const next = { ...existing, ...data, updatedAt: new Date() };
        rows.set(where.id, next);
        return next;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const existing = rows.get(where.id);
        rows.delete(where.id);
        return existing;
      }),
    },
  };
}

describe('normalizeSlug', () => {
  it('lowercases, swaps separators to -, strips non-alphanumeric', () => {
    expect(normalizeSlug('Investor Update')).toBe('investor-update');
    expect(normalizeSlug('weekly_review!!!')).toBe('weekly-review');
    expect(normalizeSlug('  spaced   slug  ')).toBe('spaced-slug');
    expect(normalizeSlug('multi---dashes')).toBe('multi-dashes');
  });
});

describe('parseSkillMarkdown', () => {
  it('parses YAML frontmatter + markdown body', () => {
    const src = `---
name: Investor Update
description: Draft our monthly investor update.
platforms: [darwin, linux]
---

Write an investor update using the tone and format from past updates.
Focus on wins, misses, and the next month's goals.`;

    const parsed = parseSkillMarkdown(src);
    expect(parsed.slug).toBe('investor-update');
    expect(parsed.name).toBe('Investor Update');
    expect(parsed.description).toBe('Draft our monthly investor update.');
    expect(parsed.platforms).toEqual(['darwin', 'linux']);
    expect(parsed.body).toContain('Write an investor update');
  });

  it('handles markdown with no frontmatter (fallback header parsing)', () => {
    const src = `name: Simple Skill
description: Simple

Do the thing.`;
    const parsed = parseSkillMarkdown(src);
    expect(parsed.name).toBe('Simple Skill');
    expect(parsed.slug).toBe('simple-skill');
    expect(parsed.body).toBe('Do the thing.');
  });

  it('extracts nested workforce0 config schema', () => {
    const src = `---
name: Templated Skill
description: Uses user config.
metadata:
  workforce0:
    config:
      - key: tone
        description: Writing tone
        default: casual
---

Body here.`;
    const parsed = parseSkillMarkdown(src);
    expect(parsed.configSchema).toEqual([
      { key: 'tone', description: 'Writing tone', default: 'casual' },
    ]);
  });
});

describe('SkillsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: SkillsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SkillsService(prisma as any);
  });

  it('creates a skill from markdown source', async () => {
    const skill = await service.create({
      tenantId: 'tenant-1',
      source: `---
name: Weekly Review
description: Draft weekly review email.
---

Include wins, misses, and a single focus for next week.`,
    });
    expect(skill.slug).toBe('weekly-review');
    expect(skill.name).toBe('Weekly Review');
    expect(skill.body).toContain('Include wins');
  });

  it('rejects skill source with no name', async () => {
    await expect(
      service.create({
        tenantId: 'tenant-1',
        source: 'Just a body, no frontmatter or header.',
      }),
    ).rejects.toThrow(/missing a name/i);
  });

  it('lists active skills, excluding disabled', async () => {
    await service.create({
      tenantId: 'tenant-1',
      source: '---\nname: A\ndescription: a\n---\nBody A',
    });
    const second = await service.create({
      tenantId: 'tenant-1',
      source: '---\nname: B\ndescription: b\n---\nBody B',
    });
    await service.update('tenant-1', second.id, { disabled: true });

    const active = await service.list('tenant-1');
    expect(active).toHaveLength(1);
    expect(active[0]!.slug).toBe('a');

    const all = await service.list('tenant-1', true);
    expect(all).toHaveLength(2);
  });

  it('invokes a skill, returning a user-message activation payload', async () => {
    await service.create({
      tenantId: 'tenant-1',
      source: `---
name: Investor Update
description: Draft monthly update.
---

Write an investor update focused on wins, misses, and next month's goals.`,
    });

    const invocation = await service.invoke('tenant-1', 'investor-update', {
      userInstruction: 'Make it friendly',
    });
    expect(invocation).not.toBeNull();

    // The activation message must start with the [SYSTEM: …] user-framing line
    // (NOT a system-prompt mutation) per AGENTS.md rule.
    expect(invocation!.activationMessage).toMatch(
      /^\[SYSTEM: The user has invoked the "Investor Update" skill/,
    );
    expect(invocation!.activationMessage).toContain('Write an investor update focused on wins');
    expect(invocation!.activationMessage).toContain("The user's accompanying instruction: Make it friendly");
  });

  it('returns null when the invoked skill is disabled or unknown', async () => {
    const created = await service.create({
      tenantId: 'tenant-1',
      source: '---\nname: Z\ndescription: z\n---\nZ body',
    });
    await service.update('tenant-1', created.id, { disabled: true });
    expect(await service.invoke('tenant-1', 'z')).toBeNull();
    expect(await service.invoke('tenant-1', 'never-existed')).toBeNull();
  });

  it('updates a skill by reparsing new source', async () => {
    const created = await service.create({
      tenantId: 'tenant-1',
      source: '---\nname: Original\ndescription: v1\n---\nV1 body',
    });
    const updated = await service.update('tenant-1', created.id, {
      source: '---\nname: Renamed\ndescription: v2\n---\nV2 body',
    });
    expect(updated.slug).toBe('renamed');
    expect(updated.body).toBe('V2 body');
  });
});
