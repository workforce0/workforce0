/**
 * =============================================================================
 * Integration Test — Full Dev → QA Agent Dispatch Chain
 * =============================================================================
 *
 * Tests the end-to-end flow:
 *   PRD → dev job dispatch → dev complete → QA job chained → QA complete
 *
 * Uses mock Prisma, SSE, OutcomeObserver, EngagementService, and
 * CommunicationRouter so the test runs entirely in-memory with no external
 * dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { AgentHub } from '../../services/agent-hub/agent-hub.service.js';
import { AgentJobQueue } from '../../services/agent-hub/job-queue.js';

// ---------------------------------------------------------------------------
// MockWebSocket — mirrors the pattern from agent-hub.service.test.ts
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  closedWith?: { code: number; reason: string };
  private listeners = new Map<string, Function[]>();

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closedWith = { code: code || 1000, reason: reason || '' };
    this.readyState = MockWebSocket.CLOSED;
  }

  on(event: string, cb: Function) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  simulateMessage(msg: object) {
    const cbs = this.listeners.get('message') || [];
    for (const cb of cbs) cb(JSON.stringify(msg));
  }

  simulateClose() {
    const cbs = this.listeners.get('close') || [];
    for (const cb of cbs) cb();
  }

  getSentMessages(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }

  getLastSentMessage(): any {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'wf0_integration_test_token';
const TOKEN_HASH = crypto.createHash('sha256').update(TEST_TOKEN).digest('hex');

/**
 * Flush the microtask queue so resolved promises have a chance to settle.
 * Uses process.nextTick which is never faked by vi.useFakeTimers().
 */
function flush(): Promise<void> {
  return new Promise((resolve) => process.nextTick(resolve));
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    agentToken: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'tok-integration-1',
        tenantId: 'tenant-1',
        tokenHash: TOKEN_HASH,
        revokedAt: null,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    agentJob: {
      // create is used by AgentJobQueue.enqueue
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: `job-${crypto.randomUUID().slice(0, 8)}`,
          ...data,
        }),
      ),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    agentTask: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

function createMockSSE() {
  return { publish: vi.fn() };
}

function createMockOutcomeObserver() {
  return { recordFromTask: vi.fn().mockResolvedValue(undefined) };
}

function createMockEngagementService() {
  return { advancePhase: vi.fn().mockResolvedValue(undefined) };
}

function createMockCommsRouter() {
  return { notify: vi.fn().mockResolvedValue(undefined) };
}

// ---------------------------------------------------------------------------
// connect + auth + register helper
// ---------------------------------------------------------------------------

