import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { attachGraphStaleness } from '../library.routes.js';

/**
 * PG.13 — `attachGraphStaleness` computes one of three `graphStale`
 * states for every plan in the audit list:
 *
 *   true   — plan captured a hash that no longer matches the live graph
 *   false  — plan's captured hash matches the live graph (fresh)
 *   null   — no captured hash OR no live graph (badge stays hidden)
 */
describe('attachGraphStaleness', () => {
  function makePrisma(tickets: any[], graphs: any[]) {
    return {
      ticket: {
        findMany: vi.fn(async () => tickets),
      },
      projectGraph: {
        findMany: vi.fn(async () => graphs),
      },
    };
  }

  it('returns the input as-is for an empty plan list', async () => {
    const prisma = makePrisma([], []);
    const out = await attachGraphStaleness(prisma, 't1', []);
    expect(out).toEqual([]);
    expect(prisma.ticket.findMany).not.toHaveBeenCalled();
  });

  it('marks graphStale:true when the stamped hash no longer matches the live graph', async () => {
    const prisma = makePrisma(
      [{ id: 'tk-1', projectId: 'proj-1' }],
      [{ projectId: 'proj-1', contentHash: 'new-hash' }],
    );
    const out = await attachGraphStaleness(prisma, 't1', [
      { id: 'p-1', parentTicketId: 'tk-1', graphContentHash: 'old-hash' },
    ]);
    expect(out[0].graphStale).toBe(true);
  });

  it('marks graphStale:false when the stamped hash matches the live graph', async () => {
    const prisma = makePrisma(
      [{ id: 'tk-1', projectId: 'proj-1' }],
      [{ projectId: 'proj-1', contentHash: 'same-hash' }],
    );
    const out = await attachGraphStaleness(prisma, 't1', [
      { id: 'p-1', parentTicketId: 'tk-1', graphContentHash: 'same-hash' },
    ]);
    expect(out[0].graphStale).toBe(false);
  });

  it('marks graphStale:null when the plan never captured a hash', async () => {
    const prisma = makePrisma(
      [{ id: 'tk-1', projectId: 'proj-1' }],
      [{ projectId: 'proj-1', contentHash: 'any' }],
    );
    const out = await attachGraphStaleness(prisma, 't1', [
      { id: 'p-1', parentTicketId: 'tk-1', graphContentHash: null },
    ]);
    expect(out[0].graphStale).toBeNull();
  });

  it('marks graphStale:null when the project no longer has a graph (deleted / never built)', async () => {
    const prisma = makePrisma(
      [{ id: 'tk-1', projectId: 'proj-1' }],
      [], // no graph for this project
    );
    const out = await attachGraphStaleness(prisma, 't1', [
      { id: 'p-1', parentTicketId: 'tk-1', graphContentHash: 'h' },
    ]);
    expect(out[0].graphStale).toBeNull();
  });

  it('marks graphStale:null when the parent ticket is missing a projectId (org-level)', async () => {
    const prisma = makePrisma(
      [{ id: 'tk-1', projectId: null }],
      [],
    );
    const out = await attachGraphStaleness(prisma, 't1', [
      { id: 'p-1', parentTicketId: 'tk-1', graphContentHash: 'h' },
    ]);
    expect(out[0].graphStale).toBeNull();
  });

  it('handles a mix of plans across multiple projects in a single pass', async () => {
    const prisma = makePrisma(
      [
        { id: 'tk-1', projectId: 'proj-1' },
        { id: 'tk-2', projectId: 'proj-2' },
      ],
      [
        { projectId: 'proj-1', contentHash: 'fresh-1' },
        { projectId: 'proj-2', contentHash: 'fresh-2' },
      ],
    );
    const out = await attachGraphStaleness(prisma, 't1', [
      { id: 'p-a', parentTicketId: 'tk-1', graphContentHash: 'fresh-1' }, // matches
      { id: 'p-b', parentTicketId: 'tk-1', graphContentHash: 'stale' },   // stale
      { id: 'p-c', parentTicketId: 'tk-2', graphContentHash: null },      // null
    ]);
    expect(out.map((p: any) => p.graphStale)).toEqual([false, true, null]);
    // One projectGraph.findMany call covering both unique projects.
    expect(prisma.projectGraph.findMany).toHaveBeenCalledTimes(1);
  });

  it('reuses a caller-supplied parents map without re-fetching tickets', async () => {
    const prisma = makePrisma(
      [], // deliberately empty — ticket.findMany must NOT be called
      [{ projectId: 'proj-1', contentHash: 'fresh' }],
    );
    const parentsMap = new Map<string, any>([
      ['tk-1', { id: 'tk-1', projectId: 'proj-1' }],
    ]);
    const out = await attachGraphStaleness(
      prisma,
      't1',
      [{ id: 'p-1', parentTicketId: 'tk-1', graphContentHash: 'fresh' }],
      parentsMap,
    );
    expect(out[0].graphStale).toBe(false);
    expect(prisma.ticket.findMany).not.toHaveBeenCalled();
  });
});
