/**
 * Unit tests for Dashboard Routes
 *
 * Tests:
 * - GET /stats: returns overview counts and recent items
 * - GET /activity: returns combined sorted activity feed
 * - GET /roi: returns ROI metrics (hours saved, approval rate, week-over-week)
 * - GET /usage: returns tier/usage info for the current tenant
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Mock the logger
vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { dashboardRoutes } from '../dashboard.routes.js';

// --- Helpers ---

function createMockPrisma() {
  return {
    meeting: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    pRD: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // N6: dashboard stats now count Tickets (single source of truth).
    ticket: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Kept for any legacy test that still asserts against it.
    agentTask: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    jiraTicket: {
      count: vi.fn().mockResolvedValue(0),
    },
    transcript: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

async function buildApp(prisma: ReturnType<typeof createMockPrisma>): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('services', { prisma } as any);

  // Simulate auth middleware setting tenantId
  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = 'tenant-001';
  });

  await app.register(dashboardRoutes);
  await app.ready();
  return app;
}

describe('Dashboard Routes', () => {
  let app: FastifyInstance;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    app = await buildApp(mockPrisma);
  });

  // =========================================================================
  // GET /stats
  // =========================================================================
  describe('GET /stats', () => {
    it('returns overview with all zero counts', async () => {
      const res = await app.inject({ method: 'GET', url: '/stats' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);

      // Overview structure
      expect(body.data.overview.meetings).toEqual({ total: 0, completed: 0, active: 0 });
      expect(body.data.overview.prds).toEqual({ total: 0, approved: 0, pending: 0 });
      expect(body.data.overview.tasks).toEqual({ total: 0, active: 0, pendingClarifications: 0 });
      expect(body.data.overview.tickets).toEqual({ total: 0 });

      // Recent items
      expect(body.data.recent.meetings).toEqual([]);
      expect(body.data.recent.prds).toEqual([]);
    });

    it('returns correct counts from Prisma', async () => {
      // Set up different return values for each count call
      const meetingCount = mockPrisma.meeting.count;
      meetingCount
        .mockResolvedValueOnce(10)  // total meetings
        .mockResolvedValueOnce(7)   // completed
        .mockResolvedValueOnce(2);  // active

      const prdCount = mockPrisma.pRD.count;
      prdCount
        .mockResolvedValueOnce(5)   // total PRDs
        .mockResolvedValueOnce(3)   // approved
        .mockResolvedValueOnce(2);  // pending

      // N6: dashboard stats now count tickets (single source of truth).
      const ticketCount = mockPrisma.ticket.count;
      ticketCount
        .mockResolvedValueOnce(15)  // total tasks → total tickets
        .mockResolvedValueOnce(4)   // active (status in ready, claimed)
        .mockResolvedValueOnce(1);  // waiting (was awaiting_clarification)

      mockPrisma.jiraTicket.count.mockResolvedValueOnce(8);

      const recentMeetings = [
        { id: 'm1', title: 'Sprint Planning', status: 'completed', startTime: new Date(), createdAt: new Date() },
      ];
      const recentPrds = [
        { id: 'p1', title: 'Feature X PRD', status: 'approved', confidence: 0.9, createdAt: new Date() },
      ];

      mockPrisma.meeting.findMany.mockResolvedValueOnce(recentMeetings);
      mockPrisma.pRD.findMany.mockResolvedValueOnce(recentPrds);

      const res = await app.inject({ method: 'GET', url: '/stats' });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.data.overview.meetings).toEqual({ total: 10, completed: 7, active: 2 });
      expect(body.data.overview.prds).toEqual({ total: 5, approved: 3, pending: 2 });
      expect(body.data.overview.tasks).toEqual({ total: 15, active: 4, pendingClarifications: 1 });
      expect(body.data.overview.tickets).toEqual({ total: 8 });

      expect(body.data.recent.meetings).toHaveLength(1);
      expect(body.data.recent.meetings[0].title).toBe('Sprint Planning');
      expect(body.data.recent.prds).toHaveLength(1);
      expect(body.data.recent.prds[0].title).toBe('Feature X PRD');
    });

    it('filters by tenantId', async () => {
      await app.inject({ method: 'GET', url: '/stats' });

      // Check that all count calls include tenantId filter
      for (const call of mockPrisma.meeting.count.mock.calls) {
        expect(call[0].where.tenantId).toBe('tenant-001');
      }
      for (const call of mockPrisma.pRD.count.mock.calls) {
        expect(call[0].where.tenantId).toBe('tenant-001');
      }
      // N6: task counts now land on the ticket mock.
      for (const call of mockPrisma.ticket.count.mock.calls) {
        expect(call[0].where.tenantId).toBe('tenant-001');
      }
    });
  });

  // =========================================================================
  // GET /activity
  // =========================================================================
  describe('GET /activity', () => {
    it('returns empty activity feed', async () => {
      const res = await app.inject({ method: 'GET', url: '/activity' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns combined and sorted activity feed', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);
      const twoHoursAgo = new Date(now.getTime() - 7200000);

      mockPrisma.meeting.findMany.mockResolvedValueOnce([
        { id: 'm1', title: 'Meeting A', status: 'completed', updatedAt: twoHoursAgo },
      ]);
      mockPrisma.pRD.findMany.mockResolvedValueOnce([
        { id: 'p1', title: 'PRD B', status: 'draft', confidence: 0.8, updatedAt: now },
      ]);
      // N6: activity feed reads tickets; route maps roleSlug → agentType.
      mockPrisma.ticket.findMany.mockResolvedValueOnce([
        { id: 't1', roleSlug: 'ba_agent', status: 'claimed', updatedAt: oneHourAgo },
      ]);

      const res = await app.inject({ method: 'GET', url: '/activity' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(3);

      // Should be sorted newest first
      expect(body.data[0].type).toBe('prd');
      expect(body.data[0].id).toBe('p1');
      expect(body.data[1].type).toBe('task');
      expect(body.data[1].id).toBe('t1');
      expect(body.data[2].type).toBe('meeting');
      expect(body.data[2].id).toBe('m1');
    });

    it('respects default limit of 20', async () => {
      await app.inject({ method: 'GET', url: '/activity' });

      // Each findMany should be called with take: 20
      expect(mockPrisma.meeting.findMany.mock.calls[0][0].take).toBe(20);
      expect(mockPrisma.pRD.findMany.mock.calls[0][0].take).toBe(20);
      // N6: tasks are now fetched from the ticket table.
      expect(mockPrisma.ticket.findMany.mock.calls[0][0].take).toBe(20);
    });

    it('accepts custom limit via query param', async () => {
      await app.inject({ method: 'GET', url: '/activity?limit=5' });

      expect(mockPrisma.meeting.findMany.mock.calls[0][0].take).toBe(5);
    });

    it('caps limit at 50', async () => {
      // Zod schema uses .max(50), so limit=100 is rejected as a validation error
      const res = await app.inject({ method: 'GET', url: '/activity?limit=100' });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      // findMany should not have been called since validation failed
      expect(mockPrisma.meeting.findMany).not.toHaveBeenCalled();
    });

    it('activity items have correct type labels', async () => {
      mockPrisma.meeting.findMany.mockResolvedValueOnce([
        { id: 'm1', title: 'Meeting', status: 'completed', updatedAt: new Date() },
      ]);
      mockPrisma.pRD.findMany.mockResolvedValueOnce([
        { id: 'p1', title: 'PRD', status: 'draft', confidence: 0.5, updatedAt: new Date() },
      ]);
      mockPrisma.ticket.findMany.mockResolvedValueOnce([
        { id: 't1', roleSlug: 'ba_agent', status: 'ready', updatedAt: new Date() },
      ]);

      const res = await app.inject({ method: 'GET', url: '/activity' });
      const body = res.json();

      const types = body.data.map((item: any) => item.type);
      expect(types).toContain('meeting');
      expect(types).toContain('prd');
      expect(types).toContain('task');
    });

    it('filters by tenantId', async () => {
      await app.inject({ method: 'GET', url: '/activity' });

      expect(mockPrisma.meeting.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-001');
      expect(mockPrisma.pRD.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-001');
      // N6: tasks read from the ticket table.
      expect(mockPrisma.ticket.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-001');
    });
  });

  // =========================================================================
  // GET /roi
  // =========================================================================
  describe('GET /roi', () => {
    it('returns zero values when no data', async () => {
      // All mocks default to 0 / empty arrays
      const res = await app.inject({ method: 'GET', url: '/roi' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.hoursSavedThisWeek).toBe(0);
      expect(body.data.meetingsThisWeek).toBe(0);
      expect(body.data.prdsThisWeek).toBe(0);
      expect(body.data.approvalRate).toBe(0);
      expect(body.data.weekOverWeekChange).toBe(0);
    });

    it('calculates hours saved correctly from transcript durations', async () => {
      // thisWeekMeetings, prevWeekMeetings, thisWeekPrds, totalApproved, totalPrds
      mockPrisma.meeting.count
        .mockResolvedValueOnce(2)   // thisWeekMeetings
        .mockResolvedValueOnce(0);  // prevWeekMeetings
      mockPrisma.pRD.count
        .mockResolvedValueOnce(1)   // thisWeekPrds
        .mockResolvedValueOnce(0)   // totalApproved
        .mockResolvedValueOnce(1);  // totalPrds

      // Two transcripts: 1800s (30min) + 3600s (60min) = 5400s
      // hoursSaved = round((5400 / 3600) * 2 * 10) / 10 = round(1.5 * 2 * 10) / 10 = 3.0
      mockPrisma.transcript.findMany.mockResolvedValueOnce([
        { duration: 1800 },
        { duration: 3600 },
      ]);

      const res = await app.inject({ method: 'GET', url: '/roi' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.hoursSavedThisWeek).toBe(3);
      expect(body.data.meetingsThisWeek).toBe(2);
      expect(body.data.prdsThisWeek).toBe(1);
    });

    it('calculates week-over-week change', async () => {
      // thisWeekMeetings = 6, prevWeekMeetings = 4
      // weekOverWeekChange = round(((6 - 4) / 4) * 100) = 50
      mockPrisma.meeting.count
        .mockResolvedValueOnce(6)   // thisWeekMeetings
        .mockResolvedValueOnce(4);  // prevWeekMeetings
      mockPrisma.pRD.count
        .mockResolvedValueOnce(0)   // thisWeekPrds
        .mockResolvedValueOnce(0)   // totalApproved
        .mockResolvedValueOnce(0);  // totalPrds

      const res = await app.inject({ method: 'GET', url: '/roi' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.weekOverWeekChange).toBe(50);
    });

    it('calculates approval rate', async () => {
      mockPrisma.meeting.count
        .mockResolvedValueOnce(0)   // thisWeekMeetings
        .mockResolvedValueOnce(0);  // prevWeekMeetings
      // totalApproved = 3, totalPrds = 4 → approvalRate = round((3/4)*100) = 75
      mockPrisma.pRD.count
        .mockResolvedValueOnce(0)   // thisWeekPrds
        .mockResolvedValueOnce(3)   // totalApproved
        .mockResolvedValueOnce(4);  // totalPrds

      const res = await app.inject({ method: 'GET', url: '/roi' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.approvalRate).toBe(75);
    });
  });

});
