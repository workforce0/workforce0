# WebSocket Hub — Agent Connection Infrastructure

**Date:** 2026-03-20
**Status:** Approved
**Sub-project:** 1 of 4 (Agent Architecture Rebuild)

## Overview

The WebSocket Hub is the server-side infrastructure that accepts connections from user-side `workforce0-agent` daemons, authenticates them, routes jobs (implement PRD, review PR, run tests), and queues work when agents are offline.

This is sub-project 1 — the foundation that sub-projects 2 (agent package), 3 (agent rewire), and 4 (UI) depend on.

## Architecture Context

```
Workforce0 Cloud                          Customer's Machine
┌──────────────────────┐                 ┌─────────────────────┐
│ Web App + API        │                 │ workforce0-agent     │
│ PostgreSQL + Redis   │ ← WebSocket →   │ git repo + claude   │
│ AgentHub Service     │                 │ User's CLI sub      │
│ SSE Service          │                 └─────────────────────┘
└──────────────────────┘
```

The hub handles the server side. The agent (sub-project 2) handles the client side. AI compute happens on the customer's machine using their own CLI subscription.

## WebSocket Protocol

### Connection + Auth

Connection URL: `wss://your-domain/agent/ws` (no token in URL — tokens in URLs leak to logs, proxies, and load balancer traces).

Auth happens as the **first message** after connection. The hub enforces a **10-second auth deadline** — if no valid `auth` message arrives, the connection is closed with code 4000.

```
Agent → Hub:  { type: "auth", token: "wf0_abc123" }
Hub → Agent:  { type: "auth_ok", agentId: "agent_xyz", tenantId: "tenant_abc" }
```

Token is a pre-generated `AgentToken` (created by admin in Settings UI). Validated by looking up the SHA-256 hash of the token in the DB. Connection rejected with `{ type: "auth_error", message: "..." }` and WebSocket close if invalid or revoked.

### Registration
```
Agent → Hub:  { type: "register", repos: ["/home/dev/myapp", "/home/dev/frontend"],
                capabilities: ["claude", "git", "npm"] }
Hub → Agent:  { type: "registered", repos: 2 }
```

Agent declares which repos it has access to and what tools are available. This is used for job routing — jobs targeting a specific repo are dispatched only to agents that have that repo.

**Repo identifiers:** Repos are identified by a slug (e.g., `owner/repo-name` or a user-chosen alias), NOT filesystem paths. This avoids path normalization issues across OS and symlinks. The agent resolves the slug to a local path internally. `register` can be sent multiple times to update repos/capabilities without reconnecting.

### Heartbeat
```
Agent → Hub:  { type: "ping" }
Hub → Agent:  { type: "pong" }
```

Every 30 seconds. If no ping for 90 seconds, hub considers agent disconnected.

### Job Dispatch
```
Hub → Agent:  { type: "job", jobId: "job_123", action: "implement_prd",
                payload: { prdContent: "...", targetRepo: "acme/backend",
                           branch: "feat/add-filter", title: "Add task filter" } }
Agent → Hub:  { type: "job_ack", jobId: "job_123" }
```

**Ack protocol:** Agent MUST send `job_ack` immediately upon receiving the job (before starting work). Work begins only after ack. If hub receives no ack within 5 minutes, it re-queues the job as `pending`. This prevents duplicate work from slow agents.

**Concurrency limit:** Each agent has a `maxActiveJobs` cap (default: 3). Hub will not dispatch more jobs to an agent at capacity. If all agents for a repo are at capacity, the job is queued in Redis.

### Job Progress
```
Agent → Hub:  { type: "job_progress", jobId: "job_123",
                message: "Writing tests...", percent: 60 }
```

Progress updates are forwarded to the tenant's SSE stream for real-time UI updates.

### Job Completion
```
Agent → Hub:  { type: "job_result", jobId: "job_123", status: "done",
                data: { prUrl: "https://github.com/co/repo/pull/42",
                        filesChanged: 12, testsRun: 8, testsPassed: 8 } }
Hub → Agent:  { type: "job_complete", jobId: "job_123" }
```

Status can be "done" or "failed" (with error message in data).

### Job Resume (after reconnect)
```
Hub → Agent:  { type: "job_resume", jobId: "job_123",
                payload: { ... original payload ... } }
```

Sent when an agent reconnects and has a job that was `in_progress` when it disconnected. **Idempotent:** If the agent is already working on this job (e.g., rapid reconnect during network flap), it should ignore the resume and continue. The agent uses `jobId` to deduplicate.

### Token Revocation
```
Hub → Agent:  WebSocket close with code 4001, reason "token_revoked"
```

## Server-Side Components

### 1. AgentHub Service (`services/agent-hub/agent-hub.service.ts`)

Core service managing WebSocket connections and job routing.

