# Rewire Dev/QA Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace in-process Dev/QA agent execution with job dispatch to the user's remote agent via WebSocket AgentHub, with AgentTask bridging, dev→QA chaining, and engagement phase advancement.

**Architecture:** Processors become thin dispatchers that create AgentJobs and call `agentHub.dispatchJob()`. When remote agents complete, the AgentHub bridges results back to AgentTask records, chains QA after dev, advances engagement phases, and sends notifications.

**Tech Stack:** TypeScript, Prisma 7, existing AgentHub + AgentJobQueue

**Spec:** `docs/superpowers/specs/2026-03-20-rewire-agents-design.md`

---

## File Structure

### Modified Files

```
mvp/prisma/schema.prisma                              # Add targetRepo to PRD model
mvp/src/services/agent-hub/agent-hub.service.ts        # Add AgentTask bridge, chainQAJob, new deps
mvp/src/services/queue/processors.ts                   # Thin dispatchers for DEV/QA
mvp/src/lib/di-container.ts                            # Pass new deps to AgentHub
```

### Test Files

```
mvp/src/services/agent-hub/__tests__/agent-hub.service.test.ts  # Add bridge + chaining tests
mvp/src/services/queue/__tests__/processors-dispatch.test.ts    # New: processor dispatch tests
```

---

## Task 1: Add targetRepo to PRD Model

**Files:**
- Modify: `mvp/prisma/schema.prisma`

- [ ] **Step 1: Add targetRepo field to PRD model**

Find the PRD model in the schema and add:
```prisma
targetRepo  String?   // Repo slug like "acme/backend" for agent job routing
```

This is additive — existing PRDs get null, which falls back to `'default'` slug.

- [ ] **Step 2: Generate client and push schema**

Run: `cd mvp && npx prisma generate && npx prisma db push --accept-data-loss`

- [ ] **Step 3: Commit**

```bash
git add mvp/prisma/
git commit -m "feat: add targetRepo field to PRD model for agent job routing"
```

---

## Task 2: Extend AgentHub with Task Bridge + QA Chaining

**Files:**
- Modify: `mvp/src/services/agent-hub/agent-hub.service.ts`
- Modify: `mvp/src/services/agent-hub/__tests__/agent-hub.service.test.ts`

- [ ] **Step 1: Write failing tests for the bridge**

Add to the existing test file. Key test cases:

- job_result with taskId in payload → AgentTask updated to completed
- job_result failed with taskId → AgentTask updated to failed with error
- job_result with no taskId → no crash, just marks AgentJob complete
- dev agent completion → chainQAJob dispatches a review_pr job
- dev agent failure → QA NOT chained
- qa agent completion → no further chaining

- [ ] **Step 2: Run tests, verify fail**

Run: `cd mvp && npx vitest run src/services/agent-hub/__tests__/agent-hub.service.test.ts`

- [ ] **Step 3: Add new constructor dependencies to AgentHub**

The constructor gains optional deps:
```typescript
constructor(
  private prisma: any,
  private sseService: any,
  private jobQueue: AgentJobQueue,
  private outcomeObserver?: any,       // NEW
  private engagementService?: any,     // NEW
  private commsRouter?: any,           // NEW
)
```

- [ ] **Step 4: Add bridge logic to job_result handler**

In the `handleMessage` method, inside the `case 'job_result':` block, after marking the job complete/failed:

```typescript
// Bridge to AgentTask
const agentJob = await this.prisma.agentJob.findUnique({ where: { id: msg.jobId } });
const taskId = (agentJob?.payload as any)?.taskId;
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

  // Outcome recording
  if (this.outcomeObserver) {
    await this.outcomeObserver.recordFromTask(taskId);
  }

  // Engagement phase advancement + QA chaining
  const task = await this.prisma.agentTask.findUnique({ where: { id: taskId } });
  if (task && msg.status === 'done') {
    if (task.agentType === 'dev_agent' && this.engagementService) {
      await this.engagementService.advancePhase(task.meetingId, 'test');
      await this.chainQAJob(agentJob);
    } else if (task.agentType === 'qa_agent' && this.engagementService) {
      await this.engagementService.advancePhase(task.meetingId, 'ship');
    }
  }

  // Notifications
  if (this.commsRouter) {
    this.commsRouter.notify(agentJob.tenantId, {
      type: msg.status === 'done' ? 'agent.completed' : 'agent.failed',
      taskId,
      data: msg.data,
    }).catch(() => {});
  }
}
```

- [ ] **Step 5: Add chainQAJob method**

```typescript
private async chainQAJob(devJob: any): Promise<void> {
  const payload = devJob.payload as any;
  if (!payload?.branch) return;

  try {
    await this.dispatchJob(devJob.tenantId, devJob.targetRepo, {
      tenantId: devJob.tenantId,
      action: 'review_pr',
      targetRepo: devJob.targetRepo,
      payload: {
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
```

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Commit**

```bash
git add mvp/src/services/agent-hub/
git commit -m "feat: add AgentTask bridge, dev-to-QA chaining, and engagement advancement to AgentHub"
```

---

## Task 3: Rewire Processors to Dispatch

