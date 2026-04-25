/**
 * =============================================================================
 * AgentHub Service
 * =============================================================================
 *
 * Core WebSocket connection manager and job dispatch service for external
 * coding agents. Handles:
 *   - Agent authentication via hashed tokens
 *   - Connection lifecycle (auth, register, heartbeat, disconnect)
 *   - Job routing to available agents by repo + load balancing
 *   - Queued job delivery when agents connect/register
 *   - Real-time status publishing via SSE
 */

import crypto from 'crypto';
import type { WebSocket } from 'ws';
import { createChildLogger } from '../../lib/logger.js';
import type { AgentJobQueue } from './job-queue.js';
import type {
  AgentConnection,
  AgentToHubMessage,
  HubToAgentMessage,
  AgentJobData,
  AgentStatusInfo,
} from './types.js';
import {
  AUTH_DEADLINE_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_AGENTS_PER_TENANT,
  MAX_AGENTS_TOTAL,
  DEFAULT_MAX_ACTIVE_JOBS,
  CLEANUP_INTERVAL_MS,
} from './types.js';

const log = createChildLogger({ module: 'agent-hub' });

export class AgentHub {
  private connections = new Map<string, AgentConnection>();
  private tenantIndex = new Map<string, Set<string>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private prisma: any,
    private sseService: any,
    private jobQueue: AgentJobQueue,
    private outcomeObserver?: any,
    private engagementService?: any,
    private commsRouter?: any,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  // ── Connection Lifecycle ───────────────────────────────────────

