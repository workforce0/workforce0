/**
 * Security tests for Meetings Routes - IDOR Protection
 *
 * Verifies that tenant isolation is enforced on all single-resource endpoints.
 * A user from Tenant A must NOT be able to access or modify Tenant B's meetings.
 *
 * Tests:
 * - GET /meetings/:id returns 404 for another tenant's meeting
 * - DELETE /meetings/:id returns 404 for another tenant's meeting
 * - GET /meetings/:id/transcript returns 404 for another tenant's meeting
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

function createMockMeetingRepository() {
  return {
    findById: vi.fn(),
    findByIdWithTranscript: vi.fn(),
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

  // Simulate auth middleware setting tenantId for the requesting user
  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = tenantId;
  });

  await app.register(meetingRoutes);
  await app.ready();
  return app;
}

// --- Test data ---

function makeMeeting(tenantId: string) {
  return {
    id: 'meeting-001',
    tenantId,
    title: 'Sprint Planning',
    status: 'completed',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    startTime: new Date(),
    createdAt: new Date(),
  };
}

function makeMeetingWithTranscript(tenantId: string) {
  return {
    ...makeMeeting(tenantId),
    transcript: {
      id: 'transcript-001',
      fullText: 'Hello everyone, let us discuss the sprint goals.',
      segments: [{ speaker: 'Alice', text: 'Hello everyone', startTime: 0, endTime: 2 }],
      duration: 3600,
      wordCount: 250,
    },
  };
}

describe('Meetings Routes - IDOR Security', () => {
  let app: FastifyInstance;
  let mockMeetingService: ReturnType<typeof createMockMeetingService>;
  let mockMeetingRepository: ReturnType<typeof createMockMeetingRepository>;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMeetingService = createMockMeetingService();
    mockMeetingRepository = createMockMeetingRepository();
    mockPrisma = createMockPrisma();
    // Build app as Tenant A (the requesting user)
    app = await buildApp(mockMeetingService, mockMeetingRepository, TENANT_A, mockPrisma);
  });

  // =========================================================================
  // GET /:id - Tenant isolation
  // =========================================================================
  describe('GET /:id - tenant isolation', () => {
    it('returns meeting when it belongs to the requesting tenant', async () => {
      const meeting = makeMeeting(TENANT_A);
      mockMeetingService.getMeeting.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'GET', url: '/meeting-001' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.id).toBe('meeting-001');
    });

    it('returns 404 when meeting belongs to a different tenant (IDOR protection)', async () => {
      // Meeting belongs to Tenant B, but request is from Tenant A
      const meeting = makeMeeting(TENANT_B);
      mockMeetingService.getMeeting.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'GET', url: '/meeting-001' });

      expect(res.statusCode).toBe(404);
      expect(res.json().success).toBe(false);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when meeting does not exist', async () => {
      mockMeetingService.getMeeting.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('does not leak tenant information in error response for wrong tenant', async () => {
      const meeting = makeMeeting(TENANT_B);
      mockMeetingService.getMeeting.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'GET', url: '/meeting-001' });

      // Error message should be generic, not revealing "belongs to another tenant"
      expect(res.json().error.message).toBe('Meeting not found');
      expect(JSON.stringify(res.json())).not.toContain(TENANT_B);
    });
  });

  // =========================================================================
  // DELETE /:id - Tenant isolation
  // =========================================================================
  describe('DELETE /:id - tenant isolation', () => {
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

    it('returns 404 when meeting belongs to a different tenant (IDOR protection)', async () => {
      // Meeting belongs to Tenant B, but request is from Tenant A
      const meeting = makeMeeting(TENANT_B);
      mockMeetingRepository.findById.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'DELETE', url: '/meeting-001' });

      expect(res.statusCode).toBe(404);
      expect(res.json().success).toBe(false);
      expect(res.json().error.code).toBe('NOT_FOUND');
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
  // GET /:id/transcript - Tenant isolation
  // =========================================================================
  describe('GET /:id/transcript - tenant isolation', () => {
    it('returns transcript when meeting belongs to the requesting tenant', async () => {
      const meeting = makeMeetingWithTranscript(TENANT_A);
      mockMeetingRepository.findByIdWithTranscript.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'GET', url: '/meeting-001/transcript' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.fullText).toBeDefined();
    });

    it('returns 404 when meeting belongs to a different tenant (IDOR protection)', async () => {
      const meeting = makeMeetingWithTranscript(TENANT_B);
      mockMeetingRepository.findByIdWithTranscript.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'GET', url: '/meeting-001/transcript' });

      expect(res.statusCode).toBe(404);
      expect(res.json().success).toBe(false);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when meeting exists but has no transcript (own tenant)', async () => {
      const meeting = { ...makeMeeting(TENANT_A), transcript: null };
      mockMeetingRepository.findByIdWithTranscript.mockResolvedValue(meeting);

      const res = await app.inject({ method: 'GET', url: '/meeting-001/transcript' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toBe('Transcript not found');
    });
  });
});
