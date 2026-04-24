# WebSocket Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side WebSocket infrastructure that accepts agent connections, authenticates them, routes jobs, and queues work when agents are offline.

**Architecture:** Manual WebSocket upgrade handler (following existing Twilio pattern) with AgentHub service for connection/job management, Redis-backed job queue for offline persistence, and SSE integration for real-time UI updates. Shared upgrade dispatcher replaces fragile multiple `server.on('upgrade')` listeners.

**Tech Stack:** TypeScript, ws (already installed), Fastify, Prisma 7, Redis, Vitest

**Spec:** `docs/superpowers/specs/2026-03-20-websocket-hub-design.md`

---

## File Structure

### New Files

```
mvp/src/services/agent-hub/types.ts                    # Protocol message types, AgentConnection interface
mvp/src/services/agent-hub/agent-hub.service.ts         # Core hub: connections, auth, dispatch, heartbeat
mvp/src/services/agent-hub/job-queue.ts                 # Redis-backed job persistence
mvp/src/lib/websocket-dispatcher.ts                     # Shared upgrade dispatcher for all WS routes
mvp/src/routes/agent-hub.routes.ts                      # REST API for tokens + job status
mvp/src/services/agent-hub/__tests__/agent-hub.service.test.ts
mvp/src/services/agent-hub/__tests__/job-queue.test.ts
mvp/src/routes/__tests__/agent-hub.routes.test.ts
```

### Modified Files

```
mvp/prisma/schema.prisma                                # Add AgentToken + AgentJob models
mvp/src/lib/di-container.ts                             # Register AgentHub + JobQueue
mvp/src/index.ts                                        # Setup shared WS dispatcher, migrate Twilio
mvp/src/routes/twilio.routes.ts                         # Extract WS server for shared dispatcher
mvp/src/routes/index.ts                                 # Register agent-hub routes, extend /health
mvp/src/lib/graceful-shutdown.ts                        # Add AgentHub cleanup
```

---

## Task 1: Protocol Types and Interfaces

**Files:**
- Create: `mvp/src/services/agent-hub/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// mvp/src/services/agent-hub/types.ts
import type { WebSocket } from 'ws';

// ── Protocol Messages (Agent → Hub) ──────────────────────────────

export interface AuthMessage {
  type: 'auth';
  token: string;
}

export interface RegisterMessage {
  type: 'register';
  repos: string[];          // Slugs like "acme/backend"
  capabilities: string[];   // "claude", "git", "npm"
}

export interface PingMessage {
  type: 'ping';
}

export interface JobAckMessage {
  type: 'job_ack';
  jobId: string;
}

export interface JobProgressMessage {
  type: 'job_progress';
  jobId: string;
  message: string;
  percent: number;
}

export interface JobResultMessage {
  type: 'job_result';
  jobId: string;
  status: 'done' | 'failed';
  data: Record<string, unknown>;
}

export type AgentToHubMessage =
  | AuthMessage
  | RegisterMessage
  | PingMessage
  | JobAckMessage
  | JobProgressMessage
  | JobResultMessage;

// ── Protocol Messages (Hub → Agent) ──────────────────────────────

export interface AuthOkMessage {
  type: 'auth_ok';
  agentId: string;
  tenantId: string;
}

export interface AuthErrorMessage {
  type: 'auth_error';
  message: string;
}

export interface RegisteredMessage {
  type: 'registered';
  repos: number;
}

export interface PongMessage {
  type: 'pong';
}

export interface JobMessage {
  type: 'job';
  jobId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface JobCompleteMessage {
  type: 'job_complete';
  jobId: string;
}

export interface JobResumeMessage {
  type: 'job_resume';
  jobId: string;
  payload: Record<string, unknown>;
}

export interface ServerShutdownMessage {
  type: 'server_shutdown';
  reconnectAfter: number;
}

export type HubToAgentMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | RegisteredMessage
  | PongMessage
  | JobMessage
  | JobCompleteMessage
  | JobResumeMessage
  | ServerShutdownMessage;

// ── Internal Types ───────────────────────────────────────────────

export interface AgentConnection {
  agentId: string;
  tenantId: string;
  ws: WebSocket;
  repos: string[];
  capabilities: string[];
  activeJobs: Set<string>;   // Set of jobIds
  maxActiveJobs: number;
  connectedAt: Date;
  lastPingAt: Date;
  authenticated: boolean;
}

export type AgentJobStatus = 'pending' | 'dispatched' | 'in_progress' | 'done' | 'failed';

export interface AgentJobData {
  id?: string;
  tenantId: string;
  action: string;
  targetRepo: string;
  payload: Record<string, unknown>;
}

export interface AgentStatusInfo {
  agentId: string;
  repos: string[];
  capabilities: string[];
  activeJobs: number;
  maxActiveJobs: number;
  connectedAt: Date;
  lastPingAt: Date;
}

// ── Constants ────────────────────────────────────────────────────

export const AUTH_DEADLINE_MS = 10_000;        // 10 seconds
export const HEARTBEAT_TIMEOUT_MS = 90_000;    // 90 seconds (3 missed pings)
export const JOB_ACK_TIMEOUT_MS = 5 * 60_000;  // 5 minutes
export const STALE_JOB_TIMEOUT_MS = 60 * 60_000; // 1 hour
export const JOB_EXPIRY_MS = 24 * 60 * 60_000;   // 24 hours
export const MAX_AGENTS_PER_TENANT = 20;
export const MAX_AGENTS_TOTAL = 500;
export const DEFAULT_MAX_ACTIVE_JOBS = 3;
export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const CLEANUP_INTERVAL_MS = 5 * 60_000;    // 5 minutes
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd mvp && npx tsc --noEmit 2>&1 | grep "agent-hub"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add mvp/src/services/agent-hub/types.ts
git commit -m "feat: add WebSocket hub protocol types and interfaces"
```