**Files:**
- Modify: `mvp/src/services/queue/processors.ts`
- Modify: `mvp/src/lib/di-container.ts`

- [ ] **Step 1: Read existing DEV_AGENT_PROCESS and QA_AGENT_PROCESS handlers**

Read `mvp/src/services/queue/processors.ts`. Find the DEV_AGENT_PROCESS and QA_AGENT_PROCESS cases. Understand what they do today: create AgentTask, instantiate DevAgent/QAAgent, run AgentLoop, store result, advance engagement, send notifications.

- [ ] **Step 2: Update ProcessorDependencies interface**

Add `agentHub` to the interface:
```typescript
agentHub?: AgentHub;
```

- [ ] **Step 3: Replace DEV_AGENT_PROCESS handler**

Replace the in-process execution with:
```typescript
case JobType.DEV_AGENT_PROCESS: {
  const { tenantId, prdId, engagementId } = job.data;

  // Create AgentTask (same as before)
  const task = await deps.prisma.agentTask.create({
    data: {
      tenantId,
      agentType: 'dev_agent',
      status: 'processing',
      input: job.data,
    },
  });

  // Read PRD for payload
  const prd = await deps.prisma.prd.findUnique({ where: { id: prdId } });
  if (!prd) {
    await deps.prisma.agentTask.update({
      where: { id: task.id },
      data: { status: 'failed', error: 'PRD not found' },
    });
    return;
  }

  // Serialize PRD to markdown
  const prdContent = [
    `# ${prd.title}`,
    prd.summary ? `\n## Summary\n${prd.summary}` : '',
    prd.requirements ? `\n## Requirements\n${JSON.stringify(prd.requirements, null, 2)}` : '',
    prd.acceptanceCriteria ? `\n## Acceptance Criteria\n${prd.acceptanceCriteria}` : '',
  ].filter(Boolean).join('\n');

  const targetRepo = prd.targetRepo || 'default';
  const branch = `feat/wf0-${prd.id.slice(-8)}`;

  // Dispatch to remote agent
  if (!deps.agentHub) {
    await deps.prisma.agentTask.update({
      where: { id: task.id },
      data: { status: 'failed', error: 'No agent hub available' },
    });
    return;
  }

  try {
    await deps.agentHub.dispatchJob(tenantId, targetRepo, {
      tenantId,
      action: 'implement_prd',
      targetRepo,
      payload: {
        prdContent,
        branch,
        title: prd.title,
        prdId: prd.id,
        taskId: task.id,
        engagementId,
      },
    });
    log.info('Dev agent job dispatched to remote agent', { taskId: task.id, prdId });
  } catch (err) {
    await deps.prisma.agentTask.update({
      where: { id: task.id },
      data: { status: 'failed', error: `Dispatch failed: ${(err as Error).message}` },
    });
  }
  break;
}
```

- [ ] **Step 4: Replace QA_AGENT_PROCESS handler**

Same pattern — create AgentTask, read the PR/PRD data, dispatch via agentHub with action `'review_pr'`. Note: QA is now also triggered by the chainQAJob in AgentHub, so this processor path may be less used, but should still work for manual QA triggers.

- [ ] **Step 5: Update DI container to pass agentHub to processors**

In `mvp/src/lib/di-container.ts`, the `agentHub` is already created. Pass it to `createProcessors()`:

```typescript
// In the processors dependencies object, add:
agentHub,
```

Also pass the new optional deps to AgentHub constructor:
```typescript
const agentHub = new AgentHub(rlsPrisma, sseService, agentJobQueue, outcomeObserver, engagementService, commsRouter);
```

- [ ] **Step 6: Run full test suite**

Run: `cd mvp && npx tsc --noEmit && npx vitest run`
Expected: Zero TS errors, all tests pass. Some existing processor tests may need updating if they mock DEV/QA handlers.

- [ ] **Step 7: Commit**

```bash
git add mvp/src/services/queue/processors.ts mvp/src/lib/di-container.ts
git commit -m "feat: rewire DEV/QA processors to dispatch via AgentHub instead of running locally"
```

---

## Task 4: Integration Test — Full Dispatch Chain

**Files:**
- Create: `mvp/src/__tests__/integration/agent-dispatch.test.ts`

- [ ] **Step 1: Write integration test**

Test the full flow:
1. Create a PRD in DB with targetRepo
2. Queue a DEV_AGENT_PROCESS job
3. Verify AgentJob created with 'implement_prd' action
4. Simulate agent completing the job (call hub's handleMessage with job_result)
5. Verify AgentTask updated to 'completed'
6. Verify QA job auto-dispatched (chainQAJob)
7. Simulate QA completion
8. Verify engagement advanced to 'ship'

Also test failure path:
- Dev job fails → AgentTask 'failed', QA NOT triggered

- [ ] **Step 2: Run tests**

Run: `cd mvp && npx vitest run src/__tests__/integration/agent-dispatch.test.ts`

- [ ] **Step 3: Run full suite**

Run: `cd mvp && npx vitest run`

- [ ] **Step 4: Commit**

```bash
git add mvp/src/__tests__/integration/agent-dispatch.test.ts
git commit -m "test: add integration test for full dev→QA agent dispatch chain"
```
