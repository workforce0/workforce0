/**
 * Live meeting capture API — Step 4.
 *
 *   POST   /api/meetings/live/start             — begin capturing
 *   POST   /api/meetings/live/:id/chunks        — append a transcript chunk (server-side STT worker)
 *   GET    /api/meetings/live/:id               — session state
 *   POST   /api/meetings/live/:id/end           — finalize, write Meeting row, enqueue BA
 *
 * The browser UI uses start + end. The server's streaming-STT worker
 * (Gemini Live adapter, ships separately) pushes transcript chunks to
 * /chunks as it processes the audio stream.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

export async function liveCaptureRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const userId = (request as FastifyRequest & { userId?: string }).userId ?? 'unknown';
    const schema = z.object({ title: z.string().max(200).optional() });
    const parsed = schema.safeParse(request.body ?? {});
    const title = parsed.success ? parsed.data.title ?? '' : '';
    const session = await fastify.services.liveCaptureService.start({
      tenantId,
      userId,
      title,
    });
    return reply.status(201).send({ success: true, data: session });
  });

  fastify.post('/:id/chunks', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({
      text: z.string().min(1),
      speaker: z.string().optional(),
      at: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'text required' },
      });
    }
    try {
      await fastify.services.liveCaptureService.appendChunk(id, {
        text: parsed.data.text,
        speaker: parsed.data.speaker,
        at: parsed.data.at ?? new Date().toISOString(),
      });
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(404).send({
        success: false,
        error: { code: 'SESSION_NOT_FOUND', message: (err as Error).message },
      });
    }
  });

  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const session = await fastify.services.liveCaptureService.get(id);
    if (!session) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found or expired' },
      });
    }
    const chunkCount = await fastify.services.liveCaptureService.chunkCount(id);
    return reply.send({ success: true, data: { ...session, chunkCount } });
  });

  fastify.post('/:id/end', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await fastify.services.liveCaptureService.end(id);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.status(404).send({
        success: false,
        error: { code: 'SESSION_NOT_FOUND', message: (err as Error).message },
      });
    }
  });
}
