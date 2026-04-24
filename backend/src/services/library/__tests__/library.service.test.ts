import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { LibraryService, parseFrontmatter, parseToolList } from '../library.service.js';

describe('parseFrontmatter', () => {
  it('extracts name + description from standard SKILL.md frontmatter', () => {
    const src = [
      '---',
      'name: brand-guidelines',
      'description: Applies Anthropic brand.',
      '---',
      '',
      '# Anthropic Brand Styling',
      'body here',
    ].join('\n');
    const { frontmatter, body } = parseFrontmatter(src);
    expect(frontmatter.name).toBe('brand-guidelines');
    expect(frontmatter.description).toBe('Applies Anthropic brand.');
    expect(body).toContain('# Anthropic Brand Styling');
  });

  it('handles double-quoted description', () => {
    const src = '---\nname: x\ndescription: "has: colons, commas."\n---\nbody';
    const { frontmatter } = parseFrontmatter(src);
    expect(frontmatter.description).toBe('has: colons, commas.');
  });

  it('parses tools + model fields from subagent frontmatter', () => {
    const src = '---\nname: code-reviewer\ntools: Read, Write, Bash\nmodel: sonnet\n---\nprompt';
    const { frontmatter } = parseFrontmatter(src);
    expect(frontmatter.tools).toBe('Read, Write, Bash');
    expect(frontmatter.model).toBe('sonnet');
  });

  it('returns empty frontmatter when none present', () => {
    const src = '# Just markdown\nno frontmatter';
    const { frontmatter, body } = parseFrontmatter(src);
    expect(frontmatter).toEqual({});
    expect(body).toBe(src);
  });

  it('handles CRLF line endings', () => {
    const src = '---\r\nname: x\r\n---\r\nbody\r\n';
    const { frontmatter, body } = parseFrontmatter(src);
    expect(frontmatter.name).toBe('x');
    expect(body).toContain('body');
  });
});

describe('parseToolList', () => {
  it('splits comma-separated tools', () => {
    expect(parseToolList('Read, Write, Bash')).toEqual(['Read', 'Write', 'Bash']);
  });

  it('parses JSON-array syntax', () => {
    expect(parseToolList('["Read", "Bash"]')).toEqual(['Read', 'Bash']);
  });

  it('returns empty array for undefined', () => {
    expect(parseToolList(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseToolList('   ')).toEqual([]);
  });

  it('trims whitespace in comma-split form', () => {
    expect(parseToolList('  Read  ,  Bash  ')).toEqual(['Read', 'Bash']);
  });
});

function makePrisma() {
  const skills: any[] = [];
  const subagents: any[] = [];
  let nextId = 1;
  return {
    skillPackage: {
      findFirst: vi.fn(async ({ where }: any) => {
        return skills.find((s) => s.tenantId === where.tenantId && s.slug === where.slug) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return skills.filter((s) => {
          if (where.status && s.status !== where.status) return false;
          if (where.OR) {
            return where.OR.some((c: any) => c.tenantId === s.tenantId);
          }
          return true;
        });
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `sk-${nextId++}`, ...data };
        skills.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = skills.findIndex((s) => s.id === where.id);
        skills[idx] = { ...skills[idx], ...data };
        return skills[idx];
      }),
    },
    subagentDefinition: {
      findFirst: vi.fn(async ({ where }: any) => {
        return subagents.find((s) => s.tenantId === where.tenantId && s.slug === where.slug) ?? null;
      }),
      findMany: vi.fn(async () => subagents),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `sa-${nextId++}`, ...data };
        subagents.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = subagents.findIndex((s) => s.id === where.id);
        subagents[idx] = { ...subagents[idx], ...data };
        return subagents[idx];
      }),
    },
    __skills: skills,
    __subagents: subagents,
  };
}

