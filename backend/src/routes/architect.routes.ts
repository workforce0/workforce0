/**
 * Architect API — on-demand architectural design from an approved PRD.
 *
 *   POST /api/architect/:prdId/design  — run the architect, store result on PRD
 *   GET  /api/architect/:prdId/design  — read the stored design
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function architectRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/:prdId/design', async (request: FastifyRequest, reply: FastifyReply) => {
    const { prdId } = request.params as { prdId: string };
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    try {
      const design = await fastify.services.architectService.designFromPrd(prdId, tenantId);
      return reply.send({ success: true, data: design });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : msg.includes('not approved') ? 400 : 500;
      return reply.status(status).send({
        success: false,
        error: { code: 'ARCHITECT_FAILED', message: msg },
      });
    }
  });

  fastify.get('/:prdId/design', async (request: FastifyRequest, reply: FastifyReply) => {
    const { prdId } = request.params as { prdId: string };
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const design = await fastify.services.architectService.getDesign(prdId, tenantId);
    if (!design) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No design yet. Run POST /design first.' },
      });
    }
    return reply.send({ success: true, data: design });
  });
}
