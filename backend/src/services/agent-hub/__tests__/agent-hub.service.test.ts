/**
 * =============================================================================
 * AgentHub Service — Tests
 * =============================================================================
 *
 * Tests:
 *   - Auth flow (valid, invalid, revoked, timeout)
 *   - Registration and queued job delivery
 *   - Heartbeat (ping/pong, timeout disconnect)
 *   - Job dispatch (routing, load balancing, capacity, no-agent fallback)
 *   - Job lifecycle (ack, progress, result done/failed)
 *   - Disconnect cleanup
 *   - Status queries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentHub } from '../agent-hub.service.js';
import type { AgentJobQueue } from '../job-queue.js';
import { HEARTBEAT_TIMEOUT_MS, AUTH_DEADLINE_MS, CLEANUP_INTERVAL_MS } from '../types.js';

/**
 * Flush microtask queue so that resolved promises settle.
 * Uses process.nextTick which is never faked by vi.useFakeTimers().
 */
function flush(): Promise<void> {
  return new Promise(resolve => process.nextTick(resolve));
}

// ── Mock WebSocket ───────────────────────────────────────────────

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  closedWith?: { code: number; reason: string };
  private listeners = new Map<string, Function[]>();

  send(data: string) { this.sent.push(data); }
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
    return this.sent.map(s => JSON.parse(s));
  }

  getLastSentMessage(): any {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

// ── Mock Factories ───────────────────────────────────────────────

function createMockPrisma() {
  return {
    agentToken: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    agentJob: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    agentTask: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

function createMockOutcomeObserver() {
  return {
    recordFromTask: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockEngagementService() {
  return {
    advancePhase: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockCommsRouter() {
  return {
    notify: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSSE() {
  return {
    publish: vi.fn(),
  };
}

function createMockJobQueue(): AgentJobQueue {
  return {
    enqueue: vi.fn().mockResolvedValue('job-1'),
    dequeue: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue(null),
    markDispatched: vi.fn().mockResolvedValue(undefined),
    markInProgress: vi.fn().mockResolvedValue(undefined),
    markComplete: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    expireStale: vi.fn().mockResolvedValue(0),
  } as any;
}

// ── Helper: create and authenticate an agent ─────────────────────

async function connectAndAuth(
  hub: AgentHub,
  ws: MockWebSocket,
  prisma: ReturnType<typeof createMockPrisma>,
  options: { tenantId?: string; token?: string; tokenId?: string } = {},
) {
  const tenantId = options.tenantId || 'tenant-1';
  const token = options.token || 'valid-token';
  const tokenId = options.tokenId || 'tok-1';

  prisma.agentToken.findUnique.mockResolvedValue({
    id: tokenId,
    tenantId,
    tokenHash: 'any',
    revokedAt: null,
  });

  hub.handleConnection(ws as any);
  ws.simulateMessage({ type: 'auth', token });

  // Allow async authenticate to resolve
  await flush();

  const authOk = ws.getSentMessages().find((m: any) => m.type === 'auth_ok');
  expect(authOk).toBeDefined();
  return authOk;
}

// ── Tests ────────────────────────────────────────────────────────

describe('AgentHub', () => {
  let hub: AgentHub;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockSSE: ReturnType<typeof createMockSSE>;
  let mockJobQueue: ReturnType<typeof createMockJobQueue>;
  let mockOutcomeObserver: ReturnType<typeof createMockOutcomeObserver>;
  let mockEngagementService: ReturnType<typeof createMockEngagementService>;
  let mockCommsRouter: ReturnType<typeof createMockCommsRouter>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPrisma = createMockPrisma();
    mockSSE = createMockSSE();
    mockJobQueue = createMockJobQueue();
    mockOutcomeObserver = createMockOutcomeObserver();
    mockEngagementService = createMockEngagementService();
    mockCommsRouter = createMockCommsRouter();
    hub = new AgentHub(mockPrisma, mockSSE, mockJobQueue, mockOutcomeObserver, mockEngagementService, mockCommsRouter);
  });

  afterEach(async () => {
    const shutdownPromise = hub.shutdown();
    vi.advanceTimersByTime(3000);
    await shutdownPromise;
    vi.useRealTimers();
  });

  // ── Auth Flow ──────────────────────────────────────────────────

  describe('Auth flow', () => {
    it('sends auth_ok on valid token', async () => {
      const ws = new MockWebSocket();
      const authOk = await connectAndAuth(hub, ws, mockPrisma);

      expect(authOk.type).toBe('auth_ok');
      expect(authOk.tenantId).toBe('tenant-1');
      expect(authOk.agentId).toBeDefined();
    });

    it('updates lastUsedAt on successful auth', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);

      expect(mockPrisma.agentToken.update).toHaveBeenCalledWith({
        where: { id: 'tok-1' },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it('sends auth_error and closes on invalid token', async () => {
      const ws = new MockWebSocket();
      mockPrisma.agentToken.findUnique.mockResolvedValue(null);

      hub.handleConnection(ws as any);
      ws.simulateMessage({ type: 'auth', token: 'bad-token' });
      await flush();

      const msgs = ws.getSentMessages();
      expect(msgs.some((m: any) => m.type === 'auth_error')).toBe(true);
      expect(ws.closedWith).toBeDefined();
    });

    it('sends auth_error on revoked token', async () => {
      const ws = new MockWebSocket();
      mockPrisma.agentToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        tenantId: 'tenant-1',
        tokenHash: 'hash',
        revokedAt: new Date(),
      });

      hub.handleConnection(ws as any);
      ws.simulateMessage({ type: 'auth', token: 'revoked-token' });
      await flush();

      const msgs = ws.getSentMessages();
      expect(msgs.some((m: any) => m.type === 'auth_error')).toBe(true);
      expect(ws.closedWith).toBeDefined();
    });

    it('closes connection if auth not received within deadline', () => {
      const ws = new MockWebSocket();
      hub.handleConnection(ws as any);

      vi.advanceTimersByTime(AUTH_DEADLINE_MS + 100);

      expect(ws.closedWith).toBeDefined();
      expect(ws.closedWith!.reason).toContain('auth_timeout');
    });

    it('rejects non-auth message as first message', async () => {
      const ws = new MockWebSocket();
      hub.handleConnection(ws as any);
      ws.simulateMessage({ type: 'ping' });

      // This branch is synchronous (no await in the non-auth path)
      const msgs = ws.getSentMessages();
      expect(msgs.some((m: any) => m.type === 'auth_error')).toBe(true);
      expect(ws.closedWith).toBeDefined();
    });
  });

  // ── Registration ───────────────────────────────────────────────

  describe('Registration', () => {
    it('register message updates repos and sends registered', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);

      ws.simulateMessage({
        type: 'register',
        repos: ['acme/backend', 'acme/frontend'],
        capabilities: ['implement_prd'],
      });

      const registered = ws.getSentMessages().find((m: any) => m.type === 'registered');
      expect(registered).toBeDefined();
      expect(registered.repos).toBe(2);
    });

    it('register delivers queued jobs for matching repos', async () => {
      const ws = new MockWebSocket();
      (mockJobQueue.dequeue as any).mockResolvedValue([
        { id: 'queued-job-1', action: 'implement_prd', payload: { content: 'Build X' } },
      ]);

      await connectAndAuth(hub, ws, mockPrisma);

      ws.simulateMessage({
        type: 'register',
        repos: ['acme/backend'],
        capabilities: ['implement_prd'],
      });

      // deliverQueuedJobs is async, flush microtasks
      await flush();

      const msgs = ws.getSentMessages();
      expect(msgs.some((m: any) => m.type === 'job' && m.jobId === 'queued-job-1')).toBe(true);
      expect(mockJobQueue.markDispatched).toHaveBeenCalledWith('queued-job-1', expect.any(String));
    });
  });

  // ── Heartbeat ──────────────────────────────────────────────────

  describe('Heartbeat', () => {
    it('responds to ping with pong', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);

      ws.simulateMessage({ type: 'ping' });

      const msgs = ws.getSentMessages();
      expect(msgs.some((m: any) => m.type === 'pong')).toBe(true);
    });

    it('disconnects agent after heartbeat timeout', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);

      // Cleanup runs on CLEANUP_INTERVAL_MS; must advance past it
      // so that the cleanup loop fires and detects stale heartbeat
      vi.advanceTimersByTime(CLEANUP_INTERVAL_MS + 1000);

      expect(ws.closedWith).toBeDefined();
      expect(hub.getConnectionCount()).toBe(0);
    });
  });

  // ── Job Dispatch ───────────────────────────────────────────────

  describe('Job dispatch', () => {
    it('dispatches job to agent with matching repo', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);
      ws.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: [] });

      const jobId = await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1',
        action: 'implement_prd',
        targetRepo: 'acme/backend',
        payload: { content: 'Build X' },
      });

      expect(jobId).toBe('job-1');
      const jobMsg = ws.getSentMessages().find((m: any) => m.type === 'job');
      expect(jobMsg).toBeDefined();
      expect(jobMsg.action).toBe('implement_prd');
    });

    it('picks least-busy agent for load balancing', async () => {
      // Agent 1
      const ws1 = new MockWebSocket();
      await connectAndAuth(hub, ws1, mockPrisma, { token: 'token-1', tokenId: 'tok-1' });
      ws1.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: [] });

      // Dispatch 2 jobs to agent 1
      (mockJobQueue.enqueue as any).mockResolvedValueOnce('busy-job-1').mockResolvedValueOnce('busy-job-2');
      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'task1', targetRepo: 'acme/backend', payload: {},
      });
      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'task2', targetRepo: 'acme/backend', payload: {},
      });

      // Agent 2 (0 active jobs)
      const ws2 = new MockWebSocket();
      await connectAndAuth(hub, ws2, mockPrisma, { token: 'token-2', tokenId: 'tok-2' });
      ws2.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: [] });

      // Next job should go to agent 2 (least busy)
      (mockJobQueue.enqueue as any).mockResolvedValueOnce('new-job');
      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'task3', targetRepo: 'acme/backend', payload: {},
      });

      const ws2Jobs = ws2.getSentMessages().filter((m: any) => m.type === 'job');
      expect(ws2Jobs.some((m: any) => m.jobId === 'new-job')).toBe(true);
    });

    it('respects maxActiveJobs cap', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);
      ws.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: [] });

      // Fill capacity (DEFAULT_MAX_ACTIVE_JOBS = 3)
      (mockJobQueue.enqueue as any)
        .mockResolvedValueOnce('j1')
        .mockResolvedValueOnce('j2')
        .mockResolvedValueOnce('j3')
        .mockResolvedValueOnce('j4');

      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'a', targetRepo: 'acme/backend', payload: {},
      });
      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'b', targetRepo: 'acme/backend', payload: {},
      });
      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'c', targetRepo: 'acme/backend', payload: {},
      });

      // 4th job — agent at capacity
      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'd', targetRepo: 'acme/backend', payload: {},
      });

      const jobMsgs = ws.getSentMessages().filter((m: any) => m.type === 'job');
      expect(jobMsgs).toHaveLength(3);
      expect(mockJobQueue.markDispatched).toHaveBeenCalledTimes(3);
    });

    it('keeps job pending when no agent available', async () => {
      (mockJobQueue.enqueue as any).mockResolvedValue('orphan-job');

      const jobId = await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'implement_prd', targetRepo: 'acme/backend', payload: {},
      });

      expect(jobId).toBe('orphan-job');
      expect(mockJobQueue.markDispatched).not.toHaveBeenCalled();
    });

    it('does not dispatch to agent with wrong repo', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);
      ws.simulateMessage({ type: 'register', repos: ['acme/frontend'], capabilities: [] });

      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'implement_prd', targetRepo: 'acme/backend', payload: {},
      });

      const jobMsgs = ws.getSentMessages().filter((m: any) => m.type === 'job');
      expect(jobMsgs).toHaveLength(0);
    });
  });

  // ── Job Lifecycle ──────────────────────────────────────────────

  describe('Job lifecycle', () => {
    it('job_ack marks job as in_progress', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);
      ws.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: [] });

      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'implement_prd', targetRepo: 'acme/backend', payload: {},
      });

      ws.simulateMessage({ type: 'job_ack', jobId: 'job-1' });

      expect(mockJobQueue.markInProgress).toHaveBeenCalledWith('job-1');
    });

    it('job_progress publishes SSE event', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);
      ws.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: [] });

      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'implement_prd', targetRepo: 'acme/backend', payload: {},
      });

      ws.simulateMessage({ type: 'job_progress', jobId: 'job-1', message: 'Running tests', percent: 50 });

      expect(mockSSE.publish).toHaveBeenCalledWith(
        'tenant-1',
        'agent_job.status_changed',
        expect.objectContaining({
          jobId: 'job-1',
          status: 'in_progress',
          message: 'Running tests',
          percent: 50,
        }),
      );
    });

    it('job_result done marks complete and publishes SSE', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);
      ws.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: [] });

      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'implement_prd', targetRepo: 'acme/backend', payload: {},
      });

      ws.simulateMessage({
        type: 'job_result', jobId: 'job-1', status: 'done',
        data: { prUrl: 'https://github.com/pr/1' },
      });

      expect(mockJobQueue.markComplete).toHaveBeenCalledWith('job-1', { prUrl: 'https://github.com/pr/1' });

      const completeMsgs = ws.getSentMessages().filter((m: any) => m.type === 'job_complete');
      expect(completeMsgs.some((m: any) => m.jobId === 'job-1')).toBe(true);

      expect(mockSSE.publish).toHaveBeenCalledWith(
        'tenant-1',
        'agent_job.status_changed',
        expect.objectContaining({ jobId: 'job-1', status: 'done' }),
      );
    });

    it('job_result failed marks failed and publishes SSE', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);
      ws.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: [] });

      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'implement_prd', targetRepo: 'acme/backend', payload: {},
      });

      ws.simulateMessage({
        type: 'job_result', jobId: 'job-1', status: 'failed',
        data: { error: 'Tests failed' },
      });

      expect(mockJobQueue.markFailed).toHaveBeenCalledWith('job-1', 'Tests failed');

      expect(mockSSE.publish).toHaveBeenCalledWith(
        'tenant-1',
        'agent_job.status_changed',
        expect.objectContaining({ jobId: 'job-1', status: 'failed' }),
      );
    });

    it('job_result decrements activeJobs count', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);
      ws.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: [] });

      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1', action: 'implement_prd', targetRepo: 'acme/backend', payload: {},
      });

      const statusBefore = hub.getAgentStatus('tenant-1');
      expect(statusBefore[0].activeJobs).toBe(1);

      ws.simulateMessage({ type: 'job_result', jobId: 'job-1', status: 'done', data: {} });

      const statusAfter = hub.getAgentStatus('tenant-1');
      expect(statusAfter[0].activeJobs).toBe(0);
    });
  });

  // ── Disconnect ─────────────────────────────────────────────────

  describe('Disconnect', () => {
    it('removes agent from connections and tenantIndex on WS close', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);

      expect(hub.getConnectionCount()).toBe(1);
      expect(hub.getAgentStatus('tenant-1')).toHaveLength(1);

      ws.simulateClose();

      expect(hub.getConnectionCount()).toBe(0);
      expect(hub.getAgentStatus('tenant-1')).toHaveLength(0);
    });

    it('cleans up tenant index when last agent disconnects', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);

      ws.simulateClose();

      expect(hub.getAgentStatus('tenant-1')).toHaveLength(0);
    });
  });

  // ── Status Queries ─────────────────────────────────────────────

  describe('Status queries', () => {
    it('getAgentStatus returns connected agents for tenant', async () => {
      const ws = new MockWebSocket();
      await connectAndAuth(hub, ws, mockPrisma);
      ws.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: ['impl'] });

      const status = hub.getAgentStatus('tenant-1');
      expect(status).toHaveLength(1);
      expect(status[0].repos).toEqual(['acme/backend']);
      expect(status[0].capabilities).toEqual(['impl']);
      expect(status[0].activeJobs).toBe(0);
      expect(status[0].connectedAt).toBeInstanceOf(Date);
      expect(status[0].lastPingAt).toBeInstanceOf(Date);
    });

    it('getAgentStatus returns empty for unknown tenant', () => {
      expect(hub.getAgentStatus('no-such-tenant')).toEqual([]);
    });

    it('getConnectionCount returns total connections', async () => {
      expect(hub.getConnectionCount()).toBe(0);

      const ws1 = new MockWebSocket();
      await connectAndAuth(hub, ws1, mockPrisma, { token: 'a', tokenId: 'tok-a' });

      const ws2 = new MockWebSocket();
      await connectAndAuth(hub, ws2, mockPrisma, { token: 'b', tokenId: 'tok-b' });

      expect(hub.getConnectionCount()).toBe(2);
    });

    it('getPendingJobCount queries database', async () => {
      mockPrisma.agentJob.count.mockResolvedValue(5);
      const count = await hub.getPendingJobCount();
      expect(count).toBe(5);
    });
  });

  // ── Shutdown ───────────────────────────────────────────────────

  describe('Shutdown', () => {
    it('sends server_shutdown to all connected agents', async () => {
      const ws1 = new MockWebSocket();
      await connectAndAuth(hub, ws1, mockPrisma, { token: 'a', tokenId: 'tok-a' });

      const ws2 = new MockWebSocket();
      await connectAndAuth(hub, ws2, mockPrisma, { token: 'b', tokenId: 'tok-b' });

      const shutdownPromise = hub.shutdown();
      vi.advanceTimersByTime(3000);
      await shutdownPromise;

      for (const ws of [ws1, ws2]) {
        const msgs = ws.getSentMessages();
        expect(msgs.some((m: any) => m.type === 'server_shutdown')).toBe(true);
      }
    });
  });

  // ── AgentTask Bridge ──────────────────────────────────────────

  describe('AgentTask Bridge', () => {
    async function setupAgentWithJob(ws: MockWebSocket) {
      await connectAndAuth(hub, ws, mockPrisma);
      ws.simulateMessage({ type: 'register', repos: ['acme/backend'], capabilities: [] });

      await hub.dispatchJob('tenant-1', 'acme/backend', {
        tenantId: 'tenant-1',
        action: 'implement_prd',
        targetRepo: 'acme/backend',
        payload: { content: 'Build X' },
      });
    }

    it('job_result with taskId in payload updates AgentTask to completed', async () => {
      const ws = new MockWebSocket();
      await setupAgentWithJob(ws);

      mockPrisma.agentJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 'tenant-1',
        targetRepo: 'acme/backend',
        payload: { taskId: 'task-1' },
        result: null,
      });
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-1',
        agentType: 'dev_agent',
        meetingId: 'meeting-1',
      });

      ws.simulateMessage({
        type: 'job_result', jobId: 'job-1', status: 'done',
        data: { prUrl: 'https://github.com/pr/1' },
      });
      await flush();

      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'completed',
          output: { prUrl: 'https://github.com/pr/1' },
          completedAt: expect.any(Date),
          error: null,
        }),
      });
    });

    it('job_result failed with taskId updates AgentTask to failed', async () => {
      const ws = new MockWebSocket();
      await setupAgentWithJob(ws);

      mockPrisma.agentJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 'tenant-1',
        targetRepo: 'acme/backend',
        payload: { taskId: 'task-1' },
        result: null,
      });
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-1',
        agentType: 'dev_agent',
        meetingId: 'meeting-1',
      });

      ws.simulateMessage({
        type: 'job_result', jobId: 'job-1', status: 'failed',
        data: { error: 'Tests failed' },
      });
      await flush();

      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'failed',
          error: 'Tests failed',
        }),
      });
    });

    it('job_result with no taskId in payload does not crash', async () => {
      const ws = new MockWebSocket();
      await setupAgentWithJob(ws);

      mockPrisma.agentJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 'tenant-1',
        targetRepo: 'acme/backend',
        payload: { content: 'no taskId here' },
        result: null,
      });

      ws.simulateMessage({
        type: 'job_result', jobId: 'job-1', status: 'done',
        data: { prUrl: 'https://github.com/pr/1' },
      });
      await flush();

      expect(mockPrisma.agentTask.update).not.toHaveBeenCalled();
    });

    it('dev agent completion triggers chainQAJob', async () => {
      const ws = new MockWebSocket();
      await setupAgentWithJob(ws);

      mockPrisma.agentJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 'tenant-1',
        targetRepo: 'acme/backend',
        payload: { taskId: 'task-1', branch: 'feat/build-x', prdContent: 'Build X' },
        result: { prUrl: 'https://github.com/pr/1' },
      });
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-1',
        agentType: 'dev_agent',
        meetingId: 'meeting-1',
      });

      // Reset enqueue mock for QA job
      (mockJobQueue.enqueue as any).mockResolvedValue('qa-job-1');

      ws.simulateMessage({
        type: 'job_result', jobId: 'job-1', status: 'done',
        data: { prUrl: 'https://github.com/pr/1' },
      });
      await flush();

      // Should have called enqueue with review_pr action
      expect(mockJobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'review_pr',
          tenantId: 'tenant-1',
          targetRepo: 'acme/backend',
        }),
      );
    });

    it('dev agent failure does NOT trigger QA', async () => {
      const ws = new MockWebSocket();
      await setupAgentWithJob(ws);

      mockPrisma.agentJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 'tenant-1',
        targetRepo: 'acme/backend',
        payload: { taskId: 'task-1', branch: 'feat/build-x' },
        result: null,
      });
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-1',
        agentType: 'dev_agent',
        meetingId: 'meeting-1',
      });

      ws.simulateMessage({
        type: 'job_result', jobId: 'job-1', status: 'failed',
        data: { error: 'Build failed' },
      });
      await flush();

      // enqueue was called once for the initial dispatchJob, but NOT for review_pr
      const enqueueCalls = (mockJobQueue.enqueue as any).mock.calls;
      const reviewPrCalls = enqueueCalls.filter((call: any[]) => call[0]?.action === 'review_pr');
      expect(reviewPrCalls).toHaveLength(0);
    });

    it('qa agent completion does not chain further', async () => {
      const ws = new MockWebSocket();
      await setupAgentWithJob(ws);

      mockPrisma.agentJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 'tenant-1',
        targetRepo: 'acme/backend',
        payload: { taskId: 'task-1', branch: 'feat/build-x' },
        result: null,
      });
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-1',
        agentType: 'qa_agent',
        meetingId: 'meeting-1',
      });

      ws.simulateMessage({
        type: 'job_result', jobId: 'job-1', status: 'done',
        data: { report: 'all passing' },
      });
      await flush();

      const enqueueCalls = (mockJobQueue.enqueue as any).mock.calls;
      const reviewPrCalls = enqueueCalls.filter((call: any[]) => call[0]?.action === 'review_pr');
      expect(reviewPrCalls).toHaveLength(0);
    });

    it('outcomeObserver.recordFromTask called when taskId present', async () => {
      const ws = new MockWebSocket();
      await setupAgentWithJob(ws);

      mockPrisma.agentJob.findUnique.mockResolvedValue({
        id: 'job-1',
        tenantId: 'tenant-1',
        targetRepo: 'acme/backend',
        payload: { taskId: 'task-1' },
        result: null,
      });
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-1',
        agentType: 'dev_agent',
        meetingId: 'meeting-1',
      });

      ws.simulateMessage({
        type: 'job_result', jobId: 'job-1', status: 'done',
        data: { prUrl: 'https://github.com/pr/1' },
      });
      await flush();

      expect(mockOutcomeObserver.recordFromTask).toHaveBeenCalledWith('task-1');
    });
  });
});
