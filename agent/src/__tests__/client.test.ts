import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// AgentConfig shape (mirrors index.ts — defined inline to avoid side-effects)
interface AgentConfig {
  token: string;
  repos: Map<string, string>;
  server: string;
  maxJobs: number;
  jobTimeoutMin: number;
  verbose: boolean;
  requireApproval: boolean;
}

// ---------------------------------------------------------------------------
// MockWebSocket — mirrors the ws EventEmitter API used by AgentClient
// ---------------------------------------------------------------------------
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = 1;
  sent: string[] = [];
  listeners = new Map<string, Function[]>();

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, _reason?: string) {
    this.readyState = 3;
  }

  on(event: string, fn: Function) {
    const arr = this.listeners.get(event) || [];
    arr.push(fn);
    this.listeners.set(event, arr);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(event) || []) fn(...args);
  }
}

// ---------------------------------------------------------------------------
// Mock index.js so its main() auto-run doesn't fire on import
// ---------------------------------------------------------------------------
vi.mock('../index.js', () => ({
  log: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Inject mock WebSocket before importing client
// ---------------------------------------------------------------------------
let mockWs: MockWebSocket;

vi.mock('ws', () => {
  // vitest 4 + stricter JS: arrow fns can't be called with `new`. Use a class.
  class WsCtor extends MockWebSocket {
    constructor(_url: string) { super(); mockWs = this; }
  }
  return { default: WsCtor, WebSocket: WsCtor };
});

// Stub executor so dynamic import in executeJob doesn't fail
vi.mock('../executor.js', () => ({
  executeJob: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    token: 'test-token-abc',
    repos: new Map([['my-repo', '/tmp/my-repo']]),
    server: 'ws://localhost:9999',
    maxJobs: 3,
    jobTimeoutMin: 45,
    verbose: false,
    requireApproval: false,
    ...overrides,
  };
}

function sendServerMsg(ws: MockWebSocket, msg: object) {
  ws.emit('message', JSON.stringify(msg));
}

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------
const { AgentClient } = await import('../client.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AgentClient', () => {
  let client: InstanceType<typeof AgentClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new AgentClient(makeConfig());
  });

  afterEach(async () => {
    // Mark draining so shutdown() skips the drain wait loop,
    // then close immediately.
    (client as unknown as Record<string, unknown>).draining = true;
    // Clear activeJobs so the drain loop exits immediately
    const activeJobs = (client as unknown as Record<string, unknown>)
      .activeJobs as Map<string, unknown>;
    activeJobs.clear();
    try {
      await client.shutdown();
    } catch {}
    vi.useRealTimers();
    vi.clearAllMocks();
  }, 5000);

  // -------------------------------------------------------------------------
  it('sends auth message with token on WebSocket open', async () => {
    // Start connection but do NOT await (it keeps the process alive)
    client.start();

    // Allow the WS constructor to run
    await Promise.resolve();

    // Simulate the 'open' event
    mockWs.emit('open');

    expect(mockWs.sent).toHaveLength(1);
    const msg = JSON.parse(mockWs.sent[0]);
    expect(msg).toMatchObject({ type: 'auth', token: 'test-token-abc' });
  });

  // -------------------------------------------------------------------------
  it('sends register with repo slugs after auth_ok', async () => {
    client.start();
    await Promise.resolve();

    mockWs.emit('open');
    // Clear the auth message
    mockWs.sent.length = 0;

    sendServerMsg(mockWs, {
      type: 'auth_ok',
      agentId: 'agent-1',
      tenantId: 'tenant-1',
    });

    expect(mockWs.sent.length).toBeGreaterThanOrEqual(1);
    const registerMsg = mockWs.sent.find((s) => {
      try {
        return JSON.parse(s).type === 'register';
      } catch {
        return false;
      }
    });
    expect(registerMsg).toBeDefined();
    const parsed = JSON.parse(registerMsg!);
    expect(parsed.repos).toContain('my-repo');
  });

  // -------------------------------------------------------------------------
  it('stops reconnecting when auth_error is received (draining = true)', async () => {
    client.start();
    await Promise.resolve();

    mockWs.emit('open');

    sendServerMsg(mockWs, { type: 'auth_error', message: 'bad token' });

    // After auth_error the client must not schedule a reconnect.
    // We access the internal draining flag via a cast to any.
    expect((client as unknown as Record<string, unknown>).draining).toBe(true);
  });

  // -------------------------------------------------------------------------
  it('sends job_ack immediately and adds job to activeJobs on receiving job', async () => {
    client.start();
    await Promise.resolve();

    mockWs.emit('open');
    sendServerMsg(mockWs, { type: 'auth_ok', agentId: 'a1', tenantId: 't1' });
    mockWs.sent.length = 0;

    sendServerMsg(mockWs, {
      type: 'job',
      jobId: 'job-42',
      repoSlug: 'my-repo',
      prompt: 'Fix bug #1',
    });

    // job_ack must have been sent synchronously / immediately
    const ackMsg = mockWs.sent.find((s) => {
      try {
        return JSON.parse(s).type === 'job_ack';
      } catch {
        return false;
      }
    });
    expect(ackMsg).toBeDefined();
    const parsed = JSON.parse(ackMsg!);
    expect(parsed.jobId).toBe('job-42');

    // activeJobs should contain the job
    const activeJobs = (client as unknown as Record<string, unknown>)
      .activeJobs as Map<string, unknown>;
    expect(activeJobs.has('job-42')).toBe(true);
  });

  // -------------------------------------------------------------------------
  it('removes job from activeJobs on job_complete', async () => {
    client.start();
    await Promise.resolve();

    mockWs.emit('open');
    sendServerMsg(mockWs, { type: 'auth_ok', agentId: 'a1', tenantId: 't1' });

    // Inject a job
    sendServerMsg(mockWs, {
      type: 'job',
      jobId: 'job-99',
      repoSlug: 'my-repo',
      prompt: 'Refactor module',
    });

    // Confirm it's there
    const activeJobs = (client as unknown as Record<string, unknown>)
      .activeJobs as Map<string, unknown>;
    expect(activeJobs.has('job-99')).toBe(true);

    // Server signals completion
    sendServerMsg(mockWs, { type: 'job_complete', jobId: 'job-99' });

    expect(activeJobs.has('job-99')).toBe(false);
  });

  // -------------------------------------------------------------------------
  it('enters drain mode on server_shutdown', async () => {
    client.start();
    await Promise.resolve();

    mockWs.emit('open');
    sendServerMsg(mockWs, { type: 'auth_ok', agentId: 'a1', tenantId: 't1' });

    sendServerMsg(mockWs, {
      type: 'server_shutdown',
      reconnectAfter: 5,
    });

    expect((client as unknown as Record<string, unknown>).draining).toBe(true);
  });

  // -------------------------------------------------------------------------
  it('does not throw when send() fails (closed socket)', async () => {
    client.start();
    await Promise.resolve();

    mockWs.emit('open');

    // Force socket into a non-open state
    mockWs.readyState = 3; // CLOSED

    // This should NOT throw
    expect(() => {
      sendServerMsg(mockWs, {
        type: 'job',
        jobId: 'job-err',
        repoSlug: 'my-repo',
        prompt: 'test',
      });
    }).not.toThrow();
  });
});
