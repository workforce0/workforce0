/**
 * Unit tests for Team Routes — CRUD Endpoints (team roster)
 *
 * Tests:
 * - GET /: list team members for tenant
 * - POST /: add team member (201, 409 duplicate, re-activate soft-deleted, validation)
 * - PUT /:id: update team member (200, 404, validation)
 * - DELETE /:id: remove team member (soft delete, 200, 404)
 * - Tenant isolation on all endpoints
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

vi.mock('../../middleware/rbac.middleware.js', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {}),
  requireOwner: vi.fn().mockImplementation(async () => {}),
  requireMember: vi.fn().mockImplementation(async () => {}),
  requireViewer: vi.fn().mockImplementation(async () => {}),
  requireRole: vi.fn().mockReturnValue(async () => {}),
  requireMinRole: vi.fn().mockReturnValue(async () => {}),
}));

import { teamRoutes } from '../team.routes.js';

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';

function makeMember(tenantId: string, overrides: Record<string, any> = {}) {
  return {
    id: 'member-001',
    tenantId,
    name: 'Alice Smith',
    email: 'alice@example.com',
    role: 'pm',
    preferredChannel: 'email',
    channelIds: { email: 'alice@example.com' },
    isActive: true,
    discoveredFrom: 'manual',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    teamMember: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: 'member-new',
        ...data,
        isActive: true,
        discoveredFrom: 'manual',
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      update: vi.fn().mockImplementation(({ where, data }: any) => ({
        id: where.id,
        ...data,
        updatedAt: new Date(),
      })),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    invitation: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: 'inv-001',
        ...data,
        status: 'pending',
        createdAt: new Date(),
      })),
      update: vi.fn().mockResolvedValue({}),
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
    (request as any).userId = 'user-001';
    (request as any).userRole = 'owner';
  });

  await app.register(teamRoutes);
  await app.ready();
  return app;
}

describe('Team Routes — CRUD', () => {
  let app: FastifyInstance;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    app = await buildApp(mockPrisma);
  });

  // =========================================================================
  // GET / (list team members)
  // =========================================================================
  describe('GET / (list team members)', () => {
    it('returns active team members for the tenant', async () => {
      const members = [
        makeMember(TENANT_A, { id: 'm1', name: 'Alice' }),
        makeMember(TENANT_A, { id: 'm2', name: 'Bob', role: 'developer' }),
      ];
      mockPrisma.teamMember.findMany.mockResolvedValue(members);

      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].name).toBe('Alice');
      expect(body.data[1].name).toBe('Bob');
    });

    it('only returns active members', async () => {
      await app.inject({ method: 'GET', url: '/' });

      expect(mockPrisma.teamMember.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_A, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('returns empty list when no members', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
    });
  });

  // =========================================================================
  // POST / (add team member)
  // =========================================================================
  describe('POST / (add team member)', () => {
    const validBody = {
      name: 'Charlie Brown',
      email: 'charlie@example.com',
      role: 'developer',
    };

    it('creates a new team member and returns 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Charlie Brown');
      expect(body.data.email).toBe('charlie@example.com');
      expect(body.data.role).toBe('developer');

      expect(mockPrisma.teamMember.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          name: 'Charlie Brown',
          email: 'charlie@example.com',
          role: 'developer',
          preferredChannel: 'email',
          isActive: true,
        }),
      });
    });

    it('returns 409 when member with email already exists', async () => {
      mockPrisma.teamMember.findUnique.mockResolvedValue(
        makeMember(TENANT_A, { email: 'charlie@example.com' }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: validBody,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('DUPLICATE_EMAIL');
      expect(mockPrisma.teamMember.create).not.toHaveBeenCalled();
    });

    it('re-activates soft-deleted member with same email', async () => {
      mockPrisma.teamMember.findUnique.mockResolvedValue(
        makeMember(TENANT_A, {
          email: 'charlie@example.com',
          isActive: false,
          id: 'member-old',
        }),
      );
      mockPrisma.teamMember.update.mockResolvedValue(
        makeMember(TENANT_A, {
          email: 'charlie@example.com',
          name: 'Charlie Brown',
          role: 'developer',
          isActive: true,
          id: 'member-old',
        }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      expect(mockPrisma.teamMember.update).toHaveBeenCalledWith({
        where: { id: 'member-old' },
        data: expect.objectContaining({
          name: 'Charlie Brown',
          role: 'developer',
          isActive: true,
        }),
      });
      // Should not call create when re-activating
      expect(mockPrisma.teamMember.create).not.toHaveBeenCalled();
    });

    it('sets preferredChannel and channelIds with defaults', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      expect(mockPrisma.teamMember.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          preferredChannel: 'email',
          channelIds: { email: 'charlie@example.com' },
        }),
      });
    });

    it('accepts custom preferredChannel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: { ...validBody, preferredChannel: 'slack' },
      });

      expect(res.statusCode).toBe(201);
    });

    it('rejects invalid email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: { ...validBody, email: 'not-an-email' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('rejects missing name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: { email: 'charlie@example.com', role: 'developer' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('rejects invalid role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: { ...validBody, role: 'invalid_role' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // PUT /:id (update team member)
  // =========================================================================
  describe('PUT /:id (update team member)', () => {
    it('updates team member name', async () => {
      mockPrisma.teamMember.findFirst.mockResolvedValue(
        makeMember(TENANT_A, { id: 'member-001' }),
      );
      mockPrisma.teamMember.update.mockResolvedValue(
        makeMember(TENANT_A, { id: 'member-001', name: 'Alice Updated' }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/member-001',
        payload: { name: 'Alice Updated' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(mockPrisma.teamMember.update).toHaveBeenCalledWith({
        where: { id: 'member-001' },
        data: expect.objectContaining({ name: 'Alice Updated' }),
      });
    });

    it('updates team member role', async () => {
      mockPrisma.teamMember.findFirst.mockResolvedValue(
        makeMember(TENANT_A, { id: 'member-001' }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/member-001',
        payload: { role: 'cto' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('updates preferredChannel and channelIds', async () => {
      mockPrisma.teamMember.findFirst.mockResolvedValue(
        makeMember(TENANT_A, { id: 'member-001' }),
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/member-001',
        payload: {
          preferredChannel: 'slack',
          channelIds: { slack: 'U12345' },
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 404 when member does not exist', async () => {
      mockPrisma.teamMember.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/nonexistent',
        payload: { name: 'Updated' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
      expect(mockPrisma.teamMember.update).not.toHaveBeenCalled();
    });

    it('returns 404 when member belongs to another tenant (tenant isolation)', async () => {
      // findFirst with tenantId filter returns null
      mockPrisma.teamMember.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/member-other-tenant',
        payload: { name: 'Hacked' },
      });

      expect(res.statusCode).toBe(404);
      expect(mockPrisma.teamMember.update).not.toHaveBeenCalled();
    });

    it('verifies findFirst uses tenantId and isActive', async () => {
      mockPrisma.teamMember.findFirst.mockResolvedValue(null);

      await app.inject({
        method: 'PUT',
        url: '/member-001',
        payload: { name: 'Test' },
      });

      expect(mockPrisma.teamMember.findFirst).toHaveBeenCalledWith({
        where: { id: 'member-001', tenantId: TENANT_A, isActive: true },
      });
    });

    it('rejects empty update body', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/member-001',
        payload: {},
      });

      // Zod refine: "At least one field must be provided for update"
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // DELETE /:id (remove team member)
  // =========================================================================
  describe('DELETE /:id (remove team member)', () => {
    it('soft-deletes team member by setting isActive=false', async () => {
      mockPrisma.teamMember.findFirst.mockResolvedValue(
        makeMember(TENANT_A, { id: 'member-001' }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/member-001',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().message).toBe('Team member removed');

      expect(mockPrisma.teamMember.update).toHaveBeenCalledWith({
        where: { id: 'member-001' },
        data: { isActive: false },
      });
    });

    it('returns 404 when member does not exist', async () => {
      mockPrisma.teamMember.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
      expect(mockPrisma.teamMember.update).not.toHaveBeenCalled();
    });

    it('returns 404 when member belongs to another tenant (tenant isolation)', async () => {
      mockPrisma.teamMember.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/member-other-tenant',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for already-deleted member (isActive=false)', async () => {
      // findFirst with isActive: true returns null
      mockPrisma.teamMember.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/member-soft-deleted',
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
