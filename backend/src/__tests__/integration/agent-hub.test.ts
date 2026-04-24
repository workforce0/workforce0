/**
 * Integration tests for the AgentHub WebSocket lifecycle.
 *
 * Tests the full connection -> auth -> register -> job dispatch -> result
 * cycle using mock WebSockets and mock Prisma at the service level.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { AgentHub } from '../../services/agent-hub/agent-hub.service.js';
import { AgentJobQueue } from '../../services/agent-hub/job-queue.js';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  closedWith?: { code: number; reason: string };
  private listeners = new Map<string, Function[]>();

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closedWith = { code: code || 1000, reason: reason || '' };
    this.readyState = 3;
  }

  on(event: string, fn: Function) {
    const fns = this.listeners.get(event) || [];
    fns.push(fn);
    this.listeners.set(event, fns);
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  /** Simulate receiving a message from the agent side. */
  simulateMessage(data: string) {
    const fns = this.listeners.get('message') || [];
    for (const fn of fns) fn(data);
  }

  /** Simulate the WebSocket closing. */
  simulateClose() {
    const fns = this.listeners.get('close') || [];
    for (const fn of fns) fn();
  }

  getLastSent(): any {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }

  getAllSent(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'wf0_testtoken123';
const TOKEN_HASH = crypto.createHash('sha256').update(TEST_TOKEN).digest('hex');

function createMockPrisma(overrides: Record<string, any> = {}) {
  return {
    agentToken: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'tok-1',
        tenantId: 'tenant-1',
        tokenHash: TOKEN_HASH,
        revokedAt: null,
      }),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.agentToken,
    },
    agentJob: {
      create: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ id: `job-${crypto.randomUUID().slice(0, 8)}`, status: 'pending' }),
        ),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides.agentJob,
    },
  };
}

function createMockSSE() {
  return { publish: vi.fn() };
}

