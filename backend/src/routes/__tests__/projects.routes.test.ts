/**
 * Integration tests for /api/projects routes.
 *
 * Covers create / list / get / patch / delete + validation errors +
 * tenant isolation.
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

import { projectsRoutes } from '../projects.routes.js';

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';

function makeProjectServiceStub() {
  return {
    listForTenant: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async (input: any) => ({
      id: 'proj-new',
      tenantId: input.tenantId,
      name: input.name,
      slug: input.slug ?? input.name.toLowerCase().replace(/\s+/g, '-'),
      description: input.description ?? null,
      color: input.color ?? null,
      isArchived: false,
      createdBy: input.createdBy ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    update: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue({ deleted: false, reason: 'not_found' }),
  };
}

async function buildApp(
  projectService: ReturnType<typeof makeProjectServiceStub>,
  tenantId: string = TENANT_A,
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('services', { projectService } as any);
  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = tenantId;
    (request as any).userId = 'user-001';
  });
  await app.register(projectsRoutes);
  await app.ready();
  return app;
}

describe('Projects Routes', () => {
  let app: FastifyInstance;
  let service: ReturnType<typeof makeProjectServiceStub>;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = makeProjectServiceStub();
    app = await buildApp(service);
  });

  describe('GET /', () => {
    it('lists projects for the tenant', async () => {
      service.listForTenant.mockResolvedValue([
        { id: 'p1', tenantId: TENANT_A, name: 'Default', slug: 'default' },
        { id: 'p2', tenantId: TENANT_A, name: 'Mobile', slug: 'mobile' },
      ]);
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(service.listForTenant).toHaveBeenCalledWith(TENANT_A, { includeArchived: false });
    });

    it('honors ?includeArchived=1', async () => {
      await app.inject({ method: 'GET', url: '/?includeArchived=1' });
      expect(service.listForTenant).toHaveBeenCalledWith(TENANT_A, { includeArchived: true });
    });
  });

  describe('POST /', () => {
    it('creates a project from a valid payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: { name: 'Mobile App', description: 'ios + android', color: '#3b82f6' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Mobile App');
      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_A, name: 'Mobile App', color: '#3b82f6', createdBy: 'user-001' }),
      );
    });

    it('rejects missing name with 400', async () => {
      const res = await app.inject({ method: 'POST', url: '/', payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(service.create).not.toHaveBeenCalled();
    });

    it('rejects invalid color with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: { name: 'Bad', color: 'not-a-hex' },
      });
      expect(res.statusCode).toBe(400);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('rejects invalid slug (uppercase) with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: { name: 'Valid', slug: 'BadSlug' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects over-long name with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: { name: 'x'.repeat(500) },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /:id', () => {
    it('returns the project when it exists', async () => {
      service.findById.mockResolvedValue({ id: 'p1', tenantId: TENANT_A, name: 'Default', slug: 'default' });
      const res = await app.inject({ method: 'GET', url: '/p1' });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe('p1');
      expect(service.findById).toHaveBeenCalledWith(TENANT_A, 'p1');
    });

    it('returns 404 when the project is not in the tenant (IDOR guard)', async () => {
      service.findById.mockResolvedValue(null);
      const res = await app.inject({ method: 'GET', url: '/other-tenant-project' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /:id', () => {
    it('updates name + description', async () => {
      service.update.mockResolvedValue({ id: 'p1', tenantId: TENANT_A, name: 'Renamed', slug: 'default' });
      const res = await app.inject({
        method: 'PATCH',
        url: '/p1',
        payload: { name: 'Renamed', description: 'updated desc' },
      });
      expect(res.statusCode).toBe(200);
      expect(service.update).toHaveBeenCalledWith(TENANT_A, 'p1', { name: 'Renamed', description: 'updated desc' });
    });

    it('archives via isArchived=true', async () => {
      service.update.mockResolvedValue({ id: 'p1', isArchived: true });
      const res = await app.inject({ method: 'PATCH', url: '/p1', payload: { isArchived: true } });
      expect(res.statusCode).toBe(200);
      expect(service.update).toHaveBeenCalledWith(TENANT_A, 'p1', { isArchived: true });
    });

    it('accepts color=null to clear the color', async () => {
      service.update.mockResolvedValue({ id: 'p1', color: null });
      const res = await app.inject({ method: 'PATCH', url: '/p1', payload: { color: null } });
      expect(res.statusCode).toBe(200);
    });

    it('returns 404 when the project is missing', async () => {
      service.update.mockResolvedValue(null);
      const res = await app.inject({ method: 'PATCH', url: '/missing', payload: { name: 'X' } });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid color', async () => {
      const res = await app.inject({ method: 'PATCH', url: '/p1', payload: { color: 'not-hex' } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes when the project has no referring rows', async () => {
      service.remove.mockResolvedValue({ deleted: true });
      const res = await app.inject({ method: 'DELETE', url: '/p1' });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(service.remove).toHaveBeenCalledWith(TENANT_A, 'p1');
    });

    it('returns 400 HAS_REFERENCES when the project still has rows', async () => {
      service.remove.mockResolvedValue({ deleted: false, reason: 'has 3 referring rows — archive instead' });
      const res = await app.inject({ method: 'DELETE', url: '/p1' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('HAS_REFERENCES');
    });

    it('returns 404 when the project is not found', async () => {
      service.remove.mockResolvedValue({ deleted: false, reason: 'not_found' });
      const res = await app.inject({ method: 'DELETE', url: '/missing' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('tenant isolation', () => {
    it('threads request.tenantId through to the service (no leak from query/body)', async () => {
      const svc = makeProjectServiceStub();
      const appB = await buildApp(svc, TENANT_B);
      await appB.inject({ method: 'GET', url: '/' });
      await appB.inject({ method: 'GET', url: '/some-id' });
      await appB.inject({ method: 'POST', url: '/', payload: { name: 'B-only' } });
      for (const call of svc.listForTenant.mock.calls) expect(call[0]).toBe(TENANT_B);
      for (const call of svc.findById.mock.calls) expect(call[0]).toBe(TENANT_B);
      for (const call of svc.create.mock.calls) expect(call[0].tenantId).toBe(TENANT_B);
    });
  });
});
