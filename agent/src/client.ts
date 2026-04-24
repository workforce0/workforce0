import WebSocket from 'ws';
import { execFileSync } from 'child_process';
import type { AgentConfig } from './index.js';
import { log } from './index.js';
import * as ui from './ui.js';

// ---------------------------------------------------------------------------
// Types for messages exchanged over the WebSocket
// ---------------------------------------------------------------------------
interface AuthMsg { type: 'auth'; token: string }
interface AuthOkMsg { type: 'auth_ok'; agentId: string; tenantId: string }
interface AuthErrorMsg { type: 'auth_error'; message: string }
interface RegisterMsg { type: 'register'; repos: string[]; capabilities: string[] }
interface RegisteredMsg { type: 'registered' }
interface PingMsg { type: 'ping' }
interface PongMsg { type: 'pong' }
interface JobMsg {
  type: 'job';
  jobId: string;
  repoSlug: string;
  prompt: string;
  [key: string]: unknown;
}
interface JobAckMsg { type: 'job_ack'; jobId: string }
interface JobCompleteMsg { type: 'job_complete'; jobId: string }
interface ServerShutdownMsg { type: 'server_shutdown'; reconnectAfter?: number }

type ServerMessage =
  | AuthOkMsg
  | AuthErrorMsg
  | RegisteredMsg
  | PongMsg
  | JobMsg
  | JobCompleteMsg
  | ServerShutdownMsg;

// ---------------------------------------------------------------------------
// Backoff helper — exponential, capped at maxMs
// ---------------------------------------------------------------------------
function nextBackoff(current: number, maxMs = 30_000): number {
  return Math.min(current * 2, maxMs);
}

// ---------------------------------------------------------------------------
// promptApproval: show a banner and read y/N from stdin.
//
// Serialized through a shared promise chain so that concurrent jobs don't
// share a single keystroke. Each call waits for the previous banner-and-
// stdin-read sequence to finish before writing its own banner — this also
// prevents banners from interleaving on stderr and terminal state from
// being scrambled by overlapping setRawMode/resume/pause calls.
// ---------------------------------------------------------------------------
let approvalChain: Promise<unknown> = Promise.resolve();

/** Exported for tests. Resets the internal serialization chain. */
export function __resetApprovalChainForTests(): void {
  approvalChain = Promise.resolve();
}

export function promptApproval(banner: string): Promise<boolean> {
  const task = (): Promise<boolean> => {
    if (!process.stdin.isTTY) {
      return Promise.resolve(true); // Non-interactive mode, auto-approve
    }
    process.stderr.write(banner);
    return new Promise<boolean>((resolve) => {
      process.stdin.setRawMode?.(false);
      process.stdin.resume();
      process.stdin.once('data', (data) => {
        const answer = data.toString().trim().toLowerCase();
        process.stdin.pause();
        resolve(answer === 'y' || answer === 'yes');
      });
    });
  };

  const next = approvalChain.then(task, task);
  approvalChain = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// detectCapabilities: probe for tools available in PATH
// ---------------------------------------------------------------------------
export function detectCapabilities(): string[] {
  const caps: string[] = [];
  const candidates: [string, string[]] = ['claude', 'git', 'npm', 'gh'] as unknown as [string, string[]];
  for (const bin of candidates as unknown as string[]) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 3000 });
      caps.push(bin);
    } catch {
      // not available
    }
  }
  return caps;
}

// ---------------------------------------------------------------------------
// AgentClient
// ---------------------------------------------------------------------------
export class AgentClient {
  private config: AgentConfig;

  // Connection state
  private ws: WebSocket | null = null;
  private agentId: string | null = null;
  private tenantId: string | null = null;

  // Reconnect / lifecycle
  draining = false;               // exposed for tests
  private backoffMs = 1_000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  // Active jobs: jobId → job payload
  activeJobs = new Map<string, JobMsg>();  // exposed for tests

