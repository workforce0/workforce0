/**
 * Unit tests for Team Routes — Invitation Endpoints
 *
 * Tests:
 * - POST /invitations: creates invitation successfully (201)
 * - POST /invitations: returns 409 when user already a member
 * - POST /invitations: returns 409 when invitation already pending
 * - POST /invitations: rejects invalid email (400)
 * - POST /invitations: forbidden for viewer role (403)
 * - GET /invitations: returns list of invitations
 * - DELETE /invitations/:id: revokes pending invitation
 * - DELETE /invitations/:id: returns 404 for non-existent invitation
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

import { teamRoutes } from '../team.routes.js';

// --- Mock helpers ---

function createMockPrisma() {
  return {
    teamMember: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: 'member-1',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      update: vi.fn().mockResolvedValue({}),
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
        updatedAt: new Date(),
      })),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

async function buildApp(
  prisma: ReturnType<typeof createMockPrisma>,
  userRole: string = 'owner',
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('services', { prisma } as any);

  // Simulate auth middleware setting tenantId, userId, and userRole on request
  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = 'tenant-001';
    (request as any).userId = 'user-001';
    (request as any).userRole = userRole;
  });

  await app.register(teamRoutes);
  await app.ready();
  return app;
}

describe('Team Routes — Invitations', () => {
  let app: FastifyInstance;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  // ===========================================================================
  // POST /invitations
  // ===========================================================================
  describe('POST /invitations', () => {
    const validBody = { email: 'newuser@example.com', role: 'member' };

    beforeEach(async () => {
      vi.clearAllMocks();
      mockPrisma = createMockPrisma();
      app = await buildApp(mockPrisma);
    });

    it('creates invitation successfully and returns 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('inv-001');
      expect(body.data.email).toBe('newuser@example.com');
      expect(body.data.role).toBe('member');
      expect(body.data.inviteUrl).toContain('/signup?invite=');
      expect(body.data.expiresAt).toBeDefined();

      // Verify prisma calls
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-001', email: 'newuser@example.com' },
      });
      expect(mockPrisma.invitation.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-001', email: 'newuser@example.com', status: 'pending' },
      });
      expect(mockPrisma.invitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-001',
          email: 'newuser@example.com',
          role: 'member',
          invitedBy: 'user-001',
        }),
      });
    });

    it('returns 409 when user is already a member', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'existing-user',
        tenantId: 'tenant-001',
        email: 'newuser@example.com',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        payload: validBody,
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('ALREADY_MEMBER');
      // Should not have created an invitation
      expect(mockPrisma.invitation.create).not.toHaveBeenCalled();
    });

    it('returns 409 when invitation is already pending', async () => {
      mockPrisma.invitation.findFirst.mockResolvedValue({
        id: 'inv-existing',
        tenantId: 'tenant-001',
        email: 'newuser@example.com',
        status: 'pending',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        payload: validBody,
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVITE_PENDING');
      expect(mockPrisma.invitation.create).not.toHaveBeenCalled();
    });

    it('rejects invalid email with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        payload: { email: 'not-an-email', role: 'member' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(mockPrisma.invitation.create).not.toHaveBeenCalled();
    });

    it('returns 403 when user has viewer role', async () => {
      vi.clearAllMocks();
      mockPrisma = createMockPrisma();
      app = await buildApp(mockPrisma, 'viewer');

      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        payload: validBody,
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(mockPrisma.invitation.create).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // GET /invitations
  // ===========================================================================
  describe('GET /invitations', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      mockPrisma = createMockPrisma();
      app = await buildApp(mockPrisma);
    });

    it('returns list of invitations', async () => {
      const mockInvitations = [
        {
          id: 'inv-001',
          tenantId: 'tenant-001',
          email: 'alice@example.com',
          role: 'admin',
          status: 'pending',
          createdAt: new Date('2026-03-01'),
        },
        {
          id: 'inv-002',
          tenantId: 'tenant-001',
          email: 'bob@example.com',
          role: 'member',
          status: 'accepted',
          createdAt: new Date('2026-02-28'),
        },
      ];
      mockPrisma.invitation.findMany.mockResolvedValue(mockInvitations);

      const res = await app.inject({
        method: 'GET',
        url: '/invitations',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].email).toBe('alice@example.com');
      expect(body.data[1].email).toBe('bob@example.com');

      expect(mockPrisma.invitation.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-001' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });
  });

  // ===========================================================================
  // DELETE /invitations/:id
  // ===========================================================================
  describe('DELETE /invitations/:id', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      mockPrisma = createMockPrisma();
      app = await buildApp(mockPrisma);
    });

    it('revokes a pending invitation', async () => {
      mockPrisma.invitation.findFirst.mockResolvedValue({
        id: 'inv-001',
        tenantId: 'tenant-001',
        email: 'alice@example.com',
        status: 'pending',
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/invitations/inv-001',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Invitation revoked');

      expect(mockPrisma.invitation.findFirst).toHaveBeenCalledWith({
        where: { id: 'inv-001', tenantId: 'tenant-001', status: 'pending' },
      });
      expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-001' },
        data: { status: 'expired' },
      });
    });

    it('returns 404 for non-existent invitation', async () => {
      mockPrisma.invitation.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/invitations/inv-nonexistent',
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(mockPrisma.invitation.update).not.toHaveBeenCalled();
    });
  });
});
