/**
 * Unit tests for Agents Routes — Task & PRD CRUD + Clarifications
 *
 * Tests:
 * - POST /ba/process: trigger BA agent (202, 404 no transcript, tenant isolation)
 * - GET /tasks: list tasks (200, filters, tenant scoping)
 * - GET /tasks/:id: get task details (200, 404, tenant isolation)
 * - GET /prds: list PRDs (200, filters, tenant scoping)
 * - GET /prds/:id: get PRD details (200, 404, tenant isolation)
 * - POST /prds/:id/approve: approve PRD (200, 404, 400 invalid status)
 * - POST /prds/:id/reject: reject PRD (200, 404, 400 invalid status)
 * - POST /prds/:id/tickets: create tickets (200, 404, 400 not approved)
 * - GET /clarifications: list pending (200, tenant scoping)
 * - POST /clarifications/:id/respond: respond (200, 404)
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

vi.mock('../../services/queue/processors.js', () => ({
  JobType: {
    BA_AGENT_PROCESS: 'ba_agent_process',
  },
}));

vi.mock('../../services/queue/queue.service.js', () => ({
  JobType: {
    BA_AGENT_PROCESS: 'ba_agent_process',
    DEV_AGENT_PROCESS: 'dev_agent_process',
  },
}));

import { agentRoutes } from '../agents.routes.js';

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';

function createMockTaskRepository() {
  return {
    findByIdWithClarifications: vi.fn().mockResolvedValue(null),
    findTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn().mockImplementation((data: any) => ({
      id: 'task-new',
      ...data,
      status: 'pending',
      createdAt: new Date(),
    })),
  };
}

function createMockPrdRepository() {
  return {
    findByIdWithTickets: vi.fn().mockResolvedValue(null),
    findByTenant: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockImplementation((id: string, status: string) => ({
      id,
      status,
    })),
  };
}

function createMockMeetingRepository() {
  return {
    findByIdWithTranscript: vi.fn().mockResolvedValue(null),
  };
}

function createMockBaAgentService() {
  return {
    createJiraTickets: vi.fn().mockResolvedValue({ created: [], failed: [] }),
    handleClarificationResponse: vi.fn().mockResolvedValue({ status: 'resolved' }),
    processClarificationResponse: vi.fn(),
  };
}

function createMockQueueService() {
  return {
    addJob: vi.fn().mockResolvedValue('job-1'),
  };
}

function createMockPrisma() {
  return {
    pRD: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    engagement: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    clarificationRequest: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

function createMockEngagementService() {
  return {
    advancePhase: vi.fn().mockResolvedValue({}),
  };
}

function makeTask(tenantId: string, overrides: Record<string, any> = {}) {
  return {
    id: 'task-001',
    tenantId,
    agentType: 'ba_agent',
    status: 'processing',
    confidence: 0.85,
    input: { type: 'meeting_transcript', meetingId: 'meeting-001' },
    output: null,
    clarifications: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrd(tenantId: string, overrides: Record<string, any> = {}) {
  return {
    id: 'prd-001',
    tenantId,
    title: 'Feature X PRD',
    summary: 'A summary',
    status: 'draft',
    confidence: 0.9,
    requirements: [],
    tickets: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function buildApp(
  tenantId: string = TENANT_A,
  extras: Record<string, unknown> = {},
): Promise<{
  app: FastifyInstance;
  taskRepository: ReturnType<typeof createMockTaskRepository>;
  prdRepository: ReturnType<typeof createMockPrdRepository>;
  meetingRepository: ReturnType<typeof createMockMeetingRepository>;
  baAgentService: ReturnType<typeof createMockBaAgentService>;
  queueService: ReturnType<typeof createMockQueueService>;
  prisma: ReturnType<typeof createMockPrisma>;
  engagementService: ReturnType<typeof createMockEngagementService>;
}> {
  const taskRepository = createMockTaskRepository();
  const prdRepository = createMockPrdRepository();
  const meetingRepository = createMockMeetingRepository();
  const baAgentService = createMockBaAgentService();
  const queueService = createMockQueueService();
  const prisma = createMockPrisma();
  const engagementService = createMockEngagementService();
  // N6 final: ticket-first writer stub. Routes call this now instead
  // of taskRepository.createTask directly. Returns the deterministic
  // 'task-new' id so the existing assertions (body.data.taskId,
  // queueService payload.taskId) keep working.
  const ticketService = {
    createAsNewWork: vi.fn(async (_input: any) => ({
      ticket: { id: 'tix_legacy_task-new' },
      agentTaskId: 'task-new',
    })),
  };

  const app = Fastify();
  app.decorate('services', {
    taskRepository,
    ticketService,
    prdRepository,
    meetingRepository,
    baAgentService,
    queueService,
    prisma,
    engagementService,
    auditService: { log: vi.fn() },
    ...extras,
  } as any);

  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = tenantId;
    (request as any).userId = 'user-001';
    (request as any).userRole = 'owner';
  });

  await app.register(agentRoutes);
  await app.ready();

  return { app, taskRepository, prdRepository, meetingRepository, baAgentService, queueService, prisma, engagementService };
}

describe('Agents Routes', () => {
  // =========================================================================
  // POST /ba/process
  // =========================================================================
  describe('POST /ba/process', () => {
    it('returns 202 when successfully queuing BA agent processing', async () => {
      const { app, meetingRepository, taskRepository, queueService } = await buildApp();

      meetingRepository.findByIdWithTranscript.mockResolvedValue({
        id: 'meeting-001',
        tenantId: TENANT_A,
        transcript: { id: 'transcript-001', fullText: 'Hello world' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/ba/process',
        payload: { meetingId: 'meeting-001' },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.taskId).toBe('task-new');
      expect(body.data.status).toBe('queued');
      expect(body.data.statusUrl).toContain('task-new');

      // N6 final: primary write is now ticketService.createAsNewWork.
      // taskRepository.createTask is no longer called by this route.
      expect(taskRepository.createTask).not.toHaveBeenCalled();
      expect(queueService.addJob).toHaveBeenCalled();
    });

    it('returns 404 when meeting has no transcript', async () => {
      const { app, meetingRepository } = await buildApp();

      meetingRepository.findByIdWithTranscript.mockResolvedValue({
        id: 'meeting-001',
        tenantId: TENANT_A,
        transcript: null,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/ba/process',
        payload: { meetingId: 'meeting-001' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toContain('Transcript not found');
    });

    it('returns 404 when meeting belongs to another tenant', async () => {
      const { app, meetingRepository } = await buildApp();

      meetingRepository.findByIdWithTranscript.mockResolvedValue({
        id: 'meeting-001',
        tenantId: TENANT_B,
        transcript: { id: 't1', fullText: 'secret' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/ba/process',
        payload: { meetingId: 'meeting-001' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toBe('Meeting not found');
    });

    it('returns 404 when meeting does not exist', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/ba/process',
        payload: { meetingId: 'nonexistent' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects missing meetingId', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/ba/process',
        payload: {},
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // GET /tasks
  // =========================================================================
  describe('GET /tasks', () => {
    it('returns tasks for the tenant', async () => {
      const { app, taskRepository } = await buildApp();
      const tasks = [makeTask(TENANT_A, { id: 't1' }), makeTask(TENANT_A, { id: 't2' })];
      taskRepository.findTasks.mockResolvedValue(tasks);

      const res = await app.inject({ method: 'GET', url: '/tasks' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(2);
      expect(taskRepository.findTasks).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_A }),
      );
    });

    it('passes status filter', async () => {
      const { app, taskRepository } = await buildApp();

      await app.inject({ method: 'GET', url: '/tasks?status=processing' });

      expect(taskRepository.findTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'processing' }),
      );
    });

    it('passes agentType filter', async () => {
      const { app, taskRepository } = await buildApp();

      await app.inject({ method: 'GET', url: '/tasks?agentType=ba_agent' });

      expect(taskRepository.findTasks).toHaveBeenCalledWith(
        expect.objectContaining({ agentType: 'ba_agent' }),
      );
    });

    it('passes limit and offset', async () => {
      const { app, taskRepository } = await buildApp();

      await app.inject({ method: 'GET', url: '/tasks?limit=5&offset=10' });

      expect(taskRepository.findTasks).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 10 }),
      );
    });
  });

  // =========================================================================
  // GET /tasks/:id
  // =========================================================================
  describe('GET /tasks/:id', () => {
    it('returns task when it belongs to the requesting tenant', async () => {
      const { app, taskRepository } = await buildApp();
      taskRepository.findByIdWithClarifications.mockResolvedValue(makeTask(TENANT_A));

      const res = await app.inject({ method: 'GET', url: '/tasks/task-001' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe('task-001');
    });

    it('returns 404 for another tenant task', async () => {
      const { app, taskRepository } = await buildApp();
      taskRepository.findByIdWithClarifications.mockResolvedValue(makeTask(TENANT_B));

      const res = await app.inject({ method: 'GET', url: '/tasks/task-001' });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when task does not exist', async () => {
      const { app } = await buildApp();

      const res = await app.inject({ method: 'GET', url: '/tasks/nonexistent' });

      expect(res.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // GET /prds
  // =========================================================================
  describe('GET /prds', () => {
    it('returns PRDs for the tenant', async () => {
      const { app, prdRepository } = await buildApp();
      const prds = [makePrd(TENANT_A, { id: 'p1' }), makePrd(TENANT_A, { id: 'p2' })];
      prdRepository.findByTenant.mockResolvedValue(prds);

      const res = await app.inject({ method: 'GET', url: '/prds' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(2);
      expect(prdRepository.findByTenant).toHaveBeenCalledWith(
        TENANT_A,
        undefined,
        expect.objectContaining({ take: 20, skip: 0 }),
      );
    });

    it('passes status filter', async () => {
      const { app, prdRepository } = await buildApp();

      await app.inject({ method: 'GET', url: '/prds?status=approved' });

      expect(prdRepository.findByTenant).toHaveBeenCalledWith(
        TENANT_A,
        'approved',
        expect.anything(),
      );
    });
  });

  // =========================================================================
  // GET /prds/:id
  // =========================================================================
  describe('GET /prds/:id', () => {
    it('returns PRD when it belongs to the requesting tenant', async () => {
      const { app, prdRepository } = await buildApp();
      prdRepository.findByIdWithTickets.mockResolvedValue(makePrd(TENANT_A));

      const res = await app.inject({ method: 'GET', url: '/prds/prd-001' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe('prd-001');
    });

    it('returns 404 for another tenant PRD', async () => {
      const { app, prdRepository } = await buildApp();
      prdRepository.findByIdWithTickets.mockResolvedValue(makePrd(TENANT_B));

      const res = await app.inject({ method: 'GET', url: '/prds/prd-001' });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when PRD does not exist', async () => {
      const { app } = await buildApp();

      const res = await app.inject({ method: 'GET', url: '/prds/nonexistent' });

      expect(res.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // POST /prds/:id/approve
  // =========================================================================
  describe('POST /prds/:id/approve', () => {
    it('approves PRD that belongs to the requesting tenant', async () => {
      const { app, prdRepository, prisma } = await buildApp();
      prdRepository.findById.mockResolvedValue(makePrd(TENANT_A, { status: 'draft' }));
      prdRepository.updateStatus.mockResolvedValue(makePrd(TENANT_A, { status: 'approved' }));
      prisma.pRD.findUnique.mockResolvedValue({ meetingId: null });

      const res = await app.inject({ method: 'POST', url: '/prds/prd-001/approve' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(prdRepository.updateStatus).toHaveBeenCalledWith('prd-001', 'approved');
    });

    it('returns 404 for another tenant PRD', async () => {
      const { app, prdRepository } = await buildApp();
      prdRepository.findById.mockResolvedValue(makePrd(TENANT_B));

      const res = await app.inject({ method: 'POST', url: '/prds/prd-001/approve' });

      expect(res.statusCode).toBe(404);
      expect(prdRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('returns 404 when PRD does not exist', async () => {
      const { app, prdRepository } = await buildApp();

      const res = await app.inject({ method: 'POST', url: '/prds/nonexistent/approve' });

      expect(res.statusCode).toBe(404);
      expect(prdRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('returns 400 when PRD status is already approved', async () => {
      const { app, prdRepository } = await buildApp();
      prdRepository.findById.mockResolvedValue(makePrd(TENANT_A, { status: 'approved' }));

      const res = await app.inject({ method: 'POST', url: '/prds/prd-001/approve' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_STATUS');
      expect(prdRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('returns 400 when PRD status is rejected', async () => {
      const { app, prdRepository } = await buildApp();
      prdRepository.findById.mockResolvedValue(makePrd(TENANT_A, { status: 'rejected' }));

      const res = await app.inject({ method: 'POST', url: '/prds/prd-001/approve' });

      expect(res.statusCode).toBe(400);
    });

    it('allows approval from pending_approval status', async () => {
      const { app, prdRepository, prisma } = await buildApp();
      prdRepository.findById.mockResolvedValue(makePrd(TENANT_A, { status: 'pending_approval' }));
      prdRepository.updateStatus.mockResolvedValue(makePrd(TENANT_A, { status: 'approved' }));
      prisma.pRD.findUnique.mockResolvedValue({ meetingId: null });

      const res = await app.inject({ method: 'POST', url: '/prds/prd-001/approve' });

      expect(res.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // POST /prds/:id/reject
  // =========================================================================
  describe('POST /prds/:id/reject', () => {
    it('rejects PRD with a reason', async () => {
      const { app, prdRepository } = await buildApp();
      prdRepository.findById.mockResolvedValue(makePrd(TENANT_A, { status: 'draft' }));
      prdRepository.updateStatus.mockResolvedValue(makePrd(TENANT_A, { status: 'rejected' }));

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/reject',
        payload: { reason: 'Needs more detail' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(prdRepository.updateStatus).toHaveBeenCalledWith('prd-001', 'rejected');
    });

    it('rejects PRD without a reason', async () => {
      const { app, prdRepository } = await buildApp();
      prdRepository.findById.mockResolvedValue(makePrd(TENANT_A, { status: 'draft' }));
      prdRepository.updateStatus.mockResolvedValue(makePrd(TENANT_A, { status: 'rejected' }));

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/reject',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 404 for another tenant PRD', async () => {
      const { app, prdRepository } = await buildApp();
      prdRepository.findById.mockResolvedValue(makePrd(TENANT_B));

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/reject',
        payload: { reason: 'test' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when PRD has already been approved', async () => {
      const { app, prdRepository } = await buildApp();
      prdRepository.findById.mockResolvedValue(makePrd(TENANT_A, { status: 'approved' }));

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/reject',
        payload: { reason: 'too late' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_STATUS');
    });
  });

  // =========================================================================
  // POST /prds/:id/tickets
  // =========================================================================
  describe('POST /prds/:id/tickets', () => {
    it('creates tickets for approved PRD', async () => {
      const { app, prdRepository, baAgentService } = await buildApp();
      prdRepository.findByIdWithTickets.mockResolvedValue(makePrd(TENANT_A, { status: 'approved' }));
      baAgentService.createJiraTickets.mockResolvedValue({
        created: [{ key: 'PROJ-1' }, { key: 'PROJ-2' }],
        failed: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/tickets',
        payload: { projectKey: 'PROJ' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.created).toHaveLength(2);
      expect(res.json().data.failed).toHaveLength(0);
    });

    it('returns 404 for another tenant PRD', async () => {
      const { app, prdRepository, baAgentService } = await buildApp();
      prdRepository.findByIdWithTickets.mockResolvedValue(makePrd(TENANT_B, { status: 'approved' }));

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/tickets',
        payload: { projectKey: 'PROJ' },
      });

      expect(res.statusCode).toBe(404);
      expect(baAgentService.createJiraTickets).not.toHaveBeenCalled();
    });

    it('returns 400 when PRD is not approved', async () => {
      const { app, prdRepository, baAgentService } = await buildApp();
      prdRepository.findByIdWithTickets.mockResolvedValue(makePrd(TENANT_A, { status: 'draft' }));

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/tickets',
        payload: { projectKey: 'PROJ' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(baAgentService.createJiraTickets).not.toHaveBeenCalled();
    });

    it('validates projectKey format (uppercase alphanumeric)', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/tickets',
        payload: { projectKey: 'invalid-key' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('rejects missing projectKey', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/tickets',
        payload: {},
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // GET /clarifications
  // =========================================================================
  describe('GET /clarifications', () => {
    it('returns pending clarifications for the tenant', async () => {
      const { app, taskRepository } = await buildApp();
      const tasks = [makeTask(TENANT_A, { status: 'awaiting_clarification' })];
      taskRepository.findTasks.mockResolvedValue(tasks);

      const res = await app.inject({ method: 'GET', url: '/clarifications' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(taskRepository.findTasks).toHaveBeenCalledWith({
        tenantId: TENANT_A,
        status: 'awaiting_clarification',
      });
    });

    it('returns empty list when no pending clarifications', async () => {
      const { app } = await buildApp();

      const res = await app.inject({ method: 'GET', url: '/clarifications' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
    });
  });

  // =========================================================================
  // POST /clarifications/:id/respond
  // =========================================================================
  describe('POST /clarifications/:id/respond', () => {
    it('processes clarification response', async () => {
      const { app, baAgentService, prisma } = await buildApp();
      prisma.clarificationRequest.findUnique.mockResolvedValue({
        id: 'clar-001',
        task: { tenantId: TENANT_A },
      });
      baAgentService.handleClarificationResponse.mockResolvedValue({
        status: 'resolved',
        answer: 'Use OAuth 2.0',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/clarifications/clar-001/respond',
        payload: { answer: 'Use OAuth 2.0' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('returns 404 when clarification does not exist', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/clarifications/nonexistent/respond',
        payload: { answer: 'Some answer' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when clarification belongs to another tenant', async () => {
      const { app, prisma } = await buildApp();
      prisma.clarificationRequest.findUnique.mockResolvedValue({
        id: 'clar-001',
        task: { tenantId: TENANT_B },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/clarifications/clar-001/respond',
        payload: { answer: 'Some answer' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects missing answer', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/clarifications/clar-001/respond',
        payload: {},
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('returns 500 when clarification processing fails', async () => {
      const { app, baAgentService, prisma } = await buildApp();
      prisma.clarificationRequest.findUnique.mockResolvedValue({
        id: 'clar-001',
        task: { tenantId: TENANT_A },
      });
      baAgentService.handleClarificationResponse.mockRejectedValue(
        new Error('Processing failed'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/clarifications/clar-001/respond',
        payload: { answer: 'Some answer' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error.code).toBe('PROCESSING_ERROR');
    });
  });
});