/** Connect, authenticate and register a mock agent. Returns the ws and agentId. */
async function connectAndRegister(
  hub: AgentHub,
  repos: string[] = ['acme/backend'],
  capabilities: string[] = ['claude'],
) {
  const ws = new MockWebSocket();
  hub.handleConnection(ws as any);

  ws.simulateMessage(JSON.stringify({ type: 'auth', token: TEST_TOKEN }));
  await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
  const authOk = ws.getLastSent();
  expect(authOk.type).toBe('auth_ok');

  ws.simulateMessage(
    JSON.stringify({ type: 'register', repos, capabilities }),
  );
  await vi.waitFor(() => { expect(ws.getAllSent().some((m) => m.type === 'registered')).toBe(true); });

  return { ws, agentId: authOk.agentId as string };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentHub – Integration', () => {
  let hub: AgentHub;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockSSE: ReturnType<typeof createMockSSE>;
  let jobQueue: AgentJobQueue;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockPrisma = createMockPrisma();
    mockSSE = createMockSSE();
    jobQueue = new AgentJobQueue(mockPrisma);
    hub = new AgentHub(mockPrisma, mockSSE, jobQueue);
  });

  afterEach(async () => {
    // shutdown() has a 2-second internal delay; advance timers so it resolves
    const shutdownPromise = hub.shutdown();
    vi.advanceTimersByTime(3000);
    await shutdownPromise;
    vi.useRealTimers();
  });

  // ── Test 1: Full lifecycle ──────────────────────────────────────────

  it('full agent lifecycle: auth -> register -> job dispatch -> result', async () => {
    const { ws } = await connectAndRegister(hub);

    // Dispatch a job — agent is connected, so it should be sent immediately
    const jobId = await hub.dispatchJob('tenant-1', 'acme/backend', {
      tenantId: 'tenant-1',
      action: 'implement_prd',
      targetRepo: 'acme/backend',
      payload: { title: 'Build feature' },
    });
    expect(typeof jobId).toBe('string');

    // Agent should receive the job message
    await vi.waitFor(() => { expect(ws.getAllSent().some((m) => m.type === 'job')).toBe(true); });
    const jobMsg = ws.getAllSent().find((m) => m.type === 'job');
    expect(jobMsg).toBeDefined();
    expect(jobMsg!.action).toBe('implement_prd');
    expect(jobMsg!.jobId).toBe(jobId);

    // Agent acknowledges
    ws.simulateMessage(JSON.stringify({ type: 'job_ack', jobId }));
    expect(mockPrisma.agentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: jobId },
        data: expect.objectContaining({ status: 'in_progress' }),
      }),
    );

    // Agent sends progress
    ws.simulateMessage(
      JSON.stringify({
        type: 'job_progress',
        jobId,
        message: 'Writing code...',
        percent: 50,
      }),
    );
    expect(mockSSE.publish).toHaveBeenCalledWith(
      'tenant-1',
      'agent_job.status_changed',
      expect.objectContaining({ jobId, percent: 50, status: 'in_progress' }),
    );

    // Agent sends result
    ws.simulateMessage(
      JSON.stringify({
        type: 'job_result',
        jobId,
        status: 'done',
        data: { prUrl: 'https://github.com/pr/1' },
      }),
    );

    // Verify SSE published completion
    expect(mockSSE.publish).toHaveBeenCalledWith(
      'tenant-1',
      'agent_job.status_changed',
      expect.objectContaining({ jobId, status: 'done' }),
    );

    // Verify agent received job_complete acknowledgement
    const completeMsg = ws.getAllSent().find((m) => m.type === 'job_complete');
    expect(completeMsg).toBeDefined();
    expect(completeMsg!.jobId).toBe(jobId);
  });

  // ── Test 2: Offline queuing ─────────────────────────────────────────

  it('delivers queued jobs when agent connects after dispatch', async () => {
    const queuedJobId = 'queued-job-1';

    // Override create to return a predictable id
    mockPrisma.agentJob.create.mockResolvedValue({
      id: queuedJobId,
      status: 'pending',
    });

    // Dispatch job with no agent connected — it goes to the queue
    const jobId = await hub.dispatchJob('tenant-1', 'acme/backend', {
      tenantId: 'tenant-1',
      action: 'implement_prd',
      targetRepo: 'acme/backend',
      payload: { title: 'Queued feature' },
    });
    expect(jobId).toBe(queuedJobId);

    // No agent was connected, so markDispatched should NOT have been called
    expect(mockPrisma.agentJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'dispatched' }),
      }),
    );

    // Configure findMany to return the queued job when dequeue is called.
    // This must be set BEFORE register triggers deliverQueuedJobs.
    mockPrisma.agentJob.findMany.mockResolvedValue([
      {
        id: queuedJobId,
        action: 'implement_prd',
        targetRepo: 'acme/backend',
        payload: { title: 'Queued feature' },
      },
    ]);

    // Agent connects and authenticates
    const ws = new MockWebSocket();
    hub.handleConnection(ws as any);
    ws.simulateMessage(JSON.stringify({ type: 'auth', token: TEST_TOKEN }));
    await vi.waitFor(() => { expect(ws.sent.length).toBeGreaterThan(0); });
    expect(ws.getLastSent().type).toBe('auth_ok');

    // Register — this triggers deliverQueuedJobs internally
    ws.simulateMessage(
      JSON.stringify({ type: 'register', repos: ['acme/backend'], capabilities: ['claude'] }),
    );

    // Wait for both 'registered' and 'job' messages
    await vi.waitFor(() => { expect(ws.getAllSent().some((m) => m.type === 'job')).toBe(true); }, { timeout: 5000 });
    const jobMsg = ws.getAllSent().find((m) => m.type === 'job');
    expect(jobMsg).toBeDefined();
    expect(jobMsg!.action).toBe('implement_prd');
    expect(jobMsg!.jobId).toBe(queuedJobId);
  });

  // ── Test 3: Agent status ────────────────────────────────────────────

  it('getAgentStatus returns connected agent info', async () => {
    // No agents yet
    expect(hub.getAgentStatus('tenant-1')).toEqual([]);

    const { agentId } = await connectAndRegister(hub, ['acme/backend', 'acme/frontend'], ['claude', 'codex']);

    const status = hub.getAgentStatus('tenant-1');
    expect(status).toHaveLength(1);
    expect(status[0].agentId).toBe(agentId);
    expect(status[0].repos).toEqual(['acme/backend', 'acme/frontend']);
    expect(status[0].capabilities).toEqual(['claude', 'codex']);
    expect(status[0].activeJobs).toBe(0);
    expect(status[0].connectedAt).toBeInstanceOf(Date);
  });

  // ── Test 4: Auth failure ────────────────────────────────────────────

  it('rejects connection with invalid token', async () => {
    mockPrisma.agentToken.findUnique.mockResolvedValue(null);

    const ws = new MockWebSocket();
    hub.handleConnection(ws as any);
    ws.simulateMessage(JSON.stringify({ type: 'auth', token: 'bad_token' }));

    await vi.waitFor(() => { expect(ws.sent.length).toBeGreaterThan(0); }, { timeout: 5000 });
    const msg = ws.getLastSent();
    expect(msg.type).toBe('auth_error');
    expect(ws.closedWith).toBeDefined();
  });

  // ── Test 5: Disconnect cleans up ───────────────────────────────────

  it('removes agent from status on disconnect', async () => {
    const { ws } = await connectAndRegister(hub);
    expect(hub.getAgentStatus('tenant-1')).toHaveLength(1);
    expect(hub.getConnectionCount()).toBe(1);

    ws.simulateClose();
    expect(hub.getConnectionCount()).toBe(0);
    expect(hub.getAgentStatus('tenant-1')).toHaveLength(0);
  });

  // ── Test 6: Ping/pong ──────────────────────────────────────────────

  it('responds to ping with pong', async () => {
    const { ws } = await connectAndRegister(hub);

    ws.simulateMessage(JSON.stringify({ type: 'ping' }));

    await vi.waitFor(() => { expect(ws.getAllSent().some((m) => m.type === 'pong')).toBe(true); });
    const pong = ws.getAllSent().find((m) => m.type === 'pong');
    expect(pong).toBeDefined();
  });

  // ── Test 7: Job routing by repo ────────────────────────────────────

  it('routes jobs only to agents registered for the target repo', async () => {
    // Agent 1 handles acme/backend
    const { ws: ws1 } = await connectAndRegister(hub, ['acme/backend']);
    // Agent 2 handles acme/frontend
    const { ws: ws2 } = await connectAndRegister(hub, ['acme/frontend']);

    await hub.dispatchJob('tenant-1', 'acme/frontend', {
      tenantId: 'tenant-1',
      action: 'implement_prd',
      targetRepo: 'acme/frontend',
      payload: { title: 'Frontend work' },
    });

    // ws2 (frontend agent) should get the job, ws1 should not
    await vi.waitFor(() => { expect(ws2.getAllSent().some((m) => m.type === 'job')).toBe(true); });
    expect(ws1.getAllSent().filter((m) => m.type === 'job')).toHaveLength(0);
    expect(ws2.getAllSent().find((m) => m.type === 'job')!.action).toBe('implement_prd');
  });

  // ── Test 8: Failed job result ──────────────────────────────────────

  it('handles failed job results and publishes via SSE', async () => {
    const { ws } = await connectAndRegister(hub);

    const jobId = await hub.dispatchJob('tenant-1', 'acme/backend', {
      tenantId: 'tenant-1',
      action: 'implement_prd',
      targetRepo: 'acme/backend',
      payload: { title: 'Will fail' },
    });

    await vi.waitFor(() => { expect(ws.getAllSent().some((m) => m.type === 'job')).toBe(true); });

    ws.simulateMessage(
      JSON.stringify({
        type: 'job_result',
        jobId,
        status: 'failed',
        data: { error: 'Build failed' },
      }),
    );

    expect(mockSSE.publish).toHaveBeenCalledWith(
      'tenant-1',
      'agent_job.status_changed',
      expect.objectContaining({ jobId, status: 'failed' }),
    );
  });
});
