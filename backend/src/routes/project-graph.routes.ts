/**
 * PROJECT GRAPH ROUTES
 * =============================================================================
 *
 *   POST /project-graph/:projectId/build   — build/refresh graph from a repo path
 *   GET  /project-graph/:projectId         — latest cached graph (summary)
 *   GET  /project-graph/:projectId/god-nodes?limit=10
 *   GET  /project-graph/:projectId/callers/:symbol
 *   GET  /project-graph/:projectId/path?from=X&to=Y
 *   GET  /project-graph/:projectId/community/:symbol
 *
 * Every read is tenant-scoped via `request.tenantId`. The build
 * endpoint takes a repo path on the server filesystem — in self-
 * hosted deployments this is fine because the installer decides
 * which paths are exposed. A SaaS deployment would need to run
 * builds via the AgentHub daemon on the user's machine instead;
 * that's not this PR's scope.
 *
 * @module routes/project-graph
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listGodNodes,
  findCallers,
  shortestPath,
  communityMembers,
} from '../services/project-graph/project-graph.service.js';
import type { SerializedGraph } from '../services/project-graph/types.js';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'project-graph' });

const BuildSchema = z.object({
  repoPath: z.string().min(1).max(4096),
  repoLabel: z.string().min(1).max(200).optional(),
});

export async function projectGraphRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/:projectId/build', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { projectId } = request.params as { projectId: string };
    const parsed = BuildSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
      });
    }

    // Tenant ownership check — the projects service enforces scope.
    const project = await fastify.services.projectService.findById(tenantId, projectId);
    if (!project) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }

    try {
      const result = await fastify.services.projectGraphService.buildFromPath(
        tenantId,
        projectId,
        parsed.data.repoPath,
        { repoLabel: parsed.data.repoLabel ?? undefined },
      );
      logger.info('Project graph build complete', {
        tenantId,
        projectId,
        rebuilt: result.rebuilt,
        ...result.stats,
      });
      return reply.send({
        success: true,
        data: { rebuilt: result.rebuilt, stats: result.stats },
      });
    } catch (err) {
      logger.error('Project graph build failed', {
        tenantId,
        projectId,
        error: (err as Error).message,
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'BUILD_FAILED', message: (err as Error).message },
      });
    }
  });

  /** Summary (no full graph blob). Adds an `estimatedTokens` field so
   *  callers know roughly what a full graph read would cost to inject
   *  into an LLM prompt. */
  fastify.get('/:projectId', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { projectId } = request.params as { projectId: string };
    const row = await fastify.services.projectGraphService.getLatest(tenantId, projectId);
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No graph built yet' } });
    }
    return reply.send({
      success: true,
      data: {
        id: row.id,
        projectId: row.projectId,
        nodeCount: row.nodeCount,
        edgeCount: row.edgeCount,
        communityCount: row.communityCount,
        languages: row.languages,
        repoLabel: row.repoLabel,
        updatedAt: row.updatedAt,
      },
    });
  });

  fastify.get('/:projectId/god-nodes', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { projectId } = request.params as { projectId: string };
    const limitRaw = (request.query as any)?.limit;
    const limit = Math.max(1, Math.min(50, limitRaw ? Number(limitRaw) : 10));
    const row = await fastify.services.projectGraphService.getLatest(tenantId, projectId);
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No graph built yet' } });
    }
    const graph = row.graphJson as SerializedGraph;
    return reply.send({ success: true, data: listGodNodes(graph, limit) });
  });

  fastify.get('/:projectId/callers/:symbol', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { projectId, symbol } = request.params as { projectId: string; symbol: string };
    const row = await fastify.services.projectGraphService.getLatest(tenantId, projectId);
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No graph built yet' } });
    }
    const graph = row.graphJson as SerializedGraph;
    return reply.send({ success: true, data: findCallers(graph, symbol) });
  });

  fastify.get('/:projectId/path', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { projectId } = request.params as { projectId: string };
    const q = request.query as { from?: string; to?: string };
    if (!q.from || !q.to) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '?from and ?to are both required' },
      });
    }
    const row = await fastify.services.projectGraphService.getLatest(tenantId, projectId);
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No graph built yet' } });
    }
    const graph = row.graphJson as SerializedGraph;
    return reply.send({ success: true, data: shortestPath(graph, q.from, q.to) });
  });

  fastify.get('/:projectId/community/:symbol', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { projectId, symbol } = request.params as { projectId: string; symbol: string };
    const row = await fastify.services.projectGraphService.getLatest(tenantId, projectId);
    if (!row) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No graph built yet' } });
    }
    const graph = row.graphJson as SerializedGraph;
    return reply.send({ success: true, data: communityMembers(graph, symbol) });
  });
}
