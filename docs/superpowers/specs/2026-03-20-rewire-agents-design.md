# Rewire Dev/QA Agents to Dispatch via WebSocket

**Date:** 2026-03-20
**Status:** Approved
**Sub-project:** 3 of 4 (Agent Architecture Rebuild)

## Overview

Replace in-process DevAgent/QAAgent execution with job dispatch to the user's remote agent via the WebSocket AgentHub. BA Agent, MeetingBrain, and Supervisor stay server-side.

## What Changes

| Agent | Before | After |
|-------|--------|-------|
| BA Agent | Runs locally (Gemini Flash) | **No change** — stays server-side |
| Dev Agent | Runs locally (Claude Sonnet via API) | **Dispatches to remote agent** via AgentHub |
| QA Agent | Runs locally (Claude Sonnet via API) | **Dispatches to remote agent** via AgentHub |
| MeetingBrain | Runs locally | **No change** |
| Supervisor | Runs locally | **No change** |

## Processor Change

### Before (DEV_AGENT_PROCESS in processors.ts)
```
Queue job arrives
  → Instantiate DevAgent with ModelClient
  → devAgent.implementPrd(tenantId, prdId, ...)
  → AgentLoop runs in-process (calls Claude API)
  → Store result in AgentTask
```

### After
```
Queue job arrives
  → Read PRD from DB
  → agentHub.dispatchJob(tenantId, targetRepo, {
      action: 'implement_prd',
      payload: { prdContent, branch, title, taskId }
    })
  → Job sent to remote agent (or queued if offline)
  → Processor returns immediately (async completion)
```

Same pattern for QA_AGENT_PROCESS.

## AgentJob → AgentTask Bridge

When the remote agent completes, results flow back to the original AgentTask:

```
Remote agent sends job_result (done/failed)
  ↓
AgentHub marks AgentJob complete/failed
  ↓
AgentHub reads taskId from job payload
  ↓
Updates AgentTask:
  - status: 'completed' or 'failed'
  - output: job result data (PR URL, files changed, etc.)
  - completedAt: now
  ↓
OutcomeObserver.recordFromTask(taskId)
  ↓
SSE publishes 'agent.status_changed' to tenant
  ↓
Frontend updates in real-time
```

This bridge logic is added to `AgentHub`'s job_result handler. Concrete implementation:

```typescript
// In AgentHub, after markComplete/markFailed:
const agentJob = await this.prisma.agentJob.findUnique({ where: { id: jobId } });
const taskId = (agentJob?.payload as any)?.taskId;
if (taskId) {
  // Update the original AgentTask
  await this.prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status: msg.status === 'done' ? 'completed' : 'failed',
      output: msg.data,
      completedAt: new Date(),
      error: msg.status === 'failed' ? (msg.data?.error as string) : null,
    },
  });

  // Record outcome for learning loop
  if (this.outcomeObserver) {
    await this.outcomeObserver.recordFromTask(taskId);
  }

  // Advance engagement phase
  if (this.engagementService) {
    const task = await this.prisma.agentTask.findUnique({ where: { id: taskId } });
    if (task && msg.status === 'done') {
      if (task.agentType === 'dev_agent') {
        await this.engagementService.advancePhase(task.meetingId, 'test');
        // Chain: trigger QA after dev completes
        await this.chainQAJob(agentJob);
      } else if (task.agentType === 'qa_agent') {
        await this.engagementService.advancePhase(task.meetingId, 'ship');
      }
    }
  }

  // Send notifications (Google Chat, etc.)
  if (this.commsRouter) {
    await this.commsRouter.notify(agentJob.tenantId, {
      type: msg.status === 'done' ? 'agent.completed' : 'agent.failed',
      taskId,
      data: msg.data,
    });
  }
}
```

**Dev → QA chaining:** When a dev agent job completes successfully, the bridge automatically dispatches a QA job targeting the same repo and branch. This replaces the chaining logic currently in `processors.ts`:

```typescript
private async chainQAJob(devJob: AgentJob): Promise<void> {
  const payload = devJob.payload as any;
  await this.dispatchJob(devJob.tenantId, devJob.targetRepo, {
    tenantId: devJob.tenantId,
    action: 'review_pr',
    targetRepo: devJob.targetRepo,
    payload: {
      branch: payload.branch,
      prdContent: payload.prdContent,
      prUrl: payload.result?.prUrl,
      taskId: null, // QA creates its own AgentTask
    },
  });
}
```