```typescript
class AgentHub {
  // Connection management
  private connections: Map<string, AgentConnection>;  // agentId → connection

  handleConnection(ws: WebSocket, token: string): void;
  handleDisconnect(agentId: string): void;
  handleMessage(agentId: string, message: AgentMessage): void;

  // Job routing
  dispatchJob(tenantId: string, targetRepo: string, job: AgentJobData): Promise<string>;
  getAvailableAgent(tenantId: string, targetRepo: string): AgentConnection | null;

  // Status
  getAgentStatus(tenantId: string): AgentStatusInfo[];
  getJobStatus(jobId: string): AgentJobStatus;

  // Lifecycle
  deliverQueuedJobs(agentId: string, repos: string[]): Promise<void>;
  cleanup(): void;
}

interface AgentConnection {
  agentId: string;
  tenantId: string;
  ws: WebSocket;
  repos: string[];           // Slugs like "acme/backend"
  capabilities: string[];
  activeJobs: number;
  maxActiveJobs: number;     // Default 3, configurable
  connectedAt: Date;
  lastPingAt: Date;
}
```

**Job routing logic:** When dispatching, find all connected agents for the tenant whose registered repos include `targetRepo` and whose `activeJobs < maxActiveJobs`. Pick the agent with fewest `activeJobs` (simple load balancing). If no agents available (all at capacity or none connected), persist to Redis job queue.

**Tenant index:** Connections are indexed by tenant via a secondary `Map<tenantId, Set<agentId>>` to avoid scanning all connections during dispatch. At 100+ agents across many tenants, this keeps dispatch O(agents_per_tenant) not O(all_agents).

### 2. Job Queue (`services/agent-hub/job-queue.ts`)

Redis-backed persistence for offline agents.

```typescript
class AgentJobQueue {
  enqueue(tenantId: string, job: AgentJobData): Promise<string>;
  dequeue(tenantId: string, repos: string[]): Promise<AgentJobData[]>;
  getStatus(jobId: string): Promise<AgentJobStatus>;
  markDispatched(jobId: string, agentId: string): Promise<void>;
  markComplete(jobId: string, result: any): Promise<void>;
  markFailed(jobId: string, error: string): Promise<void>;
  expireStale(): Promise<number>;  // Auto-fail jobs pending > 24h
}
```

Redis key patterns:
- `agent_job:{jobId}` — job data hash
- `agent_jobs_pending:{tenantId}` — sorted set (score = timestamp)
- `agent_jobs_active:{agentId}` — set of active job IDs

### 3. WebSocket Upgrade Handler

### Shared Upgrade Dispatcher

The codebase already has a Twilio WebSocket upgrade handler on `server.on('upgrade')`. Adding a second listener works but is fragile. Instead, create a **shared upgrade dispatcher** — a single `server.on('upgrade')` handler that routes by path:

```typescript
// lib/websocket-dispatcher.ts
function setupWebSocketDispatcher(server: http.Server, routes: Map<string, WebSocketServer>) {
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
    socket.destroy(); // No matching WebSocket route
  });
}
```

Registered in `index.ts`:
```typescript
setupWebSocketDispatcher(app.server, new Map([
  ['/agent/ws', agentHubWss],
  ['/media-stream/', twilioWss],  // Existing Twilio handler migrated
]));
```

**Message size limit:** The agent hub WebSocketServer is created with `maxPayload: 5 * 1024 * 1024` (5 MB). This accommodates large job results (PR diffs, test output) while preventing memory exhaustion from malicious payloads.

### 4. SSE Integration

Job status changes are published through the existing SSE service:

```typescript
// Inside AgentHub when job status changes
this.sseService.publish(tenantId, 'agent_job.status_changed', {
  jobId, status, progress, message, data
});
```

No new real-time transport needed for the UI — the frontend already listens to SSE events.

## Prisma Models

```prisma
model AgentToken {
  id         String    @id @default(cuid())
  tenantId   String
  tenant     Tenant    @relation(fields: [tenantId], references: [id])
  name       String                    // "Backend Agent", "Frontend Agent"
  tokenHash  String    @unique         // SHA-256 hash of wf0_xxx token
  tokenHint  String                    // Last 4 chars for display: "•••kf4"
  createdBy  String                    // userId who created it
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
  agentId      String?                 // null until dispatched
  action       String                  // implement_prd, review_pr, run_tests
  status       String    @default("pending")  // pending, dispatched, in_progress, done, failed
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

Note: `AgentToken.tokenHash` stores the SHA-256 hash, not the raw token. The raw token is shown to the user once on creation and never stored. Same pattern as GitHub personal access tokens.

## Job Lifecycle

```
PRD approved in web UI
    ↓
API creates AgentJob (status: 'pending', action: 'implement_prd')
    ↓
AgentHub.dispatchJob():
    ├── Agent online + has repo? → Send via WebSocket, status: 'dispatched'
    └── No agent available? → Queue in Redis, stays 'pending'
    ↓
Agent receives job → sends job_ack → status: 'in_progress'
    ↓