describe('LibraryService.seedFromVendor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads vendor/skills + vendor/subagents and upserts global rows', async () => {
    const prisma = makePrisma();
    // Point at the real vendor dir checked into this repo.
    const svc = new LibraryService(prisma as any);
    const stats = await svc.seedFromVendor();
    expect(stats.skillsScanned).toBeGreaterThan(0);
    expect(stats.subagentsScanned).toBeGreaterThan(0);
    expect(prisma.__skills.length).toBeGreaterThan(0);
    expect(prisma.__subagents.length).toBeGreaterThan(0);
    // Every row must have tenantId=null (global).
    for (const s of prisma.__skills) expect(s.tenantId).toBeNull();
    for (const s of prisma.__subagents) expect(s.tenantId).toBeNull();
  });

  it('is idempotent — identical contentHash skips the update', async () => {
    const prisma = makePrisma();
    const svc = new LibraryService(prisma as any);
    await svc.seedFromVendor();
    const firstRunCreates = (prisma.skillPackage.create as any).mock.calls.length;
    const firstRunUpdates = (prisma.skillPackage.update as any).mock.calls.length;

    await svc.seedFromVendor();
    const secondRunCreates = (prisma.skillPackage.create as any).mock.calls.length;
    const secondRunUpdates = (prisma.skillPackage.update as any).mock.calls.length;

    // No new creates/updates on the second run (nothing changed).
    expect(secondRunCreates).toBe(firstRunCreates);
    expect(secondRunUpdates).toBe(firstRunUpdates);
  });

  it('handles missing vendor dir without throwing', async () => {
    const prisma = makePrisma();
    const svc = new LibraryService(prisma as any, '/nonexistent/path');
    const stats = await svc.seedFromVendor();
    expect(stats.skillsScanned).toBe(0);
    expect(stats.subagentsScanned).toBe(0);
    expect(stats.errors).toHaveLength(0);
  });
});

describe('LibraryService.buildSkillPreamble', () => {
  it('returns empty string when no slugs given', async () => {
    const prisma = makePrisma();
    const svc = new LibraryService(prisma as any);
    expect(await svc.buildSkillPreamble('t1', [])).toBe('');
  });

  it('returns empty string when none of the slugs resolve', async () => {
    const prisma = makePrisma();
    const svc = new LibraryService(prisma as any);
    expect(await svc.buildSkillPreamble('t1', ['nope', 'missing'])).toBe('');
  });

  it('wraps each resolved skill in a <skill> element', async () => {
    const prisma = makePrisma();
    prisma.__skills.push({
      tenantId: null,
      slug: 'pr-review',
      status: 'active',
      requiredTools: [],
      description: '',
      body: 'Review the PR for style and correctness.',
    });
    const svc = new LibraryService(prisma as any);
    const out = await svc.buildSkillPreamble('t1', ['pr-review']);
    expect(out).toContain('<skill name="pr-review">');
    expect(out).toContain('Review the PR for style and correctness.');
    expect(out).toContain('</skill>');
  });

  it('resolves tenant-scoped override ahead of global', async () => {
    const prisma = makePrisma();
    prisma.__skills.push(
      {
        tenantId: null,
        slug: 'greet',
        status: 'active',
        requiredTools: [],
        description: '',
        body: 'GLOBAL',
      },
      {
        tenantId: 't1',
        slug: 'greet',
        status: 'active',
        requiredTools: [],
        description: '',
        body: 'TENANT-SPECIFIC',
      },
    );
    const svc = new LibraryService(prisma as any);
    const out = await svc.buildSkillPreamble('t1', ['greet']);
    expect(out).toContain('TENANT-SPECIFIC');
    expect(out).not.toContain('GLOBAL');
  });
});

describe('LibraryService.listCompatibleSkills', () => {
  it('returns skills whose requiredTools are all in availableTools', async () => {
    const prisma = makePrisma();
    prisma.__skills.push(
      { tenantId: null, slug: 'a', status: 'active', requiredTools: ['Read'], description: '', body: '' },
      { tenantId: null, slug: 'b', status: 'active', requiredTools: ['Edit'], description: '', body: '' },
      { tenantId: null, slug: 'c', status: 'active', requiredTools: [], description: '', body: '' },
    );
    const svc = new LibraryService(prisma as any);
    const out = await svc.listCompatibleSkills('t1', ['Read']);
    const slugs = out.map((r) => r.slug).sort();
    expect(slugs).toEqual(['a', 'c']);
  });

  it('treats an empty requiredTools list as unrestricted', async () => {
    const prisma = makePrisma();
    prisma.__skills.push({
      tenantId: null,
      slug: 'free',
      status: 'active',
      requiredTools: [],
      description: '',
      body: '',
    });
    const svc = new LibraryService(prisma as any);
    const out = await svc.listCompatibleSkills('t1', []);
    expect(out.map((r) => r.slug)).toContain('free');
  });

  it('is case-insensitive on tool names', async () => {
    const prisma = makePrisma();
    prisma.__skills.push({
      tenantId: null,
      slug: 'lower',
      status: 'active',
      requiredTools: ['read', 'BASH'],
      description: '',
      body: '',
    });
    const svc = new LibraryService(prisma as any);
    const out = await svc.listCompatibleSkills('t1', ['Read', 'Bash']);
    expect(out.map((r) => r.slug)).toContain('lower');
  });
});
