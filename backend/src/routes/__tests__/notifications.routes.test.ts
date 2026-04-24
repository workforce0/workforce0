/**
 * Unit tests for Notification Routes
 *
 * Tests:
 * - GET /: list notifications (200, filtering, pagination, tenant scoping)
 * - PATCH /:id: mark notification as read/dismissed (200, 404, tenant isolation)
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

import { notificationRoutes } from '../notifications.routes.js';

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';

function makeNotification(tenantId: string, overrides: Record<string, any> = {}) {
  return {
    id: 'notif-001',
    tenantId,
    channel: 'in_app',
    type: 'clarification_needed',
    title: 'Question about auth flow',
    message: 'The BA agent needs clarification on authentication requirements.',
    metadata: { taskId: 'task-1' },
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(({ where, data }: any) => ({
        id: where.id,
        ...data,
      })),
    },
  };
}

async function buildApp(
  prisma: ReturnType<typeof createMockPrisma>,
  tenantId: string,
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('services', { prisma } as any);

  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = tenantId;
    (request as any).userRole = 'owner';
  });

  await app.register(notificationRoutes);
  await app.ready();
  return app;
}

describe('Notification Routes', () => {
  let app: FastifyInstance;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    app = await buildApp(mockPrisma, TENANT_A);
  });

  // =========================================================================
  // GET / (list notifications)
  // =========================================================================
  describe('GET / (list notifications)', () => {
    it('returns empty list when no notifications exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
      expect(body.meta.total).toBe(0);
      expect(body.meta.returned).toBe(0);
    });

    it('returns pending notifications by default', async () => {
      const notifications = [
        makeNotification(TENANT_A, { id: 'n1' }),
        makeNotification(TENANT_A, { id: 'n2', type: 'approval_needed' }),
      ];
      mockPrisma.notification.findMany.mockResolvedValue(notifications);
      mockPrisma.notification.count.mockResolvedValue(2);

      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);
      expect(body.meta.total).toBe(2);
      expect(body.meta.returned).toBe(2);

      // Verify the default filter is 'pending'
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_A, status: 'pending' },
        }),
      );
    });

    it('filters by status=all to get all notifications', async () => {
      await app.inject({ method: 'GET', url: '/?status=all' });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_A },
        }),
      );
    });

    it('filters by status=read', async () => {
      await app.inject({ method: 'GET', url: '/?status=read' });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_A, status: 'read' },
        }),
      );
    });

    it('filters by notification type', async () => {
      await app.inject({ method: 'GET', url: '/?type=clarification_needed' });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_A,
            type: 'clarification_needed',
          }),
        }),
      );
    });

    it('respects custom limit', async () => {
      await app.inject({ method: 'GET', url: '/?limit=5' });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        }),
      );
    });

    it('orders by createdAt descending', async () => {
      await app.inject({ method: 'GET', url: '/' });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('scopes queries to tenant', async () => {
      await app.inject({ method: 'GET', url: '/' });

      const call = mockPrisma.notification.findMany.mock.calls[0][0];
      expect(call.where.tenantId).toBe(TENANT_A);

      const countCall = mockPrisma.notification.count.mock.calls[0][0];
      expect(countCall.where.tenantId).toBe(TENANT_A);
    });
  });

  // =========================================================================
  // PATCH /:id (mark notification)
  // =========================================================================
  describe('PATCH /:id (mark notification)', () => {
    it('marks notification as read', async () => {
      const notif = makeNotification(TENANT_A);
      mockPrisma.notification.findFirst.mockResolvedValue(notif);
      mockPrisma.notification.update.mockResolvedValue({ ...notif, status: 'read' });

      const res = await app.inject({
        method: 'PATCH',
        url: '/notif-001',
        payload: { status: 'read' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-001', tenantId: TENANT_A },
        data: { status: 'read' },
      });
    });

    it('marks notification as dismissed', async () => {
      const notif = makeNotification(TENANT_A);
      mockPrisma.notification.findFirst.mockResolvedValue(notif);
      mockPrisma.notification.update.mockResolvedValue({ ...notif, status: 'dismissed' });

      const res = await app.inject({
        method: 'PATCH',
        url: '/notif-001',
        payload: { status: 'dismissed' },
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-001', tenantId: TENANT_A },
        data: { status: 'dismissed' },
      });
    });

    it('returns 404 when notification does not exist', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH',
        url: '/nonexistent',
        payload: { status: 'read' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });

    it('returns 404 when notification belongs to another tenant (tenant isolation)', async () => {
      // findFirst with tenantId filter returns null for other tenant's notification
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH',
        url: '/notif-other-tenant',
        payload: { status: 'read' },
      });

      expect(res.statusCode).toBe(404);
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });

    it('validates that findFirst uses tenantId in the where clause', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await app.inject({
        method: 'PATCH',
        url: '/notif-001',
        payload: { status: 'read' },
      });

      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-001', tenantId: TENANT_A },
      });
    });

    it('rejects invalid status values', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/notif-001',
        payload: { status: 'invalid_status' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(mockPrisma.notification.findFirst).not.toHaveBeenCalled();
    });

    it('rejects missing status field', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/notif-001',
        payload: {},
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
