/**
 * Unit tests for Engagement Routes
 *
 * Tests:
 * - GET /: list engagements for tenant (200, status filter)
 * - GET /:id: get engagement details (200, 404, tenant isolation)
 * - POST /:id/advance: advance phase (200, 400 invalid transition, 404)
 * - POST /:id/ship: mark as shipped (200, 400 wrong phase, 404)
 * - POST /:id/pause: pause engagement (200, 404)
 * - POST /:id/resume: resume engagement (200, 404)
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

vi.mock('../../services/engagement/engagement.service.js', () => {
  const EngagementService = vi.fn();
  EngagementService.prototype.listByTenant = vi.fn();
  EngagementService.prototype.get = vi.fn();
  EngagementService.prototype.advancePhase = vi.fn();
  EngagementService.prototype.pause = vi.fn();
  EngagementService.prototype.resume = vi.fn();
  return { EngagementService };
});

import { engagementRoutes } from '../engagements.routes.js';
import { EngagementService } from '../../services/engagement/engagement.service.js';

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';

function makeEngagement(tenantId: string, overrides: Record<string, any> = {}) {
  return {
    id: 'eng-001',
    tenantId,
    title: 'Sprint Planning',
    status: 'active',
    phase: 'listen',
    confidence: 0.85,
    agentType: 'meeting_brain',
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function buildApp(tenantId: string): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('services', { prisma: {} } as any);

  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = tenantId;
    (request as any).userId = 'user-001';
  });

  await app.register(engagementRoutes);
  await app.ready();
  return app;
}

describe('Engagement Routes', () => {
  let app: FastifyInstance;
  let engagementService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(TENANT_A);
    engagementService = EngagementService.prototype;
  });

  // =========================================================================
  // GET / (list engagements)
  // =========================================================================
  describe('GET / (list engagements)', () => {
    it('returns engagements for the tenant', async () => {
      const engagements = [
        makeEngagement(TENANT_A, { id: 'eng-1', title: 'Eng A' }),
        makeEngagement(TENANT_A, { id: 'eng-2', title: 'Eng B' }),
      ];
      engagementService.listByTenant.mockResolvedValue(engagements);

      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(engagementService.listByTenant).toHaveBeenCalledWith(TENANT_A, undefined, undefined);
    });

    it('filters by status when provided', async () => {
      engagementService.listByTenant.mockResolvedValue([]);

      await app.inject({ method: 'GET', url: '/?status=paused' });

      expect(engagementService.listByTenant).toHaveBeenCalledWith(TENANT_A, 'paused', undefined);
    });

    it('returns empty list when no engagements exist', async () => {
      engagementService.listByTenant.mockResolvedValue([]);

      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
    });
  });

  // =========================================================================
  // GET /:id (get engagement details)
  // =========================================================================
  describe('GET /:id', () => {
    it('returns engagement when it belongs to the requesting tenant', async () => {
      const eng = makeEngagement(TENANT_A);
      engagementService.get.mockResolvedValue(eng);

      const res = await app.inject({ method: 'GET', url: '/eng-001' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.id).toBe('eng-001');
    });

    it('returns 404 when engagement belongs to another tenant (IDOR protection)', async () => {
      const eng = makeEngagement(TENANT_B);
      engagementService.get.mockResolvedValue(eng);

      const res = await app.inject({ method: 'GET', url: '/eng-001' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when engagement does not exist', async () => {
      engagementService.get.mockRejectedValue(new Error('Engagement not found'));

      const res = await app.inject({ method: 'GET', url: '/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('does not leak tenant information in error response', async () => {
      const eng = makeEngagement(TENANT_B);
      engagementService.get.mockResolvedValue(eng);

      const res = await app.inject({ method: 'GET', url: '/eng-001' });

      expect(JSON.stringify(res.json())).not.toContain(TENANT_B);
    });
  });

  // =========================================================================
  // POST /:id/advance
  // =========================================================================
  describe('POST /:id/advance', () => {
    it('advances engagement to next phase', async () => {
      const updated = makeEngagement(TENANT_A, { phase: 'understand', confidence: 0.9 });
      engagementService.advancePhase.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/advance',
        payload: { confidence: 0.9 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.phase).toBe('understand');
      expect(engagementService.advancePhase).toHaveBeenCalledWith(TENANT_A, 'eng-001', {
        confidence: 0.9,
      });
    });

    it('advances without explicit confidence', async () => {
      const updated = makeEngagement(TENANT_A, { phase: 'understand' });
      engagementService.advancePhase.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/advance',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 404 when engagement not found', async () => {
      engagementService.advancePhase.mockRejectedValue(new Error('Engagement not found'));

      const res = await app.inject({
        method: 'POST',
        url: '/nonexistent/advance',
        payload: { confidence: 0.9 },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when transition is invalid', async () => {
      engagementService.advancePhase.mockRejectedValue(
        new Error('Invalid transition from listen to build'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/advance',
        payload: { confidence: 0.9 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_TRANSITION');
    });

    it('returns 400 when engagement cannot advance (paused)', async () => {
      engagementService.advancePhase.mockRejectedValue(
        new Error('Engagement eng-001 cannot advance: currently paused'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/advance',
        payload: { confidence: 0.9 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // POST /:id/ship
  // =========================================================================
  describe('POST /:id/ship', () => {
    it('ships engagement and advances to learn phase', async () => {
      const eng = makeEngagement(TENANT_A, { phase: 'ship', status: 'active' });
      engagementService.get.mockResolvedValue(eng);
      const updated = makeEngagement(TENANT_A, { phase: 'learn', status: 'active' });
      engagementService.advancePhase.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/ship',
        payload: { prUrl: 'https://github.com/org/repo/pull/42', notes: 'Shipped!' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.phase).toBe('learn');
      expect(engagementService.advancePhase).toHaveBeenCalledWith(
        TENANT_A,
        'eng-001',
        expect.objectContaining({
          confidence: 1.0,
          targetPhase: 'learn',
          output: expect.objectContaining({
            prUrl: 'https://github.com/org/repo/pull/42',
            notes: 'Shipped!',
          }),
        }),
      );
    });

    it('returns 400 when engagement is not in ship phase', async () => {
      const eng = makeEngagement(TENANT_A, { phase: 'build', status: 'active' });
      engagementService.get.mockResolvedValue(eng);

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/ship',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PHASE');
    });

    it('returns 404 when engagement belongs to another tenant', async () => {
      const eng = makeEngagement(TENANT_B, { phase: 'ship' });
      engagementService.get.mockResolvedValue(eng);

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/ship',
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when engagement does not exist', async () => {
      engagementService.get.mockRejectedValue(new Error('Engagement not found'));

      const res = await app.inject({
        method: 'POST',
        url: '/nonexistent/ship',
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it('works without optional prUrl and notes', async () => {
      const eng = makeEngagement(TENANT_A, { phase: 'ship' });
      engagementService.get.mockResolvedValue(eng);
      const updated = makeEngagement(TENANT_A, { phase: 'learn' });
      engagementService.advancePhase.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/ship',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // POST /:id/pause
  // =========================================================================
  describe('POST /:id/pause', () => {
    it('pauses an active engagement', async () => {
      const paused = makeEngagement(TENANT_A, { status: 'paused' });
      engagementService.pause.mockResolvedValue(paused);

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/pause',
        payload: { reason: 'Need more info' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.status).toBe('paused');
      expect(engagementService.pause).toHaveBeenCalledWith(TENANT_A, 'eng-001', 'Need more info');
    });

    it('pauses without a reason', async () => {
      const paused = makeEngagement(TENANT_A, { status: 'paused' });
      engagementService.pause.mockResolvedValue(paused);

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/pause',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 404 when engagement not found', async () => {
      engagementService.pause.mockRejectedValue(new Error('Engagement not found'));

      const res = await app.inject({
        method: 'POST',
        url: '/nonexistent/pause',
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // POST /:id/resume
  // =========================================================================
  describe('POST /:id/resume', () => {
    it('resumes a paused engagement', async () => {
      const resumed = makeEngagement(TENANT_A, { status: 'active' });
      engagementService.resume.mockResolvedValue(resumed);

      const res = await app.inject({
        method: 'POST',
        url: '/eng-001/resume',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.status).toBe('active');
      expect(engagementService.resume).toHaveBeenCalledWith(TENANT_A, 'eng-001');
    });

    it('returns 404 when engagement not found', async () => {
      engagementService.resume.mockRejectedValue(new Error('Engagement not found'));

      const res = await app.inject({
        method: 'POST',
        url: '/nonexistent/resume',
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
