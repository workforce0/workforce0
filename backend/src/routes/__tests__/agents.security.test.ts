/**
 * Security tests for Agents Routes - IDOR Protection
 *
 * Verifies that tenant isolation is enforced on all single-resource endpoints.
 * A user from Tenant A must NOT be able to access or modify Tenant B's tasks/PRDs.
 *
 * Tests:
 * - GET /tasks/:id returns 404 for another tenant's task
 * - GET /prds/:id returns 404 for another tenant's PRD
 * - POST /prds/:id/approve returns 404 for another tenant's PRD
 * - POST /prds/:id/reject returns 404 for another tenant's PRD
 * - POST /prds/:id/tickets returns 404 for another tenant's PRD
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

// Mock the queue processors import (required by agents.routes.ts)
vi.mock('../../services/queue/processors.js', () => ({
  JobType: {
    BA_AGENT_PROCESS: 'ba_agent_process',
  },
}));

import { agentRoutes } from '../agents.routes.js';

// --- Constants ---

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';

// --- Mock helpers ---

function createMockTaskRepository() {
  return {
    findByIdWithClarifications: vi.fn(),
    findTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
  };
}

function createMockPrdRepository() {
  return {
    findByIdWithTickets: vi.fn(),
    findByTenant: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    updateStatus: vi.fn(),
  };
}

function createMockMeetingRepository() {
  return {
    findByIdWithTranscript: vi.fn(),
  };
}

function createMockBaAgentService() {
  return {
    createJiraTickets: vi.fn(),
    handleClarificationResponse: vi.fn(),
    processClarificationResponse: vi.fn(),
  };
}

function createMockQueueService() {
  return {
    addJob: vi.fn(),
  };
}

async function buildApp(
  taskRepository: ReturnType<typeof createMockTaskRepository>,
  prdRepository: ReturnType<typeof createMockPrdRepository>,
  tenantId: string,
  extras: Record<string, unknown> = {}
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('services', {
    taskRepository,
    prdRepository,
    meetingRepository: createMockMeetingRepository(),
    baAgentService: createMockBaAgentService(),
    queueService: createMockQueueService(),
    auditService: { log: vi.fn() },
    ...extras,
  } as any);

  // Simulate auth middleware setting tenantId for the requesting user
  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = tenantId;
    (request as any).userRole = 'owner';
  });

  await app.register(agentRoutes);
  await app.ready();
  return app;
}

// --- Test data ---

function makeTask(tenantId: string) {
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
  };
}

function makePrd(tenantId: string, status = 'draft') {
  return {
    id: 'prd-001',
    tenantId,
    title: 'Feature X PRD',
    summary: 'A summary of the PRD',
    status,
    confidence: 0.9,
    requirements: [],
    tickets: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('Agents Routes - IDOR Security', () => {
  let app: FastifyInstance;
  let mockTaskRepository: ReturnType<typeof createMockTaskRepository>;
  let mockPrdRepository: ReturnType<typeof createMockPrdRepository>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockTaskRepository = createMockTaskRepository();
    mockPrdRepository = createMockPrdRepository();
    // Build app as Tenant A (the requesting user)
    app = await buildApp(mockTaskRepository, mockPrdRepository, TENANT_A);
  });

  // =========================================================================
  // GET /tasks/:id - Tenant isolation
  // =========================================================================
  describe('GET /tasks/:id - tenant isolation', () => {
    it('returns task when it belongs to the requesting tenant', async () => {
      const task = makeTask(TENANT_A);
      mockTaskRepository.findByIdWithClarifications.mockResolvedValue(task);

      const res = await app.inject({ method: 'GET', url: '/tasks/task-001' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.id).toBe('task-001');
    });

    it('returns 404 when task belongs to a different tenant (IDOR protection)', async () => {
      const task = makeTask(TENANT_B);
      mockTaskRepository.findByIdWithClarifications.mockResolvedValue(task);

      const res = await app.inject({ method: 'GET', url: '/tasks/task-001' });

      expect(res.statusCode).toBe(404);
      expect(res.json().success).toBe(false);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when task does not exist', async () => {
      mockTaskRepository.findByIdWithClarifications.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/tasks/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('does not leak tenant information in error response for wrong tenant', async () => {
      const task = makeTask(TENANT_B);
      mockTaskRepository.findByIdWithClarifications.mockResolvedValue(task);

      const res = await app.inject({ method: 'GET', url: '/tasks/task-001' });

      expect(res.json().error.message).toBe('Task not found');
      expect(JSON.stringify(res.json())).not.toContain(TENANT_B);
    });
  });

  // =========================================================================
  // GET /prds/:id - Tenant isolation
  // =========================================================================
  describe('GET /prds/:id - tenant isolation', () => {
    it('returns PRD when it belongs to the requesting tenant', async () => {
      const prd = makePrd(TENANT_A);
      mockPrdRepository.findByIdWithTickets.mockResolvedValue(prd);

      const res = await app.inject({ method: 'GET', url: '/prds/prd-001' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.id).toBe('prd-001');
    });

    it('returns 404 when PRD belongs to a different tenant (IDOR protection)', async () => {
      const prd = makePrd(TENANT_B);
      mockPrdRepository.findByIdWithTickets.mockResolvedValue(prd);

      const res = await app.inject({ method: 'GET', url: '/prds/prd-001' });

      expect(res.statusCode).toBe(404);
      expect(res.json().success).toBe(false);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when PRD does not exist', async () => {
      mockPrdRepository.findByIdWithTickets.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/prds/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('does not leak tenant information in error response for wrong tenant', async () => {
      const prd = makePrd(TENANT_B);
      mockPrdRepository.findByIdWithTickets.mockResolvedValue(prd);

      const res = await app.inject({ method: 'GET', url: '/prds/prd-001' });

      expect(res.json().error.message).toBe('PRD not found');
      expect(JSON.stringify(res.json())).not.toContain(TENANT_B);
    });
  });

  // =========================================================================
  // POST /prds/:id/approve - Tenant isolation
  // =========================================================================
  describe('POST /prds/:id/approve - tenant isolation', () => {
    it('approves PRD when it belongs to the requesting tenant', async () => {
      const prd = makePrd(TENANT_A);
      mockPrdRepository.findById.mockResolvedValue(prd);
      mockPrdRepository.updateStatus.mockResolvedValue({ ...prd, status: 'approved' });

      const res = await app.inject({ method: 'POST', url: '/prds/prd-001/approve' });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(mockPrdRepository.updateStatus).toHaveBeenCalledWith('prd-001', 'approved');
    });

    it('returns 404 when PRD belongs to a different tenant (IDOR protection)', async () => {
      const prd = makePrd(TENANT_B);
      mockPrdRepository.findById.mockResolvedValue(prd);

      const res = await app.inject({ method: 'POST', url: '/prds/prd-001/approve' });

      expect(res.statusCode).toBe(404);
      expect(res.json().success).toBe(false);
      expect(res.json().error.code).toBe('NOT_FOUND');
      // updateStatus must NOT have been called
      expect(mockPrdRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('returns 404 when PRD does not exist', async () => {
      mockPrdRepository.findById.mockResolvedValue(null);

      const res = await app.inject({ method: 'POST', url: '/prds/nonexistent/approve' });

      expect(res.statusCode).toBe(404);
      expect(mockPrdRepository.updateStatus).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // POST /prds/:id/reject - Tenant isolation
  // =========================================================================
  describe('POST /prds/:id/reject - tenant isolation', () => {
    it('rejects PRD when it belongs to the requesting tenant', async () => {
      const prd = makePrd(TENANT_A);
      mockPrdRepository.findById.mockResolvedValue(prd);
      mockPrdRepository.updateStatus.mockResolvedValue({ ...prd, status: 'rejected' });

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/reject',
        payload: { reason: 'Needs more detail' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(mockPrdRepository.updateStatus).toHaveBeenCalledWith('prd-001', 'rejected');
    });

    it('returns 404 when PRD belongs to a different tenant (IDOR protection)', async () => {
      const prd = makePrd(TENANT_B);
      mockPrdRepository.findById.mockResolvedValue(prd);

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/reject',
        payload: { reason: 'Rejected' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().success).toBe(false);
      expect(res.json().error.code).toBe('NOT_FOUND');
      expect(mockPrdRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('returns 404 when PRD does not exist', async () => {
      mockPrdRepository.findById.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/prds/nonexistent/reject',
        payload: { reason: 'Does not exist' },
      });

      expect(res.statusCode).toBe(404);
      expect(mockPrdRepository.updateStatus).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // POST /prds/:id/tickets - Tenant isolation
  // =========================================================================
  describe('POST /prds/:id/tickets - tenant isolation', () => {
    it('creates tickets when PRD belongs to the requesting tenant and is approved', async () => {
      const prd = makePrd(TENANT_A, 'approved');
      mockPrdRepository.findByIdWithTickets.mockResolvedValue(prd);

      const mockBaAgent = createMockBaAgentService();
      mockBaAgent.createJiraTickets.mockResolvedValue({
        created: [{ key: 'PROJ-1' }],
        failed: [],
      });

      // Rebuild app with the custom baAgentService
      app = await buildApp(mockTaskRepository, mockPrdRepository, TENANT_A, {
        baAgentService: mockBaAgent,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/tickets',
        payload: { projectKey: 'PROJ' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(mockBaAgent.createJiraTickets).toHaveBeenCalled();
    });

    it('returns 404 when PRD belongs to a different tenant (IDOR protection)', async () => {
      const prd = makePrd(TENANT_B, 'approved');
      mockPrdRepository.findByIdWithTickets.mockResolvedValue(prd);

      const mockBaAgent = createMockBaAgentService();
      app = await buildApp(mockTaskRepository, mockPrdRepository, TENANT_A, {
        baAgentService: mockBaAgent,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/tickets',
        payload: { projectKey: 'PROJ' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().success).toBe(false);
      expect(res.json().error.code).toBe('NOT_FOUND');
      // createJiraTickets must NOT have been called
      expect(mockBaAgent.createJiraTickets).not.toHaveBeenCalled();
    });

    it('returns 404 when PRD does not exist', async () => {
      mockPrdRepository.findByIdWithTickets.mockResolvedValue(null);

      const mockBaAgent = createMockBaAgentService();
      app = await buildApp(mockTaskRepository, mockPrdRepository, TENANT_A, {
        baAgentService: mockBaAgent,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/prds/nonexistent/tickets',
        payload: { projectKey: 'PROJ' },
      });

      expect(res.statusCode).toBe(404);
      expect(mockBaAgent.createJiraTickets).not.toHaveBeenCalled();
    });

    it('returns 400 when own-tenant PRD is not approved', async () => {
      const prd = makePrd(TENANT_A, 'draft');
      mockPrdRepository.findByIdWithTickets.mockResolvedValue(prd);

      const mockBaAgent = createMockBaAgentService();
      app = await buildApp(mockTaskRepository, mockPrdRepository, TENANT_A, {
        baAgentService: mockBaAgent,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/prds/prd-001/tickets',
        payload: { projectKey: 'PROJ' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(mockBaAgent.createJiraTickets).not.toHaveBeenCalled();
    });
  });
});
