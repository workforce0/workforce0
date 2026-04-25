/**
 * Step 0 setup endpoints — used by the onboarding wizard's new screens.
 *
 * GET  /api/setup/hardware         — detect and return hardware profile
 * GET  /api/setup/state            — return step0Migrated/step0Dismissed flags
 * POST /api/setup/save-step0       — persist wizard choices, set step0Migrated=true
 * POST /api/setup/dismiss-step0    — set step0Dismissed=true
 *
 * @module routes/setup-step0
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ service: 'SetupStep0' });

const SaveBody = z.object({
  meetingBotProvider: z.enum(['vexa', 'recall', 'skip']).optional(),
  recallApiKey: z.string().optional(),
  localTier: z.enum(['light', 'default', 'heavy', 'none']).optional(),
});

interface ServicesShape {
  prisma: {
    tenantSettings: {
      findUnique: (args: {
        where: { tenantId: string };
      }) => Promise<{
        step0Migrated: boolean;
        step0Dismissed: boolean;
        meetingBotProviderId: string | null;
      } | null>;
      upsert: (args: {
        where: { tenantId: string };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  };
  hardwareDetectService: { detect: () => Promise<unknown> };
}

export async function setupStep0Routes(fastify: FastifyInstance): Promise<void> {
  const services = (fastify as unknown as { services: ServicesShape }).services;

  fastify.get('/hardware', async (_req: FastifyRequest, reply: FastifyReply) => {
    const profile = await services.hardwareDetectService.detect();
    return reply.send({ success: true, data: profile });
  });

  fastify.get('/state', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req as FastifyRequest & { tenantId: string }).tenantId;
    const row = await services.prisma.tenantSettings.findUnique({ where: { tenantId } });
    return reply.send({
      success: true,
      data: {
        step0Migrated: row?.step0Migrated ?? false,
        step0Dismissed: row?.step0Dismissed ?? false,
        meetingBotProviderId: row?.meetingBotProviderId ?? null,
      },
    });
  });

  fastify.post('/save-step0', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req as FastifyRequest & { tenantId: string }).tenantId;
    const parsed = SaveBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: parsed.error.message },
      });
    }
    const { meetingBotProvider, localTier } = parsed.data;

    // Compute envHints — values the user (or setup-finish.sh) needs in .env.
    // Backend container can't write to the host .env, so we return them.
    const envHints: Record<string, string> = {};
    const profiles: string[] = [];
    if (meetingBotProvider === 'vexa') profiles.push('meeting-bot');
    if (meetingBotProvider === 'recall' && parsed.data.recallApiKey) {
      envHints.RECALL_API_KEY = parsed.data.recallApiKey;
    }
    if (localTier && localTier !== 'none') {
      profiles.push('local-llm', 'local-stt');
      envHints.OLLAMA_BASE_URL = 'http://ollama:11434';
      envHints.WHISPER_BASE_URL = 'http://whisper:8000';
      const tierModel = {
        light: 'qwen3.5:8b',
        default: 'mistral-small-3:24b',
        heavy: 'qwen3.5:32b',
      }[localTier];
      envHints.OLLAMA_DEFAULT_MODEL = tierModel;
    }
    if (profiles.length > 0) {
      envHints.COMPOSE_PROFILES = profiles.join(',');
    }

    await services.prisma.tenantSettings.upsert({
      where: { tenantId },
      update: {
        step0Migrated: true,
        meetingBotProviderId:
          meetingBotProvider === 'skip' ? null : meetingBotProvider ?? null,
      },
      create: {
        tenantId,
        step0Migrated: true,
        meetingBotProviderId:
          meetingBotProvider === 'skip' ? null : meetingBotProvider ?? null,
      },
    });

    logger.info(
      { tenantId, profiles, hintsCount: Object.keys(envHints).length },
      'Step 0 setup saved',
    );
    return reply.send({ success: true, data: { envHints, profiles } });
  });

  fastify.post('/dismiss-step0', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req as FastifyRequest & { tenantId: string }).tenantId;
    await services.prisma.tenantSettings.upsert({
      where: { tenantId },
      update: { step0Dismissed: true },
      create: { tenantId, step0Dismissed: true },
    });
    return reply.send({ success: true });
  });
}