---

## Task 2: Prisma Models — AgentToken + AgentJob

**Files:**
- Modify: `mvp/prisma/schema.prisma`

- [ ] **Step 1: Add models to Prisma schema**

Append after the existing `AgentOutcome` model:

```prisma
model AgentToken {
  id         String    @id @default(cuid())
  tenantId   String
  tenant     Tenant    @relation(fields: [tenantId], references: [id])
  name       String
  tokenHash  String    @unique
  tokenHint  String
  createdBy  String
  lastUsedAt DateTime?
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())

  @@index([tokenHash])
  @@index([tenantId])
  @@map("agent_tokens")
}

model AgentJob {
  id           String    @id @default(cuid())
  tenantId     String
  agentId      String?
  action       String
  status       String    @default("pending")
  targetRepo   String
  payload      Json
  result       Json?
  error        String?
  dispatchedAt DateTime?
  completedAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([tenantId, status])
  @@index([agentId, status])
  @@map("agent_jobs")
}
```

Also add `agentTokens AgentToken[]` to the Tenant model's relations.

- [ ] **Step 2: Generate Prisma client**

Run: `cd mvp && npx prisma generate`

- [ ] **Step 3: Push schema to running DB**

Run: `cd mvp && npx prisma db push --accept-data-loss`

- [ ] **Step 4: Commit**

```bash
git add mvp/prisma/
git commit -m "feat: add AgentToken and AgentJob Prisma models"
```

---

## Task 3: AgentJobQueue (Redis-backed)

**Files:**
- Create: `mvp/src/services/agent-hub/job-queue.ts`
- Test: `mvp/src/services/agent-hub/__tests__/job-queue.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// mvp/src/services/agent-hub/__tests__/job-queue.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentJobQueue } from '../job-queue.js';

describe('AgentJobQueue', () => {
  let mockPrisma: any;
  let queue: AgentJobQueue;

  beforeEach(() => {
    mockPrisma = {
      agentJob: {
        create: vi.fn().mockResolvedValue({ id: 'job-1', status: 'pending' }),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    queue = new AgentJobQueue(mockPrisma);
  });

  describe('enqueue', () => {
    it('creates a pending job in DB', async () => {
      const jobId = await queue.enqueue({
        tenantId: 'tenant-1', action: 'implement_prd',
        targetRepo: 'acme/backend', payload: { prdContent: 'Build X' },
      });
      expect(jobId).toBe('job-1');
      expect(mockPrisma.agentJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'pending', action: 'implement_prd' }),
      });
    });
  });

  describe('dequeue', () => {
    it('returns pending jobs matching repos', async () => {
      mockPrisma.agentJob.findMany.mockResolvedValue([
        { id: 'job-1', targetRepo: 'acme/backend', payload: {} },
      ]);
      const jobs = await queue.dequeue('tenant-1', ['acme/backend', 'acme/frontend']);
      expect(jobs).toHaveLength(1);
      expect(mockPrisma.agentJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-1', status: 'pending' }),
        }),
      );
    });
  });

  describe('markDispatched', () => {
    it('updates status to dispatched with agentId', async () => {
      await queue.markDispatched('job-1', 'agent-1');
      expect(mockPrisma.agentJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'dispatched', agentId: 'agent-1' }),
      });
    });
  });

  describe('markComplete', () => {
    it('updates status to done with result', async () => {
      await queue.markComplete('job-1', { prUrl: 'https://github.com/pr/1' });
      expect(mockPrisma.agentJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'done', result: { prUrl: 'https://github.com/pr/1' } }),
      });
    });
  });

  describe('markFailed', () => {
    it('updates status to failed with error', async () => {
      await queue.markFailed('job-1', 'claude crashed');
      expect(mockPrisma.agentJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'failed', error: 'claude crashed' }),
      });
    });
  });

  describe('expireStale', () => {
    it('marks old pending jobs as failed', async () => {
      mockPrisma.agentJob.updateMany.mockResolvedValue({ count: 2 });
      const count = await queue.expireStale();
      expect(count).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd mvp && npx vitest run src/services/agent-hub/__tests__/job-queue.test.ts`

