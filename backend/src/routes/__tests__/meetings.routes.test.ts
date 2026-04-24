/**
 * Unit tests for Meetings Routes
 *
 * Tests:
 * - POST /: returns 410 (bot scheduling removed)
 * - GET /: list meetings for tenant
 * - GET /:id: get meeting details (200, 404, tenant isolation)
 * - DELETE /:id: cancel meeting (200, 404, tenant isolation)
 * - GET /:id/transcript: get transcript (200, 404, no transcript)
 * - GET /:id/insights: get insights (200, 404)
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

import { meetingRoutes } from '../meetings.routes.js';

// --- Constants ---

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';

// --- Mock helpers ---

function createMockMeetingService() {
  return {
    getMeeting: vi.fn(),
    getMeetingsForTenant: vi.fn().mockResolvedValue([]),
    handleStatusUpdate: vi.fn(),
  };
}

function createMockMeetingRepository() {
  return {
    findById: vi.fn(),
    findByIdWithTranscript: vi.fn(),
    updateStatus: vi.fn(),
  };
}

function createMockPrisma() {
  return {
    meeting: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    meetingInsights: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

async function buildApp(
  meetingService: ReturnType<typeof createMockMeetingService>,
  meetingRepository: ReturnType<typeof createMockMeetingRepository>,
  tenantId: string,
  prisma?: ReturnType<typeof createMockPrisma>,
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('services', {
    meetingService,
    meetingRepository,
    prisma: prisma || createMockPrisma(),
  } as any);

  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = tenantId;
  });

  await app.register(meetingRoutes);
  await app.ready();
  return app;
}

// --- Test data ---

function makeMeeting(tenantId: string, overrides: Record<string, any> = {}) {
  return {
    id: 'meeting-001',
    tenantId,
    title: 'Sprint Planning',
    status: 'completed',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    startTime: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('Meetings Routes', () => {
  let app: FastifyInstance;
  let mockMeetingService: ReturnType<typeof createMockMeetingService>;
  let mockMeetingRepository: ReturnType<typeof createMockMeetingRepository>;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMeetingService = createMockMeetingService();
    mockMeetingRepository = createMockMeetingRepository();
    mockPrisma = createMockPrisma();
    app = await buildApp(mockMeetingService, mockMeetingRepository, TENANT_A, mockPrisma);
  });

  // =========================================================================
  // POST / (schedule meeting - removed)
  // =========================================================================
  describe('POST / (schedule meeting)', () => {
    it('returns 410 because bot scheduling has been removed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          meetingUrl: 'https://meet.google.com/xyz-abcd-efg',
          title: 'Team Standup',
        },
      });

      expect(res.statusCode).toBe(410);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FEATURE_REMOVED');
    });
  });

  // =========================================================================
  // GET / (list meetings)
  // =========================================================================
  describe('GET / (list meetings)', () => {
    it('returns empty list of meetings', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns meetings for tenant', async () => {
      const meetings = [
        makeMeeting(TENANT_A, { id: 'm1', title: 'Meeting A' }),
        makeMeeting(TENANT_A, { id: 'm2', title: 'Meeting B' }),
      ];
      mockMeetingService.getMeetingsForTenant.mockResolvedValue(meetings);

      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);

      expect(mockMeetingService.getMeetingsForTenant).toHaveBeenCalledWith(
        TENANT_A,
        expect.objectContaining({ take: 20, skip: 0 }),
      );
    });

    it('passes status filter to service', async () => {
      await app.inject({ method: 'GET', url: '/?status=completed' });

      expect(mockMeetingService.getMeetingsForTenant).toHaveBeenCalledWith(
        TENANT_A,
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('passes limit and offset to service', async () => {
      await app.inject({ method: 'GET', url: '/?limit=5&offset=10' });

      expect(mockMeetingService.getMeetingsForTenant).toHaveBeenCalledWith(
        TENANT_A,
        expect.objectContaining({ take: 5, skip: 10 }),
      );
    });

    it('returns meta with limit and offset', async () => {
      const res = await app.inject({ method: 'GET', url: '/?limit=5&offset=10' });

      const body = res.json();
      expect(body.meta.limit).toBe(5);
      expect(body.meta.offset).toBe(10);
    });
  });

  // =========================================================================
  // GET /:id (get meeting details)
  // =========================================================================
  describe('GET /:id', () => {
    it('returns meeting when it belongs to the requesting tenant', async () => {
      const meeting = makeMeeting(TENANT_A);
      mockMeetingService.getMeeting.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'GET', url: '/meeting-001' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.id).toBe('meeting-001');
    });

    it('returns 404 when meeting belongs to another tenant', async () => {
      const meeting = makeMeeting(TENANT_B);
      mockMeetingService.getMeeting.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'GET', url: '/meeting-001' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when meeting does not exist', async () => {
      mockMeetingService.getMeeting.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/nonexistent' });

      expect(res.statusCode).toBe(404);
    });

    it('does not leak tenant information in 404', async () => {
      const meeting = makeMeeting(TENANT_B);
      mockMeetingService.getMeeting.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'GET', url: '/meeting-001' });

      expect(res.json().error.message).toBe('Meeting not found');
      expect(JSON.stringify(res.json())).not.toContain(TENANT_B);
    });
  });

  // =========================================================================
  // DELETE /:id (cancel meeting)
  // =========================================================================
  describe('DELETE /:id', () => {
    it('cancels meeting when it belongs to the requesting tenant', async () => {
      const meeting = makeMeeting(TENANT_A);
      mockMeetingRepository.findById.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'DELETE', url: '/meeting-001' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(mockPrisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'meeting-001' },
        data: { status: 'cancelled' },
      });
    });

    it('returns 404 when meeting belongs to another tenant', async () => {
      const meeting = makeMeeting(TENANT_B);
      mockMeetingRepository.findById.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'DELETE', url: '/meeting-001' });

      expect(res.statusCode).toBe(404);
      expect(mockPrisma.meeting.update).not.toHaveBeenCalled();
    });

    it('returns 404 when meeting does not exist', async () => {
      mockMeetingRepository.findById.mockResolvedValue(null);

      const res = await app.inject({ method: 'DELETE', url: '/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(mockPrisma.meeting.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // GET /:id/transcript
  // =========================================================================
  describe('GET /:id/transcript', () => {
    it('returns transcript when meeting belongs to tenant and has transcript', async () => {
      mockMeetingRepository.findByIdWithTranscript.mockResolvedValue({
        ...makeMeeting(TENANT_A),
        transcript: {
          id: 'transcript-001',
          fullText: 'Hello everyone.',
          segments: [{ speaker: 'Alice', text: 'Hello everyone.', startTime: 0, endTime: 2 }],
          duration: 3600,
          wordCount: 2,
        },
      });

      const res = await app.inject({ method: 'GET', url: '/meeting-001/transcript' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.fullText).toBe('Hello everyone.');
    });

    it('returns 404 when meeting belongs to another tenant', async () => {
      mockMeetingRepository.findByIdWithTranscript.mockResolvedValue({
        ...makeMeeting(TENANT_B),
        transcript: { id: 't1', fullText: 'secret' },
      });

      const res = await app.inject({ method: 'GET', url: '/meeting-001/transcript' });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when meeting has no transcript', async () => {
      mockMeetingRepository.findByIdWithTranscript.mockResolvedValue({
        ...makeMeeting(TENANT_A),
        transcript: null,
      });

      const res = await app.inject({ method: 'GET', url: '/meeting-001/transcript' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toBe('Transcript not found');
    });

    it('returns 404 when meeting does not exist', async () => {
      mockMeetingRepository.findByIdWithTranscript.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/nonexistent/transcript' });

      expect(res.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // GET /:id/insights
  // =========================================================================
  describe('GET /:id/insights', () => {
    it('returns insights for a meeting with generated insights', async () => {
      mockPrisma.meeting.findFirst.mockResolvedValue(makeMeeting(TENANT_A));
      mockPrisma.meetingInsights.findUnique.mockResolvedValue({
        id: 'insights-1',
        meetingId: 'meeting-001',
        summary: 'Discussed OAuth implementation.',
        decisions: [{ description: 'Use OAuth 2.0' }],
        actionItems: [{ description: 'Implement login flow', assignee: 'Bob' }],
      });

      const res = await app.inject({ method: 'GET', url: '/meeting-001/insights' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.summary).toBe('Discussed OAuth implementation.');
    });

    it('returns 404 when meeting does not exist or belongs to another tenant', async () => {
      mockPrisma.meeting.findFirst.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/nonexistent/insights' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when insights have not been generated yet', async () => {
      mockPrisma.meeting.findFirst.mockResolvedValue(makeMeeting(TENANT_A));
      mockPrisma.meetingInsights.findUnique.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/meeting-001/insights' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toContain('not yet generated');
    });
  });
});
