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

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ service: 'SetupStep0' });

const SaveBody = z.object({
  meetingBotProvider: z.enum(['vexa', 'skip']).optional(),
  vexaApiUrl: z.string().url().optional(),
  localTier: z.enum(['light', 'default', 'heavy', 'none']).optional(),
  voiceIntake: z
    .object({
      enabled: z.boolean(),
      twilioNumber: z.string().optional(),
      callerAllowlist: z.array(z.string()).default([]),
      pin: z.string().min(4).max(8).optional(),
    })
    .optional(),
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
    const { meetingBotProvider, localTier, voiceIntake } = parsed.data;

    // Compute envHints — values the user (or setup-finish.sh) needs in .env.
    // Backend container can't write to the host .env, so we return them.
    const envHints: Record<string, string> = {};
    const profiles: string[] = [];
    // Vexa is BYO — the user runs their own Vexa instance and points
    // VEXA_API_URL at it. No bundled profile to enable.
    if (meetingBotProvider === 'vexa' && parsed.data.vexaApiUrl) {
      envHints.VEXA_API_URL = parsed.data.vexaApiUrl;
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

    // Voice intake (Plan voice-intake-pipecat). Enabled means: turn on the
    // local-voice compose profile and surface the env vars the operator
    // needs to wire Twilio (WEBHOOK_BASE_HOST) and the bridge JWT secret.
    // PIN gets hashed with argon2 and stored alongside the allowlist on the
    // tenant row so CallerAuthService can verify against it later.
    let voicePinHash: string | undefined;
    if (voiceIntake?.enabled) {
      profiles.push('local-voice');
      // Pre-generate a strong shared secret for the bridge so the operator
      // can paste it directly into .env without having to run openssl.
      envHints.BRIDGE_JWT_SECRET = crypto.randomBytes(32).toString('hex');
      // Public hostname Twilio will hit; operator must replace this with
      // their actual deployment URL.
      envHints.WEBHOOK_BASE_HOST = 'https://your-deployment.example.com';
      if (voiceIntake.pin) {
        voicePinHash = await argon2.hash(voiceIntake.pin);
      }
    }

    if (profiles.length > 0) {
      envHints.COMPOSE_PROFILES = profiles.join(',');
    }

    const baseSettings = {
      step0Migrated: true,
      meetingBotProviderId:
        meetingBotProvider === 'skip' ? null : meetingBotProvider ?? null,
    };
    const voiceSettings: Record<string, unknown> = {};
    if (voiceIntake?.enabled) {
      voiceSettings.voiceCallerAllowlist = voiceIntake.callerAllowlist;
      if (voicePinHash !== undefined) {
        voiceSettings.voicePinHash = voicePinHash;
      }
    }

    await services.prisma.tenantSettings.upsert({
      where: { tenantId },
      update: { ...baseSettings, ...voiceSettings },
      create: { tenantId, ...baseSettings, ...voiceSettings },
    });

    // Log only non-sensitive metadata. We deliberately do not log envHints
    // values to satisfy CodeQL's taint analysis and avoid leaking
    // user-supplied URLs into log aggregators. The keys themselves
    // (e.g. VEXA_API_URL) are static names — no secret material — but we
    // still pass a hand-built whitelist instead of Object.keys(envHints)
    // so the log statement has no data-flow dependency on user input.
    const hintKeysLogged = profiles.slice();
    if (envHints.VEXA_API_URL) hintKeysLogged.push('VEXA_API_URL');
    if (envHints.OLLAMA_DEFAULT_MODEL) hintKeysLogged.push('OLLAMA_DEFAULT_MODEL');
    if (envHints.BRIDGE_JWT_SECRET) hintKeysLogged.push('BRIDGE_JWT_SECRET');
    if (envHints.WEBHOOK_BASE_HOST) hintKeysLogged.push('WEBHOOK_BASE_HOST');
    logger.info(
      { tenantId, profiles, hintKeys: hintKeysLogged },
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
