/**
 * LIBRARY ROUTES (M7.3 — audit-only)
 * =============================================================================
 *
 *   GET /library/skills            — list skills (+ optional ?active=1 filter)
 *   GET /library/skills/:slug      — fetch one (for detail panel)
 *   GET /library/subagents         — list subagents
 *   GET /library/subagents/:slug   — fetch one
 *
 * All read-only. The user never writes from the UI — vendored content
 * is the source of truth. A separate approval endpoint could be added
 * later for `community` / `user` source rows.
 *
 * @module routes/library
 */

import type { FastifyInstance } from 'fastify';

export async function libraryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/skills', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const prisma = fastify.services.prisma as any;
    const rows = await prisma.skillPackage.findMany({
      where: { status: 'active', OR: [{ tenantId }, { tenantId: null }] },
      orderBy: { slug: 'asc' },
    });
    return reply.send({ success: true, data: rows });
  });

  fastify.get('/skills/:slug', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { slug } = request.params as { slug: string };
    const row = await fastify.services.libraryService.getSkillBySlug(tenantId, slug);
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Skill not found' } });
    }
    return reply.send({ success: true, data: row });
  });

  fastify.get('/subagents', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const prisma = fastify.services.prisma as any;
    const rows = await prisma.subagentDefinition.findMany({
      where: { status: 'active', OR: [{ tenantId }, { tenantId: null }] },
      orderBy: [{ category: 'asc' }, { slug: 'asc' }],
    });
    return reply.send({ success: true, data: rows });
  });

  fastify.get('/subagents/:slug', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { slug } = request.params as { slug: string };
    const row = await fastify.services.libraryService.getSubagentBySlug(tenantId, slug);
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Subagent not found' } });
    }
    return reply.send({ success: true, data: row });
  });

  fastify.get('/plans/:ticketId', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { ticketId } = request.params as { ticketId: string };
    const prisma = fastify.services.prisma as any;
    const rows = await prisma.executionPlan.findMany({
      where: { tenantId, parentTicketId: ticketId },
      orderBy: { attempt: 'asc' },
    });
    const enriched = await attachGraphStaleness(prisma, tenantId, rows);
    return reply.send({ success: true, data: enriched });
  });

  /** Recent plans across all parent tickets — audit view. */
  fastify.get('/plans', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const prisma = fastify.services.prisma as any;
    const plans = await prisma.executionPlan.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const parentIds = Array.from(new Set(plans.map((p: any) => p.parentTicketId)));
    const parents = parentIds.length
      ? await prisma.ticket.findMany({
          where: { id: { in: parentIds }, tenantId },
          select: { id: true, title: true, status: true, projectId: true },
        })
      : [];
    const parentsById = new Map<string, any>(parents.map((t: any) => [t.id as string, t]));
    const enriched = await attachGraphStaleness(prisma, tenantId, plans, parentsById);
    return reply.send({
      success: true,
      data: enriched.map((p: any) => ({
        ...p,
        parent: parentsById.get(p.parentTicketId)
          ? (() => {
              const t = parentsById.get(p.parentTicketId) as any;
              return { id: t.id, title: t.title, status: t.status };
            })()
          : null,
      })),
    });
  });
}

/**
 * PG.13: annotate plans with a graph-staleness flag.
 *
 * For each plan we look up the project that owns its parent ticket,
 * then the current ProjectGraph.contentHash for that project. If the
 * plan stamped a `graphContentHash` at build time and it no longer
 * matches the live graph, we mark the plan `graphStale: true`. If the
 * plan never carried a hash (no graph at build time) or the project
 * has no graph, `graphStale` is null — the badge stays hidden.
 *
 * Done in two queries (tickets + project_graphs) regardless of plan
 * count so the audit list stays fast.
 */
export async function attachGraphStaleness(
  prisma: any,
  tenantId: string,
  plans: any[],
  parentsById?: Map<string, any>,
): Promise<any[]> {
  if (plans.length === 0) return plans;
  // Reuse the caller's parent map when they already fetched it.
  let byTicket = parentsById;
  if (!byTicket) {
    const parentIds = Array.from(new Set(plans.map((p) => p.parentTicketId)));
    const tickets = await prisma.ticket.findMany({
      where: { id: { in: parentIds }, tenantId },
      select: { id: true, projectId: true },
    });
    byTicket = new Map(tickets.map((t: any) => [t.id, t]));
  }
  const projectIds = Array.from(
    new Set(
      Array.from(byTicket.values())
        .map((t: any) => t?.projectId)
        .filter(Boolean) as string[],
    ),
  );
  const graphs: Array<{ projectId: string; contentHash: string }> = projectIds.length
    ? await prisma.projectGraph.findMany({
        where: { tenantId, projectId: { in: projectIds } },
        select: { projectId: true, contentHash: true },
      })
    : [];
  const hashByProject = new Map(graphs.map((g) => [g.projectId, g.contentHash]));
  return plans.map((p) => {
    const parent = byTicket!.get(p.parentTicketId);
    const projectId: string | null = parent?.projectId ?? null;
    const currentHash = projectId ? hashByProject.get(projectId) ?? null : null;
    // Badge rules:
    //  - `graphStale: true`   — plan stamped a hash that no longer matches current graph
    //  - `graphStale: false`  — plan stamped a hash that matches current graph
    //  - `graphStale: null`   — either plan never captured a hash, or no graph exists
    let graphStale: boolean | null;
    if (!p.graphContentHash || !currentHash) {
      graphStale = null;
    } else {
      graphStale = p.graphContentHash !== currentHash;
    }
    return { ...p, graphStale };
  });
}
