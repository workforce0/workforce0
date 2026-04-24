import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { DomainPromptBuilder, packIntoBudget } from '../domain-prompt.js';

describe('packIntoBudget', () => {
  it('joins terms with comma-space separator', () => {
    expect(packIntoBudget(['a', 'b', 'c'], 100)).toBe('a, b, c');
  });

  it('returns an empty string for no input', () => {
    expect(packIntoBudget([], 100)).toBe('');
  });

  it('trims whitespace and drops empties', () => {
    expect(packIntoBudget(['  a  ', '', 'b'], 100)).toBe('a, b');
  });

  it('stops at the byte budget', () => {
    const terms = ['aaaa', 'bbbb', 'cccc', 'dddd'];
    // "aaaa" (4) + ", bbbb" (6) + ", cccc" (6) = 16; next add is 6 more → would overflow 18.
    const out = packIntoBudget(terms, 18);
    expect(out).toBe('aaaa, bbbb, cccc');
  });

  it('returns the empty string when the budget is too small for even one term', () => {
    expect(packIntoBudget(['longterm'], 3)).toBe('');
  });
});

function makeDeps(opts: {
  skills?: Array<{ slug: string }>;
  prds?: Array<{ title: string }>;
  godNodes?: string[];
  projectGraphThrows?: boolean;
} = {}) {
  return {
    prisma: {
      skillPackage: {
        findMany: vi.fn(async () => opts.skills ?? []),
      },
      pRD: {
        findMany: vi.fn(async () => opts.prds ?? []),
      },
    } as any,
    projectGraphService: {
      getGodNodeNames: vi.fn(async () => {
        if (opts.projectGraphThrows) throw new Error('graph not built');
        return opts.godNodes ?? [];
      }),
    } as any,
  };
}

describe('DomainPromptBuilder', () => {
  it('combines god nodes + skills + PRD titles into a single deduplicated prompt', async () => {
    const deps = makeDeps({
      skills: [{ slug: 'pr-review' }, { slug: 'brand-guidelines' }],
      prds: [{ title: 'Approval Queue v1' }, { title: 'Meeting Upload Flow' }],
      godNodes: ['BAAgentService', 'TicketService', 'QueueService'],
    });
    const builder = new DomainPromptBuilder(deps);
    const prompt = await builder.buildForTenant('t1', 'proj-1');
    expect(prompt).toContain('BAAgentService');
    expect(prompt).toContain('pr-review');
    expect(prompt).toContain('Approval Queue v1');
  });

  it('deduplicates when the same term appears in multiple sources', async () => {
    const deps = makeDeps({
      skills: [{ slug: 'brand-guidelines' }],
      prds: [{ title: 'brand-guidelines' }],
      godNodes: ['brand-guidelines'],
    });
    const builder = new DomainPromptBuilder(deps);
    const prompt = await builder.buildForTenant('t1');
    // Should show up once, not thrice.
    const matches = prompt.split('brand-guidelines').length - 1;
    expect(matches).toBe(1);
  });

  it('skips the god-nodes lookup when no projectId is given', async () => {
    const deps = makeDeps({ godNodes: ['ShouldNotAppear'] });
    const builder = new DomainPromptBuilder(deps);
    const prompt = await builder.buildForTenant('t1'); // no projectId
    expect(deps.projectGraphService.getGodNodeNames).not.toHaveBeenCalled();
    expect(prompt).not.toContain('ShouldNotAppear');
  });

  it('continues when the god-nodes lookup throws (non-fatal)', async () => {
    const deps = makeDeps({
      projectGraphThrows: true,
      skills: [{ slug: 'fallback-skill' }],
    });
    const builder = new DomainPromptBuilder(deps);
    const prompt = await builder.buildForTenant('t1', 'proj-1');
    expect(prompt).toBe('fallback-skill');
  });

  it('returns an empty string when every source is empty or failing', async () => {
    const deps = makeDeps({ projectGraphThrows: true });
    const builder = new DomainPromptBuilder(deps);
    expect(await builder.buildForTenant('t1', 'proj-1')).toBe('');
  });

  it('respects the 900-char budget on very long term lists', async () => {
    const manyGods = Array.from({ length: 200 }, (_, i) => `VeryLongNodeNameNumber${i}`);
    const deps = makeDeps({ godNodes: manyGods });
    const builder = new DomainPromptBuilder(deps);
    const prompt = await builder.buildForTenant('t1', 'proj-1');
    expect(prompt.length).toBeLessThanOrEqual(900);
  });
});
