/**
 * =============================================================================
 * SUPERVISOR AGENT TOOLS — Edge Case & Error Handling Tests
 * =============================================================================
 *
 * Tests the 5 MCP tools exposed to the Supervisor Agent:
 *   1. create_engagement
 *   2. advance_engagement
 *   3. list_engagements
 *   4. pause_engagement
 *   5. dispatch_agent
 *
 * Covers:
 *   - Happy path: success:true with correct data
 *   - Error paths: success:false with error messages
 *   - dispatch_agent routing per agent type (ba, dev, qa, memory_optimizer)
 *   - dispatch_agent fallback for unknown agent types -> NOTIFICATION queue
 *   - context.tenantId propagation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupervisorTools } from '../../services/agents/supervisor/tools.js';
import { JobType } from '../../services/queue/queue.service.js';
import type { AgentContext } from '../../services/agent-runtime/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEngagementService() {
  return {
    create: vi.fn(),
    advancePhase: vi.fn(),
    listByTenant: vi.fn(),
    pause: vi.fn(),
  };
}

function createMockQueueService() {
  return {
    addJob: vi.fn().mockResolvedValue('job-abc-123'),
  };
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    tenantId: 'tenant-1',
    engagementId: 'eng-001',
    agentType: 'supervisor',
    traceId: 'trace-001',
    memory: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Supervisor Agent Tools', () => {
  let engagementService: ReturnType<typeof createMockEngagementService>;
  let queueService: ReturnType<typeof createMockQueueService>;
  let tools: ReturnType<typeof createSupervisorTools>;
  let ctx: AgentContext;

  beforeEach(() => {
    engagementService = createMockEngagementService();
    queueService = createMockQueueService();
    tools = createSupervisorTools({
      engagementService: engagementService as any,
      queueService: queueService as any,
    });
    ctx = makeContext();
  });

  function findTool(name: string) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    return tool;
  }

  // =========================================================================
  // create_engagement
  // =========================================================================
  describe('create_engagement', () => {
    it('returns success:true with engagement data on happy path', async () => {
      engagementService.create.mockResolvedValue({
        id: 'eng-new',
        phase: 'listen',
        status: 'active',
      });

      const result = await findTool('create_engagement').execute(
        { title: 'New Feature', meetingId: 'mtg-1' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        engagementId: 'eng-new',
        phase: 'listen',
        status: 'active',
      });
    });

    it('passes context.tenantId to engagementService.create', async () => {
      engagementService.create.mockResolvedValue({
        id: 'eng-1',
        phase: 'listen',
        status: 'active',
      });

      await findTool('create_engagement').execute(
        { title: 'T', meetingId: 'm' },
        makeContext({ tenantId: 'custom-tenant' }),
      );

      expect(engagementService.create).toHaveBeenCalledWith(
        'custom-tenant',
        expect.objectContaining({ title: 'T' }),
      );
    });

    it('returns success:false when service throws', async () => {
      engagementService.create.mockRejectedValue(
        new Error('Unique constraint violation'),
      );

      const result = await findTool('create_engagement').execute(
        { title: 'Dup', meetingId: 'm' },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unique constraint violation');
    });

    it('handles non-Error thrown values gracefully', async () => {
      engagementService.create.mockRejectedValue('string error');

      const result = await findTool('create_engagement').execute(
        { title: 'T', meetingId: 'm' },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });
  });

  // =========================================================================
  // advance_engagement
  // =========================================================================
  describe('advance_engagement', () => {
    it('returns success:true with updated phase on happy path', async () => {
      engagementService.advancePhase.mockResolvedValue({
        id: 'eng-001',
        phase: 'understand',
        status: 'active',
      });

      const result = await findTool('advance_engagement').execute(
        { engagementId: 'eng-001', confidence: 0.9 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        engagementId: 'eng-001',
        phase: 'understand',
        status: 'active',
      });
    });

    it('returns success:false on invalid transition', async () => {
      engagementService.advancePhase.mockRejectedValue(
        new Error("Invalid transition from 'listen' to 'ship'"),
      );

      const result = await findTool('advance_engagement').execute(
        { engagementId: 'eng-001', targetPhase: 'ship' },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
    });

    it('returns success:true with paused status on low confidence', async () => {
      engagementService.advancePhase.mockResolvedValue({
        id: 'eng-001',
        phase: 'listen',
        status: 'paused',
      });

      const result = await findTool('advance_engagement').execute(
        { engagementId: 'eng-001', confidence: 0.2 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ status: 'paused' }),
      );
    });

    it('passes tenantId from context', async () => {
      engagementService.advancePhase.mockResolvedValue({
        id: 'e',
        phase: 'understand',
        status: 'active',
      });

      await findTool('advance_engagement').execute(
        { engagementId: 'e' },
        makeContext({ tenantId: 'other-tenant' }),
      );

      expect(engagementService.advancePhase).toHaveBeenCalledWith(
        'other-tenant',
        'e',
        expect.any(Object),
      );
    });
  });

  // =========================================================================
  // list_engagements
  // =========================================================================
  describe('list_engagements', () => {
    it('returns success:true with engagement list', async () => {
      engagementService.listByTenant.mockResolvedValue([
        {
          id: 'e1',
          title: 'E1',
          phase: 'listen',
          status: 'active',
          confidence: 0.8,
          agentType: 'meeting_brain',
        },
      ]);

      const result = await findTool('list_engagements').execute({}, ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).count).toBe(1);
      expect((result.data as any).engagements[0]).toEqual({
        id: 'e1',
        title: 'E1',
        phase: 'listen',
        status: 'active',
        confidence: 0.8,
        agentType: 'meeting_brain',
      });
    });

    it('filters by status when provided', async () => {
      engagementService.listByTenant.mockResolvedValue([]);

      await findTool('list_engagements').execute({ status: 'paused' }, ctx);

      expect(engagementService.listByTenant).toHaveBeenCalledWith(
        'tenant-1',
        'paused',
      );
    });

    it('returns empty list gracefully', async () => {
      engagementService.listByTenant.mockResolvedValue([]);

      const result = await findTool('list_engagements').execute({}, ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).count).toBe(0);
      expect((result.data as any).engagements).toEqual([]);
    });

    it('returns success:false on service error', async () => {
      engagementService.listByTenant.mockRejectedValue(
        new Error('DB connection lost'),
      );

      const result = await findTool('list_engagements').execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB connection lost');
    });
  });

  // =========================================================================
  // pause_engagement
  // =========================================================================
  describe('pause_engagement', () => {
    it('returns success:true with paused status', async () => {
      engagementService.pause.mockResolvedValue({
        id: 'eng-001',
        status: 'paused',
      });

      const result = await findTool('pause_engagement').execute(
        { engagementId: 'eng-001', reason: 'Needs review' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        engagementId: 'eng-001',
        status: 'paused',
      });
    });

    it('returns success:false when engagement not found', async () => {
      engagementService.pause.mockRejectedValue(
        new Error('Engagement not found'),
      );

      const result = await findTool('pause_engagement').execute(
        { engagementId: 'nonexistent' },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Engagement not found');
    });

    it('passes context.tenantId to pause', async () => {
      engagementService.pause.mockResolvedValue({ id: 'e', status: 'paused' });

      await findTool('pause_engagement').execute(
        { engagementId: 'e' },
        makeContext({ tenantId: 'my-tenant' }),
      );

      expect(engagementService.pause).toHaveBeenCalledWith(
        'my-tenant',
        'e',
        undefined,
      );
    });
  });

  // =========================================================================
  // dispatch_agent
  // =========================================================================
  describe('dispatch_agent', () => {
    it('dispatches ba_agent to BA_AGENT_PROCESS queue', async () => {
      const result = await findTool('dispatch_agent').execute(
        {
          engagementId: 'eng-001',
          agentType: 'ba_agent',
          task: 'Generate PRD',
          meetingId: 'mtg-1',
          transcript: 'some text',
          taskId: 'task-1',
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(queueService.addJob).toHaveBeenCalledWith(
        JobType.BA_AGENT_PROCESS,
        expect.objectContaining({
          taskId: 'task-1',
          tenantId: 'tenant-1',
          meetingId: 'mtg-1',
          transcript: 'some text',
        }),
      );
      expect((result.data as any).queue).toBe(JobType.BA_AGENT_PROCESS);
    });

    it('dispatches dev_agent to DEV_AGENT_PROCESS queue', async () => {
      const result = await findTool('dispatch_agent').execute(
        {
          engagementId: 'eng-001',
          agentType: 'dev_agent',
          task: 'Build feature',
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(queueService.addJob).toHaveBeenCalledWith(
        JobType.DEV_AGENT_PROCESS,
        expect.objectContaining({
          engagementId: 'eng-001',
          tenantId: 'tenant-1',
        }),
      );
      expect((result.data as any).queue).toBe(JobType.DEV_AGENT_PROCESS);
    });

    it('dispatches qa_agent to QA_AGENT_PROCESS queue', async () => {
      const result = await findTool('dispatch_agent').execute(
        {
          engagementId: 'eng-001',
          agentType: 'qa_agent',
          task: 'Review PR',
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(queueService.addJob).toHaveBeenCalledWith(
        JobType.QA_AGENT_PROCESS,
        expect.objectContaining({
          engagementId: 'eng-001',
          tenantId: 'tenant-1',
        }),
      );
      expect((result.data as any).queue).toBe(JobType.QA_AGENT_PROCESS);
    });

    it('dispatches memory_optimizer to MEMORY_OPTIMIZER queue', async () => {
      const result = await findTool('dispatch_agent').execute(
        {
          engagementId: 'eng-001',
          agentType: 'memory_optimizer',
          task: 'Consolidate memories',
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(queueService.addJob).toHaveBeenCalledWith(
        JobType.MEMORY_OPTIMIZER,
        expect.objectContaining({
          tenantId: 'tenant-1',
          trigger: 'engagement_complete',
          engagementId: 'eng-001',
        }),
      );
      expect((result.data as any).queue).toBe(JobType.MEMORY_OPTIMIZER);
    });

    it('falls back to NOTIFICATION queue for unknown agent types', async () => {
      const result = await findTool('dispatch_agent').execute(
        {
          engagementId: 'eng-001',
          agentType: 'unknown_agent_v99',
          task: 'Do something',
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(queueService.addJob).toHaveBeenCalledWith(
        JobType.NOTIFICATION,
        expect.objectContaining({
          type: 'gchat',
          tenantId: 'tenant-1',
          payload: expect.objectContaining({
            type: 'info',
            title: 'Agent Dispatched: unknown_agent_v99',
          }),
        }),
      );
      expect((result.data as any).queue).toBe(JobType.NOTIFICATION);
    });

    it('generates default taskId when not provided', async () => {
      await findTool('dispatch_agent').execute(
        {
          engagementId: 'eng-001',
          agentType: 'dev_agent',
          task: 'Build',
        },
        ctx,
      );

      expect(queueService.addJob).toHaveBeenCalledWith(
        JobType.DEV_AGENT_PROCESS,
        expect.objectContaining({
          taskId: 'task-eng-001',
        }),
      );
    });

    it('returns success:false when queueService.addJob throws', async () => {
      queueService.addJob.mockRejectedValue(new Error('Queue unavailable'));

      const result = await findTool('dispatch_agent').execute(
        {
          engagementId: 'eng-001',
          agentType: 'ba_agent',
          task: 'Test',
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Queue unavailable');
    });

    it('returns the jobId from queueService in response data', async () => {
      queueService.addJob.mockResolvedValue('custom-job-id-42');

      const result = await findTool('dispatch_agent').execute(
        {
          engagementId: 'eng-001',
          agentType: 'dev_agent',
          task: 'Build',
        },
        ctx,
      );

      expect((result.data as any).jobId).toBe('custom-job-id-42');
    });

    it('uses context.tenantId correctly in all agent dispatch paths', async () => {
      const customCtx = makeContext({ tenantId: 'special-tenant-xyz' });

      // ba_agent path
      await findTool('dispatch_agent').execute(
        { engagementId: 'e', agentType: 'ba_agent', task: 't' },
        customCtx,
      );
      expect(queueService.addJob).toHaveBeenCalledWith(
        JobType.BA_AGENT_PROCESS,
        expect.objectContaining({ tenantId: 'special-tenant-xyz' }),
      );

      queueService.addJob.mockClear();

      // dev_agent path
      await findTool('dispatch_agent').execute(
        { engagementId: 'e', agentType: 'dev_agent', task: 't' },
        customCtx,
      );
      expect(queueService.addJob).toHaveBeenCalledWith(
        JobType.DEV_AGENT_PROCESS,
        expect.objectContaining({ tenantId: 'special-tenant-xyz' }),
      );
    });
  });

  // =========================================================================
  // General
  // =========================================================================
  describe('tool metadata', () => {
    it('creates exactly 5 tools', () => {
      expect(tools).toHaveLength(5);
    });

    it('has correct tool names', () => {
      const names = tools.map((t) => t.name);
      expect(names).toEqual([
        'create_engagement',
        'advance_engagement',
        'list_engagements',
        'pause_engagement',
        'dispatch_agent',
      ]);
    });

    it('each tool has description and inputSchema', () => {
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });
});