- [ ] **Step 3: Implement AgentJobQueue**

```typescript
// mvp/src/services/agent-hub/job-queue.ts
import { createChildLogger } from '../../lib/logger.js';
import type { AgentJobData, AgentJobStatus } from './types.js';
import { JOB_EXPIRY_MS, STALE_JOB_TIMEOUT_MS, JOB_ACK_TIMEOUT_MS } from './types.js';

const log = createChildLogger({ module: 'agent-job-queue' });

export class AgentJobQueue {
  constructor(private prisma: any) {}

  async enqueue(job: AgentJobData): Promise<string> {
    const record = await this.prisma.agentJob.create({
      data: {
        tenantId: job.tenantId,
        action: job.action,
        targetRepo: job.targetRepo,
        payload: job.payload,
        status: 'pending',
      },
    });
    log.info('Job enqueued', { jobId: record.id, action: job.action, targetRepo: job.targetRepo });
    return record.id;
  }

  async dequeue(tenantId: string, repos: string[]): Promise<any[]> {
    return this.prisma.agentJob.findMany({
      where: {
        tenantId,
        status: 'pending',
        targetRepo: { in: repos },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getStatus(jobId: string): Promise<AgentJobStatus | null> {
    const job = await this.prisma.agentJob.findUnique({ where: { id: jobId } });
    return job?.status || null;
  }

  async markDispatched(jobId: string, agentId: string): Promise<void> {
    await this.prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'dispatched', agentId, dispatchedAt: new Date() },
    });
  }

  async markInProgress(jobId: string): Promise<void> {
    await this.prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'in_progress' },
    });
  }

  async markComplete(jobId: string, result: any): Promise<void> {
    await this.prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'done', result, completedAt: new Date() },
    });
    log.info('Job completed', { jobId });
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await this.prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'failed', error, completedAt: new Date() },
    });
    log.warn('Job failed', { jobId, error });
  }

  async expireStale(): Promise<number> {
    const cutoff = new Date(Date.now() - JOB_EXPIRY_MS);
    const result = await this.prisma.agentJob.updateMany({
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
      },
      data: { status: 'failed', error: 'Expired: no agent available for 24 hours' },
    });

    // Also fail dispatched jobs with no ack
    const ackCutoff = new Date(Date.now() - JOB_ACK_TIMEOUT_MS);
    const unacked = await this.prisma.agentJob.updateMany({
      where: {
        status: 'dispatched',
        dispatchedAt: { lt: ackCutoff },
      },
      data: { status: 'pending', agentId: null, dispatchedAt: null },
    });

    // Fail in_progress jobs with no agent for too long
    const staleCutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);
    const stale = await this.prisma.agentJob.updateMany({
      where: {
        status: 'in_progress',
        updatedAt: { lt: staleCutoff },
      },
      data: { status: 'failed', error: 'Agent disconnected and did not reconnect within 1 hour' },
    });

    const total = result.count + unacked.count + stale.count;
    if (total > 0) log.info('Expired stale jobs', { expired: result.count, requeued: unacked.count, stale: stale.count });
    return total;
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add mvp/src/services/agent-hub/job-queue.ts mvp/src/services/agent-hub/__tests__/job-queue.test.ts
git commit -m "feat: add AgentJobQueue with Redis-backed job persistence"
```

---

## Task 4: AgentHub Service

**Files:**
- Create: `mvp/src/services/agent-hub/agent-hub.service.ts`
- Test: `mvp/src/services/agent-hub/__tests__/agent-hub.service.test.ts`

- [ ] **Step 1: Write failing tests**

Test auth flow (timeout, success, failure), registration, heartbeat timeout, job dispatch (routing, load balancing, capacity cap), queued job delivery, and disconnect handling. This is the largest test file.

