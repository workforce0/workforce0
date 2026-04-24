/**
 * Unit tests for Model Config Routes
 *
 * Tests:
 * - GET /config: get tenant model config (200, tenant scoping)
 * - PUT /config: update model assignments (200, 400 invalid model, validation)
 * - GET /available: list available models (200)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { modelConfigRoutes } from '../model-config.routes.js';

const TENANT_A = 'tenant-aaa';

function createMockPrisma() {
  return {
    agentConfig: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockImplementation(({ create, update }: any) => ({
        id: 'agent-config-1',
        ...create,
        ...update,
      })),
    },
    modelProvider: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    modelConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

async function buildApp(
  prisma: ReturnType<typeof createMockPrisma>,
  tenantId: string = TENANT_A,
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('services', { prisma } as any);

  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = tenantId;
    (request as any).userRole = 'owner';
  });

  await app.register(modelConfigRoutes);
  await app.ready();
  return app;
}

describe('Model Config Routes', () => {
  let app: FastifyInstance;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    app = await buildApp(mockPrisma);
  });

  // =========================================================================
  // GET /config
  // =========================================================================
  describe('GET /config', () => {
    it('returns agent configs and providers for the tenant', async () => {
      const agentConfigs = [
        {
          id: 'ac-1',
          tenantId: TENANT_A,
          agentType: 'ba_agent',
          primaryModelId: 'model-1',
          preset: 'recommended',
        },
      ];
      const providers = [
        {
          id: 'prov-1',
          tenantId: TENANT_A,
          name: 'Google',
          isActive: true,
          models: [{ id: 'model-1', modelId: 'gemini-2.0-flash', displayName: 'Gemini Flash' }],
        },
      ];

      mockPrisma.agentConfig.findMany.mockResolvedValue(agentConfigs);
      mockPrisma.modelProvider.findMany.mockResolvedValue(providers);

      const res = await app.inject({ method: 'GET', url: '/config' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.agents).toHaveLength(1);
      expect(body.data.agents[0].agentType).toBe('ba_agent');
      expect(body.data.providers).toHaveLength(1);
      expect(body.data.providers[0].name).toBe('Google');
    });

    it('returns empty agents and providers when none configured', async () => {
      const res = await app.inject({ method: 'GET', url: '/config' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.agents).toEqual([]);
      expect(body.data.providers).toEqual([]);
    });

    it('scopes queries to tenant', async () => {
      await app.inject({ method: 'GET', url: '/config' });

      expect(mockPrisma.agentConfig.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_A },
        orderBy: { agentType: 'asc' },
      });
      expect(mockPrisma.modelProvider.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_A, isActive: true },
        include: { models: { where: { isActive: true } } },
      });
    });
  });

  // =========================================================================
  // PUT /config
  // =========================================================================
  describe('PUT /config', () => {
    const validPayload = {
      agentType: 'ba_agent',
      primaryModelId: 'model-1',
    };

    it('updates model config when primary model exists', async () => {
      mockPrisma.modelConfig.findFirst.mockResolvedValue({
        id: 'model-1',
        tenantId: TENANT_A,
        modelId: 'gemini-2.0-flash',
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/config',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(mockPrisma.agentConfig.upsert).toHaveBeenCalled();
    });

    it('returns 400 when primary model not found for tenant', async () => {
      // Default mock returns null for findFirst
      const res = await app.inject({
        method: 'PUT',
        url: '/config',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_MODEL');
      expect(mockPrisma.agentConfig.upsert).not.toHaveBeenCalled();
    });

    it('validates reviewer models exist for tenant', async () => {
      mockPrisma.modelConfig.findFirst.mockResolvedValue({
        id: 'model-1',
        tenantId: TENANT_A,
      });
      // Only 1 reviewer found out of 2 requested
      mockPrisma.modelConfig.findMany.mockResolvedValue([
        { id: 'rev-1', tenantId: TENANT_A },
      ]);

      const res = await app.inject({
        method: 'PUT',
        url: '/config',
        payload: {
          ...validPayload,
          reviewerModelIds: ['rev-1', 'rev-nonexistent'],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_MODEL');
      expect(res.json().error.message).toContain('reviewer');
    });

    it('accepts valid reviewer models', async () => {
      mockPrisma.modelConfig.findFirst.mockResolvedValue({
        id: 'model-1',
        tenantId: TENANT_A,
      });
      mockPrisma.modelConfig.findMany.mockResolvedValue([
        { id: 'rev-1', tenantId: TENANT_A },
        { id: 'rev-2', tenantId: TENANT_A },
      ]);

      const res = await app.inject({
        method: 'PUT',
        url: '/config',
        payload: {
          ...validPayload,
          reviewerModelIds: ['rev-1', 'rev-2'],
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it('accepts optional confidenceThreshold and maxSteps', async () => {
      mockPrisma.modelConfig.findFirst.mockResolvedValue({
        id: 'model-1',
        tenantId: TENANT_A,
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/config',
        payload: {
          ...validPayload,
          confidenceThreshold: 0.7,
          maxSteps: 50,
          preset: 'premium',
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it('rejects invalid agentType', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/config',
        payload: {
          agentType: 'nonexistent_agent',
          primaryModelId: 'model-1',
        },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('rejects empty primaryModelId', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/config',
        payload: {
          agentType: 'ba_agent',
          primaryModelId: '',
        },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('rejects missing required fields', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/config',
        payload: {},
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('rejects confidenceThreshold outside 0-1 range', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/config',
        payload: {
          ...validPayload,
          confidenceThreshold: 1.5,
        },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('rejects maxSteps above 200', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/config',
        payload: {
          ...validPayload,
          maxSteps: 500,
        },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('verifies model lookup uses tenantId', async () => {
      await app.inject({
        method: 'PUT',
        url: '/config',
        payload: validPayload,
      });

      expect(mockPrisma.modelConfig.findFirst).toHaveBeenCalledWith({
        where: { id: 'model-1', tenantId: TENANT_A },
      });
    });
  });

  // =========================================================================
  // GET /available
  // =========================================================================
  describe('GET /available', () => {
    it('returns providers and models for the tenant', async () => {
      const providers = [
        { id: 'prov-1', name: 'Google', isActive: true },
      ];
      const models = [
        {
          id: 'model-1',
          modelId: 'gemini-2.0-flash',
          displayName: 'Gemini Flash',
          costInput: 0.01,
          costOutput: 0.03,
          provider: { id: 'prov-1', name: 'Google' },
        },
      ];

      mockPrisma.modelProvider.findMany.mockResolvedValue(providers);
      mockPrisma.modelConfig.findMany.mockResolvedValue(models);

      const res = await app.inject({ method: 'GET', url: '/available' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.providers).toHaveLength(1);
      expect(body.data.models).toHaveLength(1);
      expect(body.data.models[0].displayName).toBe('Gemini Flash');
    });

    it('returns empty lists when no providers or models configured', async () => {
      const res = await app.inject({ method: 'GET', url: '/available' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.providers).toEqual([]);
      expect(body.data.models).toEqual([]);
    });

    it('scopes queries to tenant and only active entries', async () => {
      await app.inject({ method: 'GET', url: '/available' });

      expect(mockPrisma.modelProvider.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_A, isActive: true },
        orderBy: { name: 'asc' },
      });
      expect(mockPrisma.modelConfig.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_A, isActive: true },
        include: { provider: true },
        orderBy: { displayName: 'asc' },
      });
    });
  });
});