async function connectAndRegister(
  hub: AgentHub,
  prisma: ReturnType<typeof createMockPrisma>,
  repos: string[] = ['acme/backend'],
  capabilities: string[] = ['implement_prd'],
): Promise<{ ws: MockWebSocket; agentId: string }> {
  const ws = new MockWebSocket();

  // Make sure findUnique returns a valid token record for this connection
  prisma.agentToken.findUnique.mockResolvedValue({
    id: 'tok-integration-1',
    tenantId: 'tenant-1',
    tokenHash: TOKEN_HASH,
    revokedAt: null,
  });

  hub.handleConnection(ws as any);
  ws.simulateMessage({ type: 'auth', token: TEST_TOKEN });

  // Wait for auth_ok
  await flush();
  const authOk = ws.getSentMessages().find((m) => m.type === 'auth_ok');
  expect(authOk).toBeDefined();

  ws.simulateMessage({ type: 'register', repos, capabilities });
  // deliverQueuedJobs is async; give it a tick to settle
  await flush();

  const registered = ws.getSentMessages().find((m) => m.type === 'registered');
  expect(registered).toBeDefined();

  return { ws, agentId: authOk.agentId as string };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Dispatch Chain — Integration', () => {
  let hub: AgentHub;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockSSE: ReturnType<typeof createMockSSE>;
  let mockOutcomeObserver: ReturnType<typeof createMockOutcomeObserver>;
  let mockEngagementService: ReturnType<typeof createMockEngagementService>;
  let mockCommsRouter: ReturnType<typeof createMockCommsRouter>;
  let jobQueue: AgentJobQueue;

  // Track jobIds created during create so we can look them up later
  let createdJobIds: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    createdJobIds = [];

    mockPrisma = createMockPrisma();
    mockSSE = createMockSSE();
    mockOutcomeObserver = createMockOutcomeObserver();
    mockEngagementService = createMockEngagementService();
    mockCommsRouter = createMockCommsRouter();

    // Intercept agentJob.create so we can capture generated IDs
    mockPrisma.agentJob.create.mockImplementation(({ data }: any) => {
      const id = `job-${createdJobIds.length + 1}`;
      createdJobIds.push(id);
      return Promise.resolve({ id, ...data });
    });

    jobQueue = new AgentJobQueue(mockPrisma);

    hub = new AgentHub(
      mockPrisma,
      mockSSE,
      jobQueue,
      mockOutcomeObserver,
      mockEngagementService,
      mockCommsRouter,
    );
  });

  afterEach(async () => {
    const shutdownPromise = hub.shutdown();
    vi.advanceTimersByTime(3000);
    await shutdownPromise;
    vi.useRealTimers();
  });

  // ── Test 1: Full dev → QA chain ──────────────────────────────────────

  it('Test 1: full dev → QA chain — dev complete triggers QA job and phase advance', async () => {
    // 1. Connect and register agent for acme/backend
    const { ws } = await connectAndRegister(hub, mockPrisma, ['acme/backend'], ['implement_prd', 'review_pr']);

    // 2. Dispatch a dev job
    const devJobId = await hub.dispatchJob('tenant-1', 'acme/backend', {
      tenantId: 'tenant-1',
      action: 'implement_prd',
      targetRepo: 'acme/backend',
      payload: {
        taskId: 'task-1',
        branch: 'feat/test',
        prdContent: 'Implement user auth',
        agentType: 'dev_agent',
      },
    });

    expect(typeof devJobId).toBe('string');

    // 3. Verify agent receives the dev job
    const jobMsg = ws.getSentMessages().find((m) => m.type === 'job');
    expect(jobMsg).toBeDefined();
    expect(jobMsg.action).toBe('implement_prd');
    expect(jobMsg.jobId).toBe(devJobId);

    // 4. Set up prisma mocks so bridge logic can look up the job and task
    mockPrisma.agentJob.findUnique.mockResolvedValue({
      id: devJobId,
      tenantId: 'tenant-1',
      targetRepo: 'acme/backend',
      payload: {
        taskId: 'task-1',
        branch: 'feat/test',
        prdContent: 'Implement user auth',
      },
      result: null,
    });

    mockPrisma.agentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      agentType: 'dev_agent',
      meetingId: 'meeting-test',
    });

    // 5. Agent completes the dev job
    ws.simulateMessage({
      type: 'job_result',
      jobId: devJobId,
      status: 'done',
      data: { prUrl: 'https://github.com/acme/backend/pull/42' },
    });
    await flush();

    // 6a. AgentTask 'task-1' updated to 'completed'
    expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'completed',
          completedAt: expect.any(Date),
          error: null,
        }),
      }),
    );

    // 6b. OutcomeObserver.recordFromTask called with 'task-1'
    expect(mockOutcomeObserver.recordFromTask).toHaveBeenCalledWith('task-1');

    // 6c. EngagementService.advancePhase called with ('meeting-test', 'test')
    expect(mockEngagementService.advancePhase).toHaveBeenCalledWith('meeting-test', 'test');

    // 6d. A new AgentJob created with action 'review_pr' (the QA chain)
    const enqueueCalls = mockPrisma.agentJob.create.mock.calls;
    const qaJobCall = enqueueCalls.find(
      (call: any[]) => call[0]?.data?.action === 'review_pr',
    );
    expect(qaJobCall).toBeDefined();
    expect(qaJobCall![0].data).toMatchObject({
      action: 'review_pr',
      tenantId: 'tenant-1',
      targetRepo: 'acme/backend',
    });

    // 6e. Agent receives the QA job too
    const allJobMsgs = ws.getSentMessages().filter((m) => m.type === 'job');
    expect(allJobMsgs.length).toBeGreaterThanOrEqual(2);
    const qaJobMsg = allJobMsgs.find((m) => m.action === 'review_pr');
    expect(qaJobMsg).toBeDefined();
  });

  // ── Test 2: Dev failure — QA NOT triggered ───────────────────────────

  it('Test 2: dev failure — QA job NOT dispatched, advancePhase NOT called', async () => {
    // 1. Connect and register agent
    const { ws } = await connectAndRegister(hub, mockPrisma, ['acme/backend'], ['implement_prd']);

    // 2. Dispatch dev job
    const devJobId = await hub.dispatchJob('tenant-1', 'acme/backend', {
      tenantId: 'tenant-1',
      action: 'implement_prd',
      targetRepo: 'acme/backend',
      payload: {
        taskId: 'task-1',
        branch: 'feat/test',
        prdContent: 'Implement user auth',
      },
    });

    // Verify agent received the job
    const jobMsg = ws.getSentMessages().find((m) => m.type === 'job');
    expect(jobMsg).toBeDefined();
    expect(jobMsg.jobId).toBe(devJobId);

    // Set up mocks for bridge lookup
    mockPrisma.agentJob.findUnique.mockResolvedValue({
      id: devJobId,
      tenantId: 'tenant-1',
      targetRepo: 'acme/backend',
      payload: { taskId: 'task-1', branch: 'feat/test' },
      result: null,
    });

    mockPrisma.agentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      agentType: 'dev_agent',
      meetingId: 'meeting-test',
    });

    // 3. Agent sends failure result
    ws.simulateMessage({
      type: 'job_result',
      jobId: devJobId,
      status: 'failed',
      data: { error: 'Claude crashed' },
    });
    await flush();

    // 4a. AgentTask updated to 'failed'
    expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'failed',
          error: 'Claude crashed',
        }),
      }),
    );

    // 4b. QA job NOT dispatched — no review_pr in create calls
    const enqueueCalls = mockPrisma.agentJob.create.mock.calls;
    const qaJobCalls = enqueueCalls.filter(
      (call: any[]) => call[0]?.data?.action === 'review_pr',
    );
    expect(qaJobCalls).toHaveLength(0);

    // 4c. EngagementService.advancePhase NOT called
    expect(mockEngagementService.advancePhase).not.toHaveBeenCalled();
  });

  // ── Test 3: No taskId in payload — graceful ───────────────────────────

  it('Test 3: no taskId in payload — no crash, AgentJob marked complete, no AgentTask update', async () => {
    // 1. Connect and register agent
    const { ws } = await connectAndRegister(hub, mockPrisma, ['acme/backend'], ['implement_prd']);

    // 2. Dispatch job with no taskId in payload
    const jobId = await hub.dispatchJob('tenant-1', 'acme/backend', {
      tenantId: 'tenant-1',
      action: 'implement_prd',
      targetRepo: 'acme/backend',
      payload: {
        branch: 'feat/no-task',
        prdContent: 'Some work without a linked task',
        // intentionally no taskId
      },
    });

    // Verify agent received the job
    const jobMsg = ws.getSentMessages().find((m) => m.type === 'job');
    expect(jobMsg).toBeDefined();
    expect(jobMsg.jobId).toBe(jobId);

    // Bridge lookup returns a job with no taskId in payload
    mockPrisma.agentJob.findUnique.mockResolvedValue({
      id: jobId,
      tenantId: 'tenant-1',
      targetRepo: 'acme/backend',
      payload: {
        branch: 'feat/no-task',
        prdContent: 'Some work without a linked task',
      },
      result: null,
    });

    // 3. Agent completes the job
    ws.simulateMessage({
      type: 'job_result',
      jobId,
      status: 'done',
      data: { prUrl: 'https://github.com/acme/backend/pull/99' },
    });
    await flush();

    // 4. AgentJob marked complete via jobQueue (prisma.agentJob.update with status 'done')
    expect(mockPrisma.agentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: jobId },
        data: expect.objectContaining({ status: 'done' }),
      }),
    );

    // 4. No AgentTask update (no taskId was present)
    expect(mockPrisma.agentTask.update).not.toHaveBeenCalled();

    // 4. No crash — we reached here successfully
    // Agent also received job_complete acknowledgement
    const completeMsg = ws.getSentMessages().find((m) => m.type === 'job_complete');
    expect(completeMsg).toBeDefined();
    expect(completeMsg.jobId).toBe(jobId);
  });
});
