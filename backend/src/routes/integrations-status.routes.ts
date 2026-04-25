/**
 * GET /api/integrations/status — aggregates health of all bundled services.
 *
 * Probes Ollama (`/api/tags`), local Whisper (`/health`), and Vexa
 * (`/health`). Each is reported as `up` | `down` | `disabled`, with
 * latency and last error attached. Used by the Step 0 setup wizard
 * and the audit-only web UI status indicators.
 *
 * @module routes/integrations-status
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ service: 'IntegrationsStatus' });

type StatusValue = 'up' | 'down' | 'disabled';

export interface ServiceStatus {
  service: string;
  status: StatusValue;
  latencyMs: number | null;
  lastError: string | null;
}

async function probe(name: string, url: string | undefined, enabled: boolean): Promise<ServiceStatus> {
  if (!enabled || !url) {
    return { service: name, status: 'disabled', latencyMs: null, lastError: null };
  }
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return {
      service: name,
      status: res.ok ? 'up' : 'down',
      latencyMs: Date.now() - t0,
      lastError: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      service: name,
      status: 'down',
      latencyMs: Date.now() - t0,
      lastError: (err as Error).message,
    };
  }
}

interface ConfigShape {
  OLLAMA_BASE_URL?: string;
  WHISPER_BASE_URL?: string;
  VEXA_API_URL?: string;
}

export async function integrationsStatusRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/integrations/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const services = (fastify as unknown as { services: { config?: ConfigShape } }).services;
    const cfg: ConfigShape = services?.config ?? {};

    const results = await Promise.all([
      probe(
        'ollama',
        cfg.OLLAMA_BASE_URL ? `${cfg.OLLAMA_BASE_URL}/api/tags` : undefined,
        !!cfg.OLLAMA_BASE_URL,
      ),
      probe(
        'whisper',
        cfg.WHISPER_BASE_URL ? `${cfg.WHISPER_BASE_URL}/health` : undefined,
        !!cfg.WHISPER_BASE_URL,
      ),
      probe(
        'vexa_api',
        cfg.VEXA_API_URL ? `${cfg.VEXA_API_URL}/health` : undefined,
        !!cfg.VEXA_API_URL,
      ),
    ]);

    logger.debug({ results }, 'Integration health probed');
    return reply.send({ success: true, data: results });
  });
}
