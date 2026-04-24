import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

const chatMock = vi.fn();
vi.mock('../../agent-runtime/clients/client-factory.js', () => ({
  createModelClient: vi.fn(() => ({ chat: chatMock })),
}));

import { PRDSymbolLinker, parseLinkerResponse } from '../prd-symbol-linker.js';
import type { SerializedGraph } from '../types.js';

describe('parseLinkerResponse', () => {
  it('parses a valid JSON response', () => {
    const out = parseLinkerResponse(
      JSON.stringify({ links: [{ symbolName: 'Foo', confidence: 0.8 }] }),
    );
    expect(out?.links[0].symbolName).toBe('Foo');
  });

  it('strips a ```json fence', () => {
    const out = parseLinkerResponse(
      '```json\n{"links":[{"symbolName":"X","confidence":0.5}]}\n```',
    );
    expect(out?.links).toHaveLength(1);
  });

  it('returns null for prose', () => {
    expect(parseLinkerResponse('sure, I can help with that')).toBeNull();
  });

  it('returns null for confidence out of range', () => {
    expect(
      parseLinkerResponse(JSON.stringify({ links: [{ symbolName: 'X', confidence: 1.5 }] })),
    ).toBeNull();
  });

  it('caps at 12 links via schema', () => {
    const over = { links: Array.from({ length: 20 }, () => ({ symbolName: 'X', confidence: 0.5 })) };
    expect(parseLinkerResponse(JSON.stringify(over))).toBeNull();
  });

  it('accepts an empty links array', () => {
    expect(parseLinkerResponse(JSON.stringify({ links: [] }))).toEqual({ links: [] });
  });
});

function fakeGraph(nodes: Array<{ name: string; degree?: number; id?: string }>): SerializedGraph {
  return {
    version: 1,
    nodes: nodes.map((n, i) => ({
      id: n.id ?? `a:function:${n.name}`,
      kind: 'function',
      name: n.name,
      file: 'a',
      line: i + 1,
      degree: n.degree ?? 1,
      community: 0,
    })),
    edges: [],
    communities: [],
    stats: { nodeCount: nodes.length, edgeCount: 0, extractedEdges: 0, inferredEdges: 0, fileCount: 1 },
  };
}

function makePrisma(opts: {
  graph?: SerializedGraph | null;
  upsertFail?: boolean;
} = {}) {
  const upserts: any[] = [];
  return {
    upserts,
    projectGraph: {
      findFirst: vi.fn(async () => (opts.graph ? { graphJson: opts.graph } : null)),
    },
    pRDSymbolLink: {
      upsert: vi.fn(async (args: any) => {
        if (opts.upsertFail) throw new Error('db error');
        upserts.push(args);
        return { id: `lnk-${upserts.length}`, ...args.create };
      }),
    },
  };
}

function makeRegistry(resolved: any) {
  return {
    resolveModel: vi.fn(async () => resolved),
  };
}