  constructor(config: AgentConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Open the WebSocket and keep the process alive. */
  start(): Promise<void> {
    this.connect();

    // Keep the process alive via a no-op interval
    this.keepAliveTimer = setInterval(() => {/* keep-alive */}, 60_000);

    // Return a promise that resolves immediately (the agent runs via event loop)
    return Promise.resolve();
  }

  /** Drain active jobs (60 s timeout) then close the socket. */
  async shutdown(): Promise<void> {
    this.draining = true;
    this.clearTimers();

    if (this.activeJobs.size > 0) {
      if (this.config.verbose) {
        log('info', 'Draining active jobs before shutdown', {
          count: this.activeJobs.size,
        });
      } else {
        ui.status(`Draining ${this.activeJobs.size} active job(s) before shutdown...`);
      }

      const deadline = Date.now() + 60_000;
      while (this.activeJobs.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }

      if (this.activeJobs.size > 0) {
        if (this.config.verbose) {
          log('warn', 'Shutdown timeout — abandoning active jobs', {
            jobs: [...this.activeJobs.keys()],
          });
        } else {
          ui.error('Shutdown timeout — abandoning active jobs');
        }
      }
    }

    if (this.ws) {
      try {
        this.ws.close(1001, 'agent shutdown');
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private — connection management
  // -------------------------------------------------------------------------

  private connect(): void {
    if (this.draining) return;

    if (this.config.verbose) {
      log('info', 'Connecting to server', { server: this.config.server });
    } else {
      ui.status(`Connecting to ${this.config.server}...`);
    }

    const ws = new WebSocket(this.config.server);
    this.ws = ws;

    ws.on('open', () => this.onOpen());
    ws.on('message', (data: Buffer | string) => this.onMessage(data));
    ws.on('close', (code: number, reason: Buffer) =>
      this.onClose(code, reason.toString())
    );
    ws.on('error', (err: Error) => this.onError(err));
  }

  private onOpen(): void {
    if (this.config.verbose) {
      log('info', 'WebSocket connected — authenticating');
    } else {
      ui.status('Authenticating...');
    }
    this.safeSend({ type: 'auth', token: this.config.token } satisfies AuthMsg);
  }

  private onMessage(data: Buffer | string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data.toString()) as ServerMessage;
    } catch {
      if (this.config.verbose) {
        log('warn', 'Received non-JSON message — ignoring');
      }
      return;
    }

    switch (msg.type) {
      case 'auth_ok':
        this.handleAuthOk(msg);
        break;
      case 'auth_error':
        this.handleAuthError(msg);
        break;
      case 'registered':
        this.handleRegistered();
        break;
      case 'pong':
        // no-op
        break;
      case 'job':
        this.handleJob(msg);
        break;
      case 'job_complete':
        this.handleJobComplete(msg);
        break;
      case 'server_shutdown':
        this.handleServerShutdown(msg);
        break;
      default:
        if (this.config.verbose) {
          log('warn', 'Unknown message type', {
            type: (msg as Record<string, unknown>).type,
          });
        }
    }
  }

  private onClose(code: number, reason: string): void {
    if (this.config.verbose) {
      log('info', 'WebSocket closed', { code, reason });
    } else {
      ui.disconnected(reason || `code ${code}`);
    }
    this.clearHeartbeat();

    if (this.draining) {
      if (this.config.verbose) {
        log('info', 'Draining — not reconnecting');
      }
      return;
    }

    if (this.config.verbose) {
      log('info', 'Scheduling reconnect', { backoffMs: this.backoffMs });
    } else {
      ui.reconnecting(this.backoffMs);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoffMs);
    this.backoffMs = nextBackoff(this.backoffMs);
  }

  private onError(err: Error): void {
    if (this.config.verbose) {
      log('error', 'WebSocket error', { error: err.message });
    } else {
      ui.error(`WebSocket error: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Private — message handlers
  // -------------------------------------------------------------------------

  private handleAuthOk(msg: AuthOkMsg): void {
    this.agentId = msg.agentId;
    this.tenantId = msg.tenantId;
    this.backoffMs = 1_000; // reset exponential backoff on successful auth

    if (this.config.verbose) {
      log('info', 'Authenticated', { agentId: this.agentId, tenantId: this.tenantId });
    } else {
      ui.connected(this.agentId, this.tenantId);
    }

    // Send register
    const registerMsg: RegisterMsg = {
      type: 'register',
      repos: [...this.config.repos.keys()],
      capabilities: detectCapabilities(),
    };
    this.safeSend(registerMsg);

    // Start heartbeat
    this.startHeartbeat();
  }

  private handleAuthError(msg: AuthErrorMsg): void {
    if (this.config.verbose) {
      log('error', 'Authentication failed — stopping reconnects', {
        message: msg.message,
      });
    } else {
      ui.error(`Authentication failed: ${msg.message}`);
    }
    this.draining = true;
  }

  private handleRegistered(): void {
    if (this.config.verbose) {
      log('info', 'Agent registered — ready for jobs');
    } else {
      const repos = [...this.config.repos.keys()];
      ui.registered(repos.length, repos);
    }
  }

  private handleJob(msg: JobMsg): void {
    const { jobId } = msg;

    // Acknowledge immediately
    this.safeSend({ type: 'job_ack', jobId } satisfies JobAckMsg);

    // Cache
    this.activeJobs.set(jobId, msg);

    if (this.config.verbose) {
      log('info', 'Job received', { jobId, repoSlug: msg.repoSlug });
    } else {
      const payload = (msg.payload ?? {}) as Record<string, unknown>;
      ui.newJob(jobId, msg.action as string, payload);
    }

    // Execute asynchronously (with optional approval gate)
    this.runJobWithApproval(msg).catch((err: unknown) => {
      if (this.config.verbose) {
        log('error', 'Job execution error', {
          jobId,
          error: (err as Error).message,
        });
      } else {
        ui.jobFailed((err as Error).message);
      }
      this.activeJobs.delete(jobId);
    });
  }

  private async runJobWithApproval(msg: JobMsg): Promise<void> {
    const { jobId } = msg;
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    const action = msg.action as string;

    if (this.config.requireApproval) {
      const summary = [
        '',
        '┌─────────────────────────────────────────────┐',
        '│  NEW JOB RECEIVED                           │',
        '├─────────────────────────────────────────────┤',
        `│  Job id:  ${jobId}`,
        `│  Action:  ${action}`,
        `│  Repo:    ${payload.targetRepo ?? 'default'}`,
        `│  Branch:  ${payload.branch ?? 'n/a'}`,
        `│  Title:   ${payload.title ?? 'n/a'}`,
        '└─────────────────────────────────────────────┘',
        '',
        'Execute this job? [y/N] ',
      ].join('\n');

      const approved = await promptApproval(summary);
      if (!approved) {
        this.safeSend({
          type: 'job_result',
          jobId,
          status: 'failed',
          data: { error: 'Job rejected by user' },
        });
        this.activeJobs.delete(jobId);
        return;
      }
    }

    await this.executeJob(msg);
  }

  private handleJobComplete(msg: JobCompleteMsg): void {
    const removed = this.activeJobs.delete(msg.jobId);
    if (removed && this.config.verbose) {
      log('info', 'Job complete — removed from active jobs', { jobId: msg.jobId });
    }
  }

  private handleServerShutdown(msg: ServerShutdownMsg): void {
    if (this.config.verbose) {
      log('info', 'Server is shutting down', {
        reconnectAfter: msg.reconnectAfter,
      });
    } else {
      const delay = (msg.reconnectAfter ?? 30) * 1000;
      ui.disconnected('server shutdown');
      ui.reconnecting(delay);
    }
    this.draining = true;

    const reconnectAfterMs = (msg.reconnectAfter ?? 30) * 1_000;
    this.reconnectTimer = setTimeout(() => {
      this.draining = false;
      this.backoffMs = 1_000;
      this.reconnectTimer = null;
      this.connect();
    }, reconnectAfterMs);
  }

  // -------------------------------------------------------------------------
  // Private — job execution
  // -------------------------------------------------------------------------

  private async executeJob(job: JobMsg): Promise<void> {
    const { JobExecutor } = await import('./executor.js');
    const executor = new JobExecutor(this.config, (msg, pct, logs) => {
      this.safeSend({ type: 'job_progress', jobId: job.jobId, message: msg, percent: pct, logs: logs || [] });
      if (!this.config.verbose) {
        ui.jobProgress(msg, pct);
      }
    });
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const result = await executor.execute(job.action as string, payload);
    this.safeSend({
      type: 'job_result',
      jobId: job.jobId,
      status: result.success ? 'done' : 'failed',
      data: result.data,
    });
    if (!this.config.verbose) {
      if (result.success) {
        ui.jobDone(result.data);
      } else {
        ui.jobFailed((result.data.error as string | undefined) ?? 'Unknown error');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private — heartbeat
  // -------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.safeSend({ type: 'ping' } satisfies PingMsg);
    }, 30_000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private — utilities
  // -------------------------------------------------------------------------

  /** Send a message; swallows errors so callers never throw on closed sockets. */
  private safeSend(payload: object): void {
    if (!this.ws || this.ws.readyState !== 1 /* WebSocket.OPEN */) {
      if (this.config.verbose) {
        log('debug', 'safeSend: socket not open — dropping message', {
          type: (payload as Record<string, unknown>).type,
        });
      }
      return;
    }
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      if (this.config.verbose) {
        log('warn', 'safeSend: send failed', {
          error: (err as Error).message,
        });
      }
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepAliveTimer !== null) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}
