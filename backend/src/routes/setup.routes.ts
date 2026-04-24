/**
 * First-run setup wizard routes.
 *
 * The Stitch-designed 4-step onboarding (docs/stitch-prompts/01-setup-wizard.md)
 * writes state through these endpoints:
 *
 *   GET  /api/setup/status   — is this workspace still in setup? What step?
 *   POST /api/setup/complete — mark the wizard finished
 *
 * Step-by-step values (workspace name, AI key, first integration) are
 * written through their specific endpoints (/settings for workspace name,
 * /integrations/:name/connect for the first integration, etc.). This
 * module only tracks the wizard's completion state on the tenant row.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'setup' });

interface TenantSettings {
  setup?: {
    completed?: boolean;
    completedAt?: string;
    completedBy?: string;
  };
  [key: string]: unknown;
}

export async function setupRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/setup/status — whether setup is complete + which step is next.
   */
  fastify.get('/status', async (request, reply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const prisma = fastify.services.prisma;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, settings: true },
    });

    if (!tenant) {
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
    }

    const settings = (tenant.settings ?? {}) as TenantSettings;
    const completed = settings.setup?.completed === true;

    // Check what's been done
    const [aiProviderCount, integrationCount] = await Promise.all([
      prisma.modelProvider.count({ where: { tenantId } }),
      prisma.integrationConnection.count({ where: { tenantId, status: 'connected' } }),
    ]);

    const nextStep = completed
      ? null
      : !tenant.name || tenant.name === 'Untitled Workspace'
        ? 'workspace_name'
        : aiProviderCount === 0
          ? 'ai_provider'
          : integrationCount === 0
            ? 'first_integration'
            : 'finish';

    return reply.send({
      success: true,
      data: {
        completed,
        nextStep,
        workspaceName: tenant.name,
        aiProvidersConfigured: aiProviderCount,
        integrationsConnected: integrationCount,
        completedAt: settings.setup?.completedAt ?? null,
      },
    });
  });

  /**
   * POST /api/setup/complete — mark the first-run wizard complete.
   *
   * Callable multiple times safely; subsequent calls are idempotent.
   */
  fastify.post('/complete', async (request, reply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const userId = (request as FastifyRequest & { userId?: string }).userId;
    const prisma = fastify.services.prisma;

    const schema = z.object({
      workspaceName: z.string().min(1).max(200).optional(),
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'workspaceName must be 1–200 characters' },
      });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    if (!tenant) {
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
    }

    const existing = (tenant.settings ?? {}) as TenantSettings;
    const nextSettings: TenantSettings = {
      ...existing,
      setup: {
        completed: true,
        completedAt: new Date().toISOString(),
        completedBy: userId,
      },
    };

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: nextSettings as any,
        ...(parsed.data.workspaceName ? { name: parsed.data.workspaceName } : {}),
      },
    });

    logger.info('Setup wizard completed', { tenantId, userId });
    return reply.send({ success: true });
  });
}