Key test cases:
- `handleConnection` with valid token → auth_ok
- `handleConnection` with invalid token → auth_error + close
- Auth timeout after 10 seconds → connection closed
- `handleMessage` with register → updates repos
- `handleMessage` with ping → responds pong
- Heartbeat timeout (90s no ping) → disconnect
- `dispatchJob` finds correct agent by repo
- `dispatchJob` load balances (picks least busy)
- `dispatchJob` respects maxActiveJobs cap
- `dispatchJob` with no available agent → enqueues in job queue
- `deliverQueuedJobs` on connect → dequeues and sends jobs
- Agent disconnect → connection removed from maps
- Connection limits (per-tenant and total)

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement AgentHub**

The service:
- Constructor takes `(prisma, sseService, jobQueue)`
- `handleConnection(ws)` — starts auth timeout, waits for first message
- Auth: SHA-256 hash the token, look up in `agentToken` table, check not revoked, update `lastUsedAt`
- Maintains `connections: Map<string, AgentConnection>` and `tenantIndex: Map<string, Set<string>>`
- `dispatchJob(tenantId, targetRepo, job)` — find agent with repo + capacity, send via WS, or enqueue
- `handleMessage(agentId, msg)` — switch on msg.type: register, ping, job_ack, job_progress, job_result
- On job_progress → publish via `sseService.publish(tenantId, 'agent_job.status_changed', ...)`
- On job_result → `jobQueue.markComplete/markFailed`, publish SSE, decrement activeJobs
- Cleanup timer every 5 minutes: heartbeat timeout check + `jobQueue.expireStale()`
- `shutdown()` — send server_shutdown to all, close connections

Generate the agentId as a cuid on connection (not from the token).

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add mvp/src/services/agent-hub/agent-hub.service.ts mvp/src/services/agent-hub/__tests__/agent-hub.service.test.ts
git commit -m "feat: add AgentHub service with connection management and job dispatch"
```

---

## Task 5: Shared WebSocket Dispatcher

**Files:**
- Create: `mvp/src/lib/websocket-dispatcher.ts`
- Modify: `mvp/src/index.ts`
- Modify: `mvp/src/routes/twilio.routes.ts`

- [ ] **Step 1: Create the shared dispatcher**

```typescript
// mvp/src/lib/websocket-dispatcher.ts
import type { Server } from 'http';
import type { WebSocketServer } from 'ws';
import { createChildLogger } from './logger.js';

const log = createChildLogger({ module: 'ws-dispatcher' });

export function setupWebSocketDispatcher(
  server: Server,
  routes: Map<string, WebSocketServer>,
): void {
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);

    for (const [pathPrefix, wss] of routes) {
      if (url.pathname.startsWith(pathPrefix)) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
        return;
      }
    }

    log.warn('WebSocket upgrade rejected: no matching route', { path: url.pathname });
    socket.destroy();
  });
}
```

- [ ] **Step 2: Modify Twilio routes to export its WebSocketServer**

In `mvp/src/routes/twilio.routes.ts`, change `setupTwilioMediaStreamWebSocket` to return the `WebSocketServer` instead of attaching its own `server.on('upgrade')` handler. It should still create the `wss` with `noServer: true`, but NOT call `server.on('upgrade')`. Instead, it listens to `wss.on('connection', ...)` for incoming connections.

- [ ] **Step 3: Update index.ts to use shared dispatcher**

In `mvp/src/index.ts`, replace the direct `setupTwilioMediaStreamWebSocket(app.server, ...)` call with:

```typescript
import { setupWebSocketDispatcher } from './lib/websocket-dispatcher.js';
import { WebSocketServer } from 'ws';

// Create agent hub WebSocket server
const agentWss = new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024 });
agentWss.on('connection', (ws) => {
  app.services.agentHub.handleConnection(ws);
});

// Create Twilio WebSocket server (refactored)
const twilioWss = setupTwilioMediaStreamWebSocket({ /* deps */ });