**New AgentHub constructor dependencies:** AgentHub gains `outcomeObserver`, `engagementService`, and `commsRouter` as optional dependencies (passed from DI container). These are already available as services.

## PRD Content Serialization

The `prdContent` in the payload is the PRD's structured fields formatted as markdown:

```typescript
const prdContent = [
  `# ${prd.title}`,
  prd.summary ? `\n## Summary\n${prd.summary}` : '',
  prd.requirements ? `\n## Requirements\n${JSON.stringify(prd.requirements, null, 2)}` : '',
  prd.acceptanceCriteria ? `\n## Acceptance Criteria\n${prd.acceptanceCriteria}` : '',
].filter(Boolean).join('\n');
```

This keeps the payload readable for the Claude CLI and well under the 5 MB WebSocket limit.

## Schema Change

Add optional `targetRepo` to PRD model so we know which repo a PRD targets:

```prisma
model PRD {
  // ... existing fields ...
  targetRepo  String?   // Repo slug like "acme/backend" — used for agent job routing
}
```

If `targetRepo` is null, the system uses `'default'` as the repo slug (matches the first connected agent).

## Files Changed

| File | Change |
|---|---|
| `mvp/src/services/queue/processors.ts` | DEV_AGENT_PROCESS and QA_AGENT_PROCESS become thin dispatchers to AgentHub. Remove in-process DevAgent/QAAgent instantiation. Add `agentHub` to ProcessorDependencies interface. |
| `mvp/src/services/agent-hub/agent-hub.service.ts` | Add AgentTask bridge in job_result handler. Add `chainQAJob()`. Add `outcomeObserver`, `engagementService`, `commsRouter` as optional constructor deps. |
| `mvp/src/lib/di-container.ts` | Pass outcomeObserver, engagementService, commsRouter to AgentHub constructor. |
| `mvp/prisma/schema.prisma` | Add `targetRepo String?` to PRD model. Migration is additive — existing PRDs get null, fallback to 'default' slug. |

## Files NOT Changed

| File | Reason |
|---|---|
| `mvp/src/services/agents/dev/dev.agent.ts` | Kept as-is for potential local execution mode |
| `mvp/src/services/agents/qa/qa.agent.ts` | Same |
| `mvp/src/services/agents/ba/ba.agent.ts` | Stays server-side |
| `mvp/src/services/agents/base-consultant.ts` | Still used by BA Agent |

## No-Agent Fallback

| Scenario | Behavior |
|---|---|
| Agent connected with matching repo | Job dispatched immediately |
| Agent connected but wrong repo | Job queued as pending |
| No agent connected | Job queued as pending |
| Pending for 24h | Job auto-expired to failed, user notified |

The user sees "Waiting for agent..." status in the UI (via SSE). The getting-started/onboarding flow should guide them to set up an agent.

## Error Handling in Processor

If `agentHub.dispatchJob()` throws (Redis down, Prisma fails), the processor catches and marks the AgentTask as failed immediately — does not rely on BullMQ retry blindly.

```typescript
try {
  await agentHub.dispatchJob(tenantId, targetRepo, jobData);
} catch (err) {
  await prisma.agentTask.update({
    where: { id: taskId },
    data: { status: 'failed', error: `Dispatch failed: ${err.message}` },
  });
}
```

## Testing Strategy

### Unit Tests
- Processor creates AgentJob and calls dispatchJob (mock AgentHub)
- Processor handles dispatchJob failure gracefully (marks task failed)
- AgentHub bridges job_result to AgentTask update (with taskId in payload)
- AgentHub handles missing taskId in payload gracefully (no crash)
- Dev completion triggers QA chain dispatch
- Dev failure does NOT trigger QA chain
- Engagement phase advancement on dev/qa completion
- PRD targetRepo field works in queries (null defaults to 'default')

### Integration Tests
- Full chain: PRD approved → dev dispatched → dev completed → QA auto-dispatched → QA completed → engagement at 'ship' phase
- Edge case: dev agent fails → QA NOT triggered, engagement stays at current phase
- Edge case: no agent connected → job queued, AgentTask stays 'processing'