Agent runs claude -p (5-30 min)
    ├── Progress updates → forwarded to SSE → user sees live progress
    ├── Success → job_result with PR URL → status: 'done'
    └── Failure → job_result with error → status: 'failed'
    ↓
Hub updates AgentJob in DB
    ↓
SSE publishes to tenant → frontend updates in real-time
```

## Error Handling

| Scenario | Behavior |
|---|---|
| Agent disconnects mid-job | Job stays `in_progress`. 5-min grace period. On reconnect: `job_resume` sent. After 1 hour with no reconnect: job marked `failed`, user notified. |
| claude CLI crashes | Agent catches error, sends `job_result` with `status: "failed"` and error message. |
| Multiple agents for same repo | Hub picks agent with fewest active jobs. No duplicate dispatch. |
| Job queued, no agent for 24h | Job auto-expires to `failed`. User notified "No agent available for this repo." |
| Agent token revoked while connected | Hub closes WebSocket with code 4001. Agent must re-auth with new token. |
| Invalid message format | Hub ignores malformed messages, logs warning. Connection stays open. |
| Auth failure on connect | Hub sends `{ type: "auth_error" }` and closes connection. |

## Stale Job Cleanup

A periodic timer (every 5 minutes) checks for:
- `in_progress` jobs with no connected agent for > 1 hour → mark `failed`
- `pending` jobs older than 24 hours → mark `failed`
- `dispatched` jobs with no `job_ack` for > 5 minutes → re-queue as `pending`

## API Endpoints (for Settings UI, sub-project 4)

```
POST   /api/agents/tokens        — Create agent token (returns raw token once)
GET    /api/agents/tokens        — List tokens (shows hint, not raw token)
DELETE /api/agents/tokens/:id    — Revoke token
GET    /api/agents/status        — Connected agents + job stats
GET    /api/agents/jobs          — List jobs (filterable by status)
GET    /api/agents/jobs/:id      — Job detail with progress history
```

These are thin REST wrappers over AgentHub methods. Authentication via existing JWT tenant middleware.

## What This Sub-Project Does NOT Include

- The `workforce0-agent` npm package (sub-project 2)
- Rewiring Dev/QA agents to dispatch via WebSocket (sub-project 3)
- Settings UI for agent management (sub-project 4)
- Any changes to BA Agent (stays server-side)

## Integration Points

- **Existing:** Uses `ws` library (already installed), follows Twilio WebSocket upgrade pattern
- **Existing:** Publishes via `sseService.publish()` for real-time UI updates
- **Existing:** Uses Redis (already available) for job queue persistence
- **New:** Prisma models for AgentToken and AgentJob
- **New:** WebSocket upgrade handler registered in `index.ts`
- **New:** AgentHub registered in DI container as `fastify.services.agentHub`

## Connection Limits

- **Max agents per tenant:** 20 (matches SSE service pattern)
- **Max total agents:** 500 (server-wide cap)
- **Auth deadline:** 10 seconds after connection
- **Heartbeat timeout:** 90 seconds (3 missed pings)

When limits are exceeded, new connections are rejected with WebSocket close code 4002 and reason "connection_limit_exceeded".

## Graceful Shutdown

When the server receives SIGTERM/SIGINT:
1. Stop accepting new WebSocket connections
2. Send `{ type: "server_shutdown", reconnectAfter: 30 }` to all connected agents
3. Wait 5 seconds for agents to finish sending in-progress `job_result` messages
4. Close all WebSocket connections with code 1001 (going away)
5. Mark all `dispatched` (not acked) jobs as `pending` for re-dispatch after restart
6. `in_progress` jobs stay in that state — agents will reconnect and hub sends `job_resume`

Integrated into the existing `setupGracefulShutdown()` in `lib/graceful-shutdown.ts`.

## Testing Strategy

### Unit Tests
- `AgentHub`: connection lifecycle (connect → auth → register → disconnect), auth timeout, auth failure
- `AgentHub`: job dispatch routing (find correct agent by repo, load balancing, capacity cap)
- `AgentHub`: queued job delivery on agent connect
- `AgentJobQueue`: enqueue/dequeue, status transitions, stale expiry
- Heartbeat timeout detection

### Integration Tests
- Full WebSocket connection with mock agent: connect → auth → register → receive job → send result
- Offline queuing: dispatch with no agent → agent connects → receives queued job
- Reconnect: agent disconnects mid-job → reconnects → receives `job_resume`
- Shared upgrade dispatcher: verify both agent and Twilio paths route correctly

## Monitoring

Using existing `createChildLogger({ module: 'agent-hub' })`:
- Log: agent connected/disconnected (with tenantId, agentId, repos)
- Log: job dispatched/completed/failed (with tenantId, jobId, duration)
- Log: auth failures (with IP, for rate limiting/alerting)
- Metric: `agentHub.connections.count` (gauge)
- Metric: `agentHub.jobs.dispatched/completed/failed` (counters)
- Health check: `/health` endpoint extended to report `agentHub: { connectedAgents: N, pendingJobs: M }`