// Shared dispatcher routes by path
setupWebSocketDispatcher(app.server, new Map([
  ['/agent/ws', agentWss],
  ['/media-stream/', twilioWss],
]));
```

- [ ] **Step 4: Verify build and tests pass**

Run: `cd mvp && npx tsc --noEmit && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add mvp/src/lib/websocket-dispatcher.ts mvp/src/index.ts mvp/src/routes/twilio.routes.ts
git commit -m "feat: add shared WebSocket dispatcher, migrate Twilio to shared routing"
```

---

## Task 6: REST API — Agent Tokens + Job Status

**Files:**
- Create: `mvp/src/routes/agent-hub.routes.ts`
- Test: `mvp/src/routes/__tests__/agent-hub.routes.test.ts`
- Modify: `mvp/src/routes/index.ts`

- [ ] **Step 1: Write failing tests**

Test: create token, list tokens (shows hint not raw), revoke token, get agent status, list jobs, get job detail. Standard Fastify route testing pattern with `app.inject()`.

- [ ] **Step 2: Implement routes**

```typescript
// mvp/src/routes/agent-hub.routes.ts
// POST   /tokens       — Create token (returns raw once, stores hash)
// GET    /tokens       — List tokens (shows tokenHint)
// DELETE /tokens/:id   — Revoke (set revokedAt)
// GET    /status       — Connected agents from agentHub.getAgentStatus()
// GET    /jobs         — List AgentJobs (filterable by status)
// GET    /jobs/:id     — Job detail
```

Token creation:
- Generate random token: `wf0_${crypto.randomBytes(24).toString('hex')}`
- Hash with SHA-256 for storage
- Return raw token in response (shown to user once)
- Store hash + last-4-chars hint

- [ ] **Step 3: Register routes in index.ts**

Add to `mvp/src/routes/index.ts` inside the authenticated `/api` scope:
```typescript
app.register(agentHubRoutes, { prefix: '/agents' });
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add mvp/src/routes/agent-hub.routes.ts mvp/src/routes/__tests__/agent-hub.routes.test.ts mvp/src/routes/index.ts
git commit -m "feat: add agent token and job status REST API endpoints"
```

---

## Task 7: DI Container + Graceful Shutdown + Health Check

**Files:**
- Modify: `mvp/src/lib/di-container.ts`
- Modify: `mvp/src/lib/graceful-shutdown.ts`
- Modify: `mvp/src/routes/index.ts` (health endpoint)

- [ ] **Step 1: Register AgentHub and JobQueue in DI container**

In `mvp/src/lib/di-container.ts`:

```typescript
import { AgentJobQueue } from '../services/agent-hub/job-queue.js';
import { AgentHub } from '../services/agent-hub/agent-hub.service.js';

// After sseService creation:
const agentJobQueue = new AgentJobQueue(rlsPrisma);
const agentHub = new AgentHub(rlsPrisma, sseService, agentJobQueue);

// Add to services object:
services.agentJobQueue = agentJobQueue;
services.agentHub = agentHub;
```

- [ ] **Step 2: Add AgentHub to graceful shutdown**

In `mvp/src/lib/graceful-shutdown.ts`, add AgentHub shutdown:

```typescript
// Before closing Fastify server:
if (app.services.agentHub) {
  await app.services.agentHub.shutdown();
}
```

- [ ] **Step 3: Extend health endpoint**

In the `/health` route in `mvp/src/routes/index.ts`, add agent hub status:

```typescript
services.agentHub = app.services.agentHub
  ? { connectedAgents: app.services.agentHub.getConnectionCount(), pendingJobs: await app.services.agentHub.getPendingJobCount() }
  : 'not_configured';
```

- [ ] **Step 4: Run full test suite**

Run: `cd mvp && npx tsc --noEmit && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add mvp/src/lib/di-container.ts mvp/src/lib/graceful-shutdown.ts mvp/src/routes/index.ts
git commit -m "feat: register AgentHub in DI, add graceful shutdown and health reporting"
```

---

## Task 8: Integration Test — Full Connection + Job Cycle

**Files:**
- Create: `mvp/src/__tests__/integration/agent-hub.test.ts`

- [ ] **Step 1: Write integration test**

Test the full flow using a real WebSocket client connecting to the Fastify server:

1. Create a test Fastify app with AgentHub registered
2. Start server, get port
3. Connect WebSocket client to `ws://localhost:{port}/agent/ws`
4. Send auth message → receive auth_ok
5. Send register message → receive registered
6. Dispatch a job from the server side → receive job message
7. Send job_ack → verify status update
8. Send job_result → verify job marked complete
9. Verify SSE was published (mock sseService)
10. Disconnect and verify cleanup

- [ ] **Step 2: Also test offline queuing**

1. Dispatch job with no agent connected → job status is 'pending'
2. Connect agent → receives queued job automatically
3. Complete job → verify full lifecycle

- [ ] **Step 3: Run tests**

Run: `cd mvp && npx vitest run src/__tests__/integration/agent-hub.test.ts`

- [ ] **Step 4: Run full suite**

Run: `cd mvp && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add mvp/src/__tests__/integration/agent-hub.test.ts
git commit -m "test: add integration tests for full WebSocket agent hub lifecycle"
```
