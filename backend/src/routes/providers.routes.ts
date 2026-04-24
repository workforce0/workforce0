/**
 * AI provider credentials — Settings → AI providers.
 *
 * Lets users store per-tenant API keys for Anthropic / Google / OpenAI and
 * any future provider. Pattern inspired by open-notebook's "Add Credential
 * → Test Connection → Register Models" flow.
 *
 *   GET    /api/providers            — list providers + { configured: boolean, last tested }
 *   PUT    /api/providers/:name      — paste / update the API key for one provider
 *   POST   /api/providers/:name/test — verify the stored key works
 *   DELETE /api/providers/:name      — remove the stored key (falls back to env var if set)
 *
 * Keys stored encrypted at rest via ModelRegistryService (AES-256-GCM).
 * Never returned to the client after storage.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'providers' });

const SUPPORTED_PROVIDERS = ['anthropic', 'google', 'openai'] as const;
type ProviderName = (typeof SUPPORTED_PROVIDERS)[number];

function isValidProvider(name: string): name is ProviderName {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(name);
}

const PROVIDER_DISPLAY: Record<ProviderName, { label: string; getKeyUrl: string; docs: string }> = {
  anthropic: {
    label: 'Anthropic Claude',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    docs: 'https://docs.anthropic.com/claude/reference/getting-started-with-the-api',
  },
  google: {
    label: 'Google Gemini',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    docs: 'https://ai.google.dev/docs',
  },
  openai: {
    label: 'OpenAI',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    docs: 'https://platform.openai.com/docs',
  },
};

export async function providerRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/providers
   *
   * Returns the list of supported providers with { configured, label, getKeyUrl }.
   * The actual keys are never returned — just whether one is stored.
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const prisma = fastify.services.prisma;

    const rows = await prisma.modelProvider.findMany({
      where: { tenantId, name: { in: [...SUPPORTED_PROVIDERS] } },
      select: { name: true, apiKeyEnc: true, updatedAt: true },
    });
    const byName = new Map(rows.map((r: any) => [r.name, r]));

    return reply.send({
      success: true,
      data: SUPPORTED_PROVIDERS.map((name) => {
        const row = byName.get(name) as any;
        return {
          name,
          label: PROVIDER_DISPLAY[name].label,
          getKeyUrl: PROVIDER_DISPLAY[name].getKeyUrl,
          docs: PROVIDER_DISPLAY[name].docs,
          configured: Boolean(row?.apiKeyEnc),
          updatedAt: row?.updatedAt ?? null,
        };
      }),
    });
  });

  /**
   * PUT /api/providers/:name
   *
   * Paste / update the API key for a provider. Encrypted at rest.
   * Returns 204 on success; never echoes the key back.
   */
  fastify.put('/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    if (!isValidProvider(name)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'UNKNOWN_PROVIDER', message: `Unknown provider: ${name}` },
      });
    }

    const schema = z.object({ apiKey: z.string().min(1, 'API key cannot be empty') });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'apiKey required' },
      });
    }

    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const prisma = fastify.services.prisma;

    // Upsert the provider row so storeProviderKey can update it
    await prisma.modelProvider.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: { tenantId, name, apiKeyEnc: '' },
    });

    await fastify.services.modelRegistry.storeProviderKey(tenantId, name, parsed.data.apiKey);
    logger.info('Provider key stored', { tenantId, provider: name });

    return reply.status(204).send();
  });

  /**
   * POST /api/providers/:name/test
   *
   * Verify the stored key works by issuing a trivial call to the provider.
   * Returns { ok, error? }.
   */
  fastify.post('/:name/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    if (!isValidProvider(name)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'UNKNOWN_PROVIDER', message: `Unknown provider: ${name}` },
      });
    }

    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const key = await fastify.services.modelRegistry.getProviderKey(tenantId, name);
    if (!key) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_KEY', message: `No ${name} API key stored yet. Paste one first.` },
      });
    }

    try {
      const ok = await testProviderKey(name, key);
      return reply.send({ success: ok, data: { ok } });
    } catch (err) {
      return reply.send({
        success: false,
        data: { ok: false, error: (err as Error).message },
      });
    }
  });

  /**
   * DELETE /api/providers/:name
   *
   * Remove the stored key. Falls back to env var if one is set.
   */
  fastify.delete('/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    if (!isValidProvider(name)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'UNKNOWN_PROVIDER', message: `Unknown provider: ${name}` },
      });
    }

    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const prisma = fastify.services.prisma;
    await prisma.modelProvider.updateMany({
      where: { tenantId, name },
      data: { apiKeyEnc: null },
    });
    logger.info('Provider key cleared', { tenantId, provider: name });
    return reply.status(204).send();
  });
}

/**
 * Minimal per-provider key verification — issues a trivial call and expects
 * a 2xx. Doesn't generate completion text; just tests auth.
 */
async function testProviderKey(name: ProviderName, key: string): Promise<boolean> {
  if (name === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    return res.ok;
  }
  if (name === 'google') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    );
    return res.ok;
  }
  if (name === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${key}` },
    });
    return res.ok;
  }
  return false;
}