  handleConnection(ws: WebSocket): void {
    let authenticated = false;

    // Auth deadline: close if no auth message within AUTH_DEADLINE_MS
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        try { ws.close(1000, 'auth_timeout'); } catch {}
      }
    }, AUTH_DEADLINE_MS);

    const onMessage = async (raw: string) => {
      let msg: AgentToHubMessage;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
      } catch {
        this.send(ws, { type: 'auth_error', message: 'Invalid JSON' });
        ws.close(1008, 'invalid_json');
        return;
      }

      if (!authenticated) {
        clearTimeout(authTimer);

        if (msg.type !== 'auth') {
          this.send(ws, { type: 'auth_error', message: 'First message must be auth' });
          ws.close(1008, 'expected_auth');
          return;
        }

        const result = await this.authenticate(msg.token);
        if (!result) {
          this.send(ws, { type: 'auth_error', message: 'Invalid or revoked token' });
          ws.close(1008, 'auth_failed');
          return;
        }

        // Check tenant limit
        const tenantAgents = this.tenantIndex.get(result.tenantId);
        if (tenantAgents && tenantAgents.size >= MAX_AGENTS_PER_TENANT) {
          this.send(ws, { type: 'auth_error', message: 'Tenant agent limit reached' });
          ws.close(1008, 'tenant_limit');
          return;
        }

        // Check global limit
        if (this.connections.size >= MAX_AGENTS_TOTAL) {
          this.send(ws, { type: 'auth_error', message: 'Server agent limit reached' });
          ws.close(1008, 'global_limit');
          return;
        }

        authenticated = true;
        const agentId = crypto.randomUUID();

        const conn: AgentConnection = {
          agentId,
          tenantId: result.tenantId,
          ws,
          repos: [],
          capabilities: [],
          activeJobs: new Set(),
          maxActiveJobs: DEFAULT_MAX_ACTIVE_JOBS,
          connectedAt: new Date(),
          lastPingAt: new Date(),
          authenticated: true,
        };

        this.connections.set(agentId, conn);

        if (!this.tenantIndex.has(result.tenantId)) {
          this.tenantIndex.set(result.tenantId, new Set());
        }
        this.tenantIndex.get(result.tenantId)!.add(agentId);

        // Listen for close event
        ws.on('close', () => {
          this.handleDisconnect(agentId, 'ws_close');
        });

        this.send(ws, { type: 'auth_ok', agentId, tenantId: result.tenantId });

        log.info('Agent connected', { agentId, tenantId: result.tenantId });
        return;
      }

      // Already authenticated — route to handleMessage
      // Find agentId for this ws
      const agentId = this.findAgentIdByWs(ws);
      if (agentId) {
        this.handleMessage(agentId, msg);
      }
    };

    ws.on('message', onMessage as any);
  }

  private async authenticate(token: string): Promise<{ tenantId: string } | null> {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await this.prisma.agentToken.findUnique({ where: { tokenHash: hash } });
    if (!record || record.revokedAt) return null;
    await this.prisma.agentToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return { tenantId: record.tenantId };
  }

  private async handleMessage(agentId: string, msg: AgentToHubMessage): Promise<void> {
    const conn = this.connections.get(agentId);
    if (!conn) return;

    switch (msg.type) {
      case 'register':
        conn.repos = msg.repos;
        conn.capabilities = msg.capabilities;
        this.send(conn.ws, { type: 'registered', repos: msg.repos.length });
        this.deliverQueuedJobs(agentId);
        break;

      case 'ping':
        conn.lastPingAt = new Date();
        this.send(conn.ws, { type: 'pong' });
        break;

      case 'job_ack':
        this.jobQueue.markInProgress(msg.jobId);
        break;

      case 'job_progress':
        this.sseService.publish(conn.tenantId, 'agent_job.status_changed', {
          jobId: msg.jobId,
          status: 'in_progress',
          message: msg.message,
          percent: msg.percent,
          logs: msg.logs || [],
        });
        break;

      case 'job_result':
        conn.activeJobs.delete(msg.jobId);
        if (msg.status === 'done') {
          this.jobQueue.markComplete(msg.jobId, msg.data);
        } else {
          this.jobQueue.markFailed(msg.jobId, (msg.data?.error as string) || 'Agent reported failure');
        }
        this.send(conn.ws, { type: 'job_complete', jobId: msg.jobId });
        this.sseService.publish(conn.tenantId, 'agent_job.status_changed', {
          jobId: msg.jobId,
          status: msg.status,
          data: msg.data,
        });

        // Bridge to Ticket (and the AgentTask mirror for legacy readers).
        // N6 final: Ticket is the primary; the AgentTask update stays
        // because (a) outcome observer still reads it, (b) the
        // downstream engagement-advance logic reads agentType off it.
        // Those two spots will migrate next; for now we write both.
        try {
          const agentJob = await this.prisma.agentJob.findUnique({ where: { id: msg.jobId } });
          const taskId = (agentJob?.payload as any)?.taskId;
          const ticketIdFromJob = (agentJob?.payload as any)?.ticketId;
          const ticketId = ticketIdFromJob ?? (taskId ? `tix_legacy_${taskId}` : null);

          // 1) Primary write: Ticket.
          if (ticketId) {
            try {
              await (this.prisma as any).ticket.update({
                where: { id: ticketId },
                data: {
                  status: msg.status === 'done' ? 'done' : 'failed',
                  result: msg.data as any,
                  completedAt: new Date(),
                  error:
                    msg.status === 'failed'
                      ? ((msg.data as any)?.error || 'Agent reported failure')
                      : null,
                },
              });
            } catch (err) {
              // Ticket may not exist yet for legacy-only flows; logged below.
              log.debug('Ticket update failed in callback (may be legacy-only flow)', {
                ticketId,
                error: (err as Error).message,
              });
            }
          }

          // 2) Legacy mirror: AgentTask. Kept while outcome observer
          // + engagement-advance still read from it.
          if (taskId) {
            await this.prisma.agentTask.update({
              where: { id: taskId },
              data: {
                status: msg.status === 'done' ? 'completed' : 'failed',
                output: msg.data,
                completedAt: new Date(),
                error: msg.status === 'failed' ? ((msg.data as any)?.error || 'Agent reported failure') : null,
              },
            });

            if (this.outcomeObserver) {
              // Prefer the ticket-native recorder when we have a
              // ticketId; falls back to the legacy path otherwise.
              if (ticketId && (this.outcomeObserver as any).recordFromTicket) {
                await (this.outcomeObserver as any).recordFromTicket(ticketId);
              } else {
                await this.outcomeObserver.recordFromTask(taskId);
              }
            }

            const task = await this.prisma.agentTask.findUnique({ where: { id: taskId } });
            if (task && msg.status === 'done') {
              // engagement.advancePhase signature is (tenantId, engagementId, input).
              // Earlier callers passed (task.meetingId, 'test'), which Prisma rejected
              // with `prisma.engagement.findFirst({ where: { id: 'test' } })` — bridge
              // ended up logging "Failed to bridge job result to Ticket/AgentTask"
              // even though the user-visible state was already correct. Pull the real
              // engagementId out of the AgentJob payload and the tenantId off the job
              // record itself.
              const engagementId =
                (agentJob.payload as any)?.engagementId ||
                (task as any).engagementId ||
                null;
              if (task.agentType === 'dev_agent' && this.engagementService) {
                if (engagementId) {
                  try {
                    await this.engagementService.advancePhase(agentJob.tenantId, engagementId, {
                      targetPhase: 'test',
                      confidence: 1.0,
                      output: { prdId: (agentJob.payload as any)?.prdId },
                    });
                  } catch (err) {
                    log.debug('advancePhase build→test failed (non-fatal)', { engagementId, error: (err as Error).message });
                  }
                }
                await this.chainQAJob(agentJob);
              } else if (task.agentType === 'qa_agent' && this.engagementService) {
                if (engagementId) {
                  try {
                    await this.engagementService.advancePhase(agentJob.tenantId, engagementId, {
                      targetPhase: 'ship',
                      confidence: 1.0,
                      output: { prdId: (agentJob.payload as any)?.prdId },
                    });
                  } catch (err) {
                    log.debug('advancePhase test→ship failed (non-fatal)', { engagementId, error: (err as Error).message });
                  }
                }
              }
            }

            // CommunicationRouter exposes `send(SendMessageInput)`, not a
            // generic `notify(tenantId, event)`. The intended pub/sub-style
            // broadcast here is already covered by the SSE publish at the top
            // of this handler (`agent_job.status_changed`), which the web UI
            // and any external listener already consume. We removed the
            // broken `commsRouter.notify(...)` call rather than retrofitting
            // a fake message — chief-of-staff comms still happen through
            // their own triggers (clarification requests, brief approvals)
            // via the same router. See task #189.
          }
        } catch (err) {
          // Pino's signature is (obj, msg) — the existing (msg, obj) usage
          // across this file silently drops the data object, which is why
          // earlier "Failed to bridge…" errors had no context. We log it
          // the right way around here so the actual cause is visible.
          log.error(
            {
              jobId: msg.jobId,
              error: (err as Error).message,
              stack: (err as Error).stack,
            },
            'Failed to bridge job result to Ticket/AgentTask',
          );
        }
        break;
    }
  }

  // ── Job Dispatch ───────────────────────────────────────────────

  async dispatchJob(tenantId: string, targetRepo: string, job: AgentJobData): Promise<string> {
    const jobId = await this.jobQueue.enqueue(job);

    const agent = this.getAvailableAgent(tenantId, targetRepo);
    if (agent) {
      await this.jobQueue.markDispatched(jobId, agent.agentId);
      agent.activeJobs.add(jobId);
      this.send(agent.ws, {
        type: 'job',
        jobId,
        action: job.action,
        payload: job.payload,
      });
    }

    return jobId;
  }

  getAvailableAgent(tenantId: string, targetRepo: string): AgentConnection | null {
    const agentIds = this.tenantIndex.get(tenantId);
    if (!agentIds) return null;

    let best: AgentConnection | null = null;
    for (const agentId of agentIds) {
      const conn = this.connections.get(agentId);
      if (!conn || !conn.authenticated) continue;
      if (!conn.repos.includes(targetRepo)) continue;
      if (conn.activeJobs.size >= conn.maxActiveJobs) continue;
      if (!best || conn.activeJobs.size < best.activeJobs.size) {
        best = conn;
      }
    }
    return best;
  }

  // ── Queued Job Delivery ────────────────────────────────────────

  private async deliverQueuedJobs(agentId: string): Promise<void> {
    const conn = this.connections.get(agentId);
    if (!conn || conn.repos.length === 0) return;

    const jobs = await this.jobQueue.dequeue(conn.tenantId, conn.repos);
    for (const job of jobs) {
      if (conn.activeJobs.size >= conn.maxActiveJobs) break;
      await this.jobQueue.markDispatched(job.id, agentId);
      conn.activeJobs.add(job.id);
      this.send(conn.ws, {
        type: 'job',
        jobId: job.id,
        action: job.action,
        payload: job.payload,
      });
    }
  }

  // ── Status ─────────────────────────────────────────────────────

  getAgentStatus(tenantId: string): AgentStatusInfo[] {
    const agentIds = this.tenantIndex.get(tenantId);
    if (!agentIds) return [];
    return [...agentIds]
      .map(id => this.connections.get(id))
      .filter((c): c is AgentConnection => !!c && c.authenticated)
      .map(c => ({
        agentId: c.agentId,
        repos: c.repos,
        capabilities: c.capabilities,
        activeJobs: c.activeJobs.size,
        maxActiveJobs: c.maxActiveJobs,
        connectedAt: c.connectedAt,
        lastPingAt: c.lastPingAt,
      }));
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  async getPendingJobCount(): Promise<number> {
    const result = await this.prisma.agentJob.count({ where: { status: 'pending' } });
    return result;
  }

  // ── Cleanup & Shutdown ─────────────────────────────────────────

  private cleanup(): void {
    const now = Date.now();
    for (const [agentId, conn] of this.connections) {
      if (now - conn.lastPingAt.getTime() > HEARTBEAT_TIMEOUT_MS) {
        this.handleDisconnect(agentId, 'heartbeat_timeout');
      }
    }
    this.jobQueue.expireStale().catch(() => {});
  }

  private handleDisconnect(agentId: string, reason: string): void {
    const conn = this.connections.get(agentId);
    if (!conn) return;

    this.connections.delete(agentId);
    const tenantSet = this.tenantIndex.get(conn.tenantId);
    if (tenantSet) {
      tenantSet.delete(agentId);
      if (tenantSet.size === 0) this.tenantIndex.delete(conn.tenantId);
    }

    try { conn.ws.close(1000, reason); } catch {}

    log.info('Agent disconnected', { agentId, tenantId: conn.tenantId, reason });
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);

    for (const conn of this.connections.values()) {
      this.send(conn.ws, { type: 'server_shutdown', reconnectAfter: 30 });
    }

    await new Promise(r => setTimeout(r, 2000));

    for (const [agentId] of this.connections) {
      this.handleDisconnect(agentId, 'server_shutdown');
    }
  }

  // ── QA Chaining ─────────────────────────────────────────────────

  private async chainQAJob(devJob: any): Promise<void> {
    const payload = devJob.payload as any;
    if (!payload?.branch) return;

    try {
      await this.dispatchJob(devJob.tenantId, devJob.targetRepo, {
        tenantId: devJob.tenantId,
        action: 'review_pr',
        targetRepo: devJob.targetRepo,
        payload: {
          // The daemon's executor reads payload.targetRepo to route the
          // job to the right local checkout; without it the QA chain
          // fails with `Unknown targetRepo: ""`.
          targetRepo: devJob.targetRepo,
          branch: payload.branch,
          prdContent: payload.prdContent,
          prUrl: devJob.result?.prUrl,
        },
      });
      log.info('QA job chained after dev completion', { devJobId: devJob.id });
    } catch (err) {
      log.error('Failed to chain QA job', { devJobId: devJob.id, error: (err as Error).message });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  private send(ws: WebSocket, msg: HubToAgentMessage): void {
    if (ws.readyState === 1 /* WebSocket.OPEN */) {
      ws.send(JSON.stringify(msg));
    }
  }

  private findAgentIdByWs(ws: WebSocket): string | null {
    for (const [agentId, conn] of this.connections) {
      if (conn.ws === ws) return agentId;
    }
    return null;
  }
}