describe('PRDSymbolLinker.linkPrd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatMock.mockReset();
  });

  const basePrd = {
    tenantId: 't1',
    prdId: 'prd-1',
    projectId: 'proj-1',
    title: 'Approval Queue',
    summary: 'Two-pane inbox for product leaders',
  };

  it('skips when the PRD has no projectId', async () => {
    const prisma = makePrisma();
    const linker = new PRDSymbolLinker({ prisma: prisma as any, modelRegistry: {} as any });
    const r = await linker.linkPrd({ ...basePrd, projectId: null });
    expect(r.skipped).toBe(true);
    expect(r.skipReason).toMatch(/no projectId/i);
    expect(prisma.projectGraph.findFirst).not.toHaveBeenCalled();
  });

  it('skips when no project graph exists for the tenant', async () => {
    const prisma = makePrisma({ graph: null });
    const linker = new PRDSymbolLinker({ prisma: prisma as any, modelRegistry: {} as any });
    const r = await linker.linkPrd(basePrd);
    expect(r.skipped).toBe(true);
    expect(r.skipReason).toMatch(/no project graph built/i);
  });

  it('skips when ModelRegistry throws (no model configured)', async () => {
    const prisma = makePrisma({
      graph: fakeGraph([{ name: 'A' }, { name: 'B' }]),
    });
    const registry = { resolveModel: vi.fn(async () => { throw new Error('not configured'); }) };
    const linker = new PRDSymbolLinker({ prisma: prisma as any, modelRegistry: registry as any });
    const r = await linker.linkPrd(basePrd);
    expect(r.skipped).toBe(true);
    expect(r.skipReason).toMatch(/no LLM configured/i);
  });

  it('skips when the resolved model has no API key', async () => {
    const prisma = makePrisma({ graph: fakeGraph([{ name: 'A' }]) });
    const registry = makeRegistry({ modelId: 'x', provider: 'google' /* no apiKeyEnc */ });
    const linker = new PRDSymbolLinker({ prisma: prisma as any, modelRegistry: registry as any });
    const r = await linker.linkPrd(basePrd);
    expect(r.skipped).toBe(true);
    expect(r.skipReason).toMatch(/no API key/i);
  });

  it('skips when the linker LLM call fails', async () => {
    const prisma = makePrisma({ graph: fakeGraph([{ name: 'A' }]) });
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'key',
    });
    chatMock.mockRejectedValue(new Error('network'));
    const linker = new PRDSymbolLinker({ prisma: prisma as any, modelRegistry: registry as any });
    const r = await linker.linkPrd(basePrd);
    expect(r.skipped).toBe(true);
    expect(r.skipReason).toMatch(/linker LLM call failed/i);
  });

  it('creates links for each valid LLM-proposed symbol', async () => {
    const prisma = makePrisma({
      graph: fakeGraph([
        { name: 'TicketService', degree: 10 },
        { name: 'ApprovalQueue', degree: 8 },
        { name: 'Unrelated', degree: 1 },
      ]),
    });
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'key',
    });
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        links: [
          { symbolName: 'TicketService', confidence: 0.9 },
          { symbolName: 'ApprovalQueue', confidence: 0.8 },
        ],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const linker = new PRDSymbolLinker({ prisma: prisma as any, modelRegistry: registry as any });
    const r = await linker.linkPrd(basePrd);
    expect(r.skipped).toBe(false);
    expect(r.linksCreated).toHaveLength(2);
    expect(r.linksCreated[0].symbolName).toBe('TicketService');
    expect(prisma.upserts).toHaveLength(2);
  });

  it('drops symbol names the model invented (not in the graph)', async () => {
    const prisma = makePrisma({
      graph: fakeGraph([{ name: 'RealThing', degree: 5 }]),
    });
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'key',
    });
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        links: [
          { symbolName: 'RealThing', confidence: 0.9 },
          { symbolName: 'MadeUpSymbol', confidence: 0.7 },
        ],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const linker = new PRDSymbolLinker({ prisma: prisma as any, modelRegistry: registry as any });
    const r = await linker.linkPrd(basePrd);
    expect(r.linksCreated).toHaveLength(1);
    expect(r.linksCreated[0].symbolName).toBe('RealThing');
  });

  it('prefers the highest-degree match when multiple symbols share a name', async () => {
    const prisma = makePrisma({
      graph: fakeGraph([
        { name: 'Svc', id: 'a:function:Svc', degree: 1 },
        { name: 'Svc', id: 'b:function:Svc', degree: 15 },
      ]),
    });
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'key',
    });
    chatMock.mockResolvedValue({
      content: JSON.stringify({ links: [{ symbolName: 'Svc', confidence: 0.8 }] }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const linker = new PRDSymbolLinker({ prisma: prisma as any, modelRegistry: registry as any });
    const r = await linker.linkPrd(basePrd);
    expect(r.linksCreated).toHaveLength(1);
    expect(r.linksCreated[0].symbolId).toBe('b:function:Svc');
  });

  it('skips gracefully when the linker returns unparseable JSON', async () => {
    const prisma = makePrisma({ graph: fakeGraph([{ name: 'A' }]) });
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'key',
    });
    chatMock.mockResolvedValue({
      content: 'the brief looks good to me',
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const linker = new PRDSymbolLinker({ prisma: prisma as any, modelRegistry: registry as any });
    const r = await linker.linkPrd(basePrd);
    expect(r.skipped).toBe(true);
    expect(r.skipReason).toMatch(/no links/i);
  });

  it('swallows individual upsert failures and reports the rest', async () => {
    const prisma = makePrisma({
      graph: fakeGraph([{ name: 'Real' }]),
      upsertFail: true,
    });
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'key',
    });
    chatMock.mockResolvedValue({
      content: JSON.stringify({ links: [{ symbolName: 'Real', confidence: 0.9 }] }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const linker = new PRDSymbolLinker({ prisma: prisma as any, modelRegistry: registry as any });
    const r = await linker.linkPrd(basePrd);
    expect(r.skipped).toBe(false);
    expect(r.linksCreated).toHaveLength(0); // upsert failed, but no throw
  });
});
