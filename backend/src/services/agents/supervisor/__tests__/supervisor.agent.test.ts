// mvp/src/services/agents/supervisor/__tests__/supervisor.agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupervisorAgent } from '../supervisor.agent.js';
import type { ModelClient } from '../../../agent-runtime/types.js';
import type { EngagementService } from '../../../engagement/engagement.service.js';
import type { ModelRegistryService } from '../../../model-registry/model-registry.service.js';
import type { QueueService } from '../../../queue/queue.service.js';
import { JobType } from '../../../queue/queue.service.js';

describe('SupervisorAgent', () => {
  let mockModelClient: ModelClient;
  let mockEngagementService: any;
  let mockModelRegistry: any;
  let mockQueueService: any;
  let agent: SupervisorAgent;

  beforeEach(() => {
    mockModelClient = { chat: vi.fn() };
    mockEngagementService = {
      create: vi.fn(),
      advancePhase: vi.fn(),
      listByTenant: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      get: vi.fn(),
    };
    mockModelRegistry = {
      resolveModel: vi.fn().mockResolvedValue({
        modelId: 'claude-sonnet-4',
        provider: 'anthropic',
        confidenceThreshold: 0.85,
        maxSteps: 10,
      }),
    };
    mockQueueService = {
      addJob: vi.fn().mockResolvedValue('job-123'),
    };
    agent = new SupervisorAgent(mockModelClient, mockEngagementService, mockModelRegistry, mockQueueService);
  });

  // ---- Identity ----

  it('should have agentType "supervisor"', () => {
    expect(agent.agentType).toBe('supervisor');
  });

  it('should have exactly 5 tools', () => {
    expect(agent.tools).toHaveLength(5);
  });

  it('should expose the correct tool names', () => {
    const names = agent.tools.map((t: any) => t.name);
    expect(names).toEqual([
      'create_engagement',
      'advance_engagement',
      'list_engagements',
      'pause_engagement',
      'dispatch_agent',
    ]);
  });

  // ---- handleMeetingCompleted ----

  it('should create engagement when processing a new meeting', async () => {
    mockEngagementService.create.mockResolvedValue({
      id: 'eng-1',
      phase: 'listen',
      status: 'active',
    });

    (mockModelClient.chat as any)
      // Step 1: model decides to call create_engagement
      .mockResolvedValueOnce({
        content: 'I will create an engagement for this meeting.',
        toolCalls: [
          {
            name: 'create_engagement',
            input: { title: 'Sprint Planning', meetingId: 'mtg-42' },
          },
        ],
        tokenUsage: { input: 150, output: 60 },
        stopReason: 'tool_use',
      })
      // Step 2: model decides to dispatch meeting_brain
      .mockResolvedValueOnce({
        content: 'Now dispatching meeting_brain agent.',
        toolCalls: [
          {
            name: 'dispatch_agent',
            input: {
              engagementId: 'eng-1',
              agentType: 'meeting_brain',
              task: 'Process meeting transcript for Sprint Planning',
            },
          },
        ],
        tokenUsage: { input: 200, output: 70 },
        stopReason: 'tool_use',
      })
      // Step 3: model summarises and ends
      .mockResolvedValueOnce({
        content:
          'Engagement eng-1 created and meeting_brain dispatched. Confidence: 0.95',
        toolCalls: [],
        tokenUsage: { input: 250, output: 80 },
        stopReason: 'end_turn',
      });

    const result = await agent.handleMeetingCompleted(
      'tenant-1',
      'mtg-42',
      'Sprint Planning',
    );

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(3);
    expect(result.steps[0].toolName).toBe('create_engagement');
    expect(result.steps[1].toolName).toBe('dispatch_agent');
    expect(result.confidence).toBe(0.95);

    // Verify engagement was created with the right params
    expect(mockEngagementService.create).toHaveBeenCalledWith('tenant-1', {
      title: 'Sprint Planning',
      meetingId: 'mtg-42',
      metadata: undefined,
    });
  });

  // ---- checkEngagements ----

  it('should list and advance active engagements', async () => {
    mockEngagementService.listByTenant.mockResolvedValue([
      {
        id: 'eng-1',
        title: 'Sprint Planning',
        phase: 'listen',
        status: 'active',
        confidence: 0.9,
        agentType: 'meeting_brain',
      },
    ]);

    mockEngagementService.advancePhase.mockResolvedValue({
      id: 'eng-1',
      phase: 'understand',
      status: 'active',
    });

    (mockModelClient.chat as any)
      // Step 1: model lists engagements
      .mockResolvedValueOnce({
        content: 'Let me check active engagements.',
        toolCalls: [
          { name: 'list_engagements', input: { status: 'active' } },
        ],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      // Step 2: model decides to advance eng-1
      .mockResolvedValueOnce({
        content: 'Engagement eng-1 is ready to advance from listen to understand.',
        toolCalls: [
          {
            name: 'advance_engagement',
            input: { engagementId: 'eng-1', confidence: 0.9 },
          },
        ],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'tool_use',
      })
      // Step 3: done
      .mockResolvedValueOnce({
        content:
          'Checked 1 active engagement. Advanced eng-1 to understand phase. Confidence: 0.88',
        toolCalls: [],
        tokenUsage: { input: 250, output: 70 },
        stopReason: 'end_turn',
      });

    const result = await agent.checkEngagements('tenant-1');

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(3);
    expect(result.steps[0].toolName).toBe('list_engagements');
    expect(result.steps[1].toolName).toBe('advance_engagement');

    expect(mockEngagementService.listByTenant).toHaveBeenCalledWith(
      'tenant-1',
      'active',
    );
    expect(mockEngagementService.advancePhase).toHaveBeenCalledWith('tenant-1', 'eng-1', {
      confidence: 0.9,
      targetPhase: undefined,
      output: undefined,
    });
  });

  // ---- Tool execution: create_engagement ----

  it('should handle create_engagement tool error gracefully', async () => {
    mockEngagementService.create.mockRejectedValue(
      new Error('Database connection failed'),
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Creating engagement.',
        toolCalls: [
          {
            name: 'create_engagement',
            input: { title: 'Test', meetingId: 'mtg-1' },
          },
        ],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Failed to create engagement. Confidence: 0.2',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const result = await agent.handleMeetingCompleted(
      'tenant-1',
      'mtg-1',
      'Test',
    );

    expect(result.success).toBe(true); // loop itself succeeds
    expect(result.steps[0].toolResult?.success).toBe(false);
    expect(result.steps[0].toolResult?.error).toContain(
      'Database connection failed',
    );
  });

  // ---- Tool execution: pause_engagement ----

  it('should pause engagement with reason', async () => {
    mockEngagementService.pause.mockResolvedValue({
      id: 'eng-1',
      status: 'paused',
    });

    const pauseTool = agent.tools.find((t: any) => t.name === 'pause_engagement')!;
    const result = await pauseTool.execute(
      { engagementId: 'eng-1', reason: 'Low confidence' },
      {
        tenantId: 'tenant-1',
        engagementId: '',
        agentType: 'supervisor',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).status).toBe('paused');
    expect(mockEngagementService.pause).toHaveBeenCalledWith(
      'tenant-1',
      'eng-1',
      'Low confidence',
    );
  });

  // ---- Tool execution: dispatch_agent ----

  it('should dispatch ba_agent via BA_AGENT_PROCESS queue', async () => {
    const dispatchTool = agent.tools.find((t: any) => t.name === 'dispatch_agent')!;
    const result = await dispatchTool.execute(
      {
        engagementId: 'eng-1',
        agentType: 'ba_agent',
        task: 'Analyze requirements',
        meetingId: 'mtg-42',
        transcript: 'Meeting transcript text',
        taskId: 'task-1',
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'supervisor',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).dispatched).toBe(true);
    expect((result.data as any).agentType).toBe('ba_agent');
    expect((result.data as any).jobId).toBe('job-123');
    expect((result.data as any).queue).toBe(JobType.BA_AGENT_PROCESS);
    expect(mockQueueService.addJob).toHaveBeenCalledWith(JobType.BA_AGENT_PROCESS, {
      taskId: 'task-1',
      tenantId: 'tenant-1',
      meetingId: 'mtg-42',
      transcript: 'Meeting transcript text',
    });
  });

  it('should dispatch dev_agent via DEV_AGENT_PROCESS queue', async () => {
    const dispatchTool = agent.tools.find((t: any) => t.name === 'dispatch_agent')!;
    const result = await dispatchTool.execute(
      {
        engagementId: 'eng-1',
        agentType: 'dev_agent',
        task: 'Build feature',
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'supervisor',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).dispatched).toBe(true);
    expect((result.data as any).agentType).toBe('dev_agent');
    expect((result.data as any).jobId).toBe('job-123');
    expect((result.data as any).queue).toBe(JobType.DEV_AGENT_PROCESS);
    expect(mockQueueService.addJob).toHaveBeenCalledWith(JobType.DEV_AGENT_PROCESS, expect.objectContaining({
      engagementId: 'eng-1',
      tenantId: 'tenant-1',
    }));
  });

  it('should handle dispatch_agent queue errors gracefully', async () => {
    mockQueueService.addJob.mockRejectedValue(new Error('Redis connection lost'));

    const dispatchTool = agent.tools.find((t: any) => t.name === 'dispatch_agent')!;
    const result = await dispatchTool.execute(
      {
        engagementId: 'eng-1',
        agentType: 'ba_agent',
        task: 'Analyze requirements',
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'supervisor',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Redis connection lost');
  });

  it('should use fallback values for ba_agent when optional fields are missing', async () => {
    const dispatchTool = agent.tools.find((t: any) => t.name === 'dispatch_agent')!;
    await dispatchTool.execute(
      {
        engagementId: 'eng-1',
        agentType: 'ba_agent',
        task: 'Analyze requirements',
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'supervisor',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(mockQueueService.addJob).toHaveBeenCalledWith(JobType.BA_AGENT_PROCESS, {
      taskId: 'task-eng-1',
      tenantId: 'tenant-1',
      meetingId: '',
      transcript: '',
    });
  });

  // ---- Model Registry ----

  it('should call resolveModel with correct tenantId and agentType', async () => {
    mockEngagementService.create.mockResolvedValue({
      id: 'eng-1',
      phase: 'listen',
      status: 'active',
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.handleMeetingCompleted('tenant-42', 'mtg-1', 'Test');

    expect(mockModelRegistry.resolveModel).toHaveBeenCalledWith('tenant-42', 'supervisor');
  });

  it('should use resolved model from registry', async () => {
    mockModelRegistry.resolveModel.mockResolvedValue({
      modelId: 'gpt-4o',
      provider: 'openai',
      confidenceThreshold: 0.85,
      maxSteps: 10,
    });

    mockEngagementService.create.mockResolvedValue({
      id: 'eng-1',
      phase: 'listen',
      status: 'active',
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.handleMeetingCompleted('tenant-1', 'mtg-1', 'Test');

    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
      }),
    );
  });

  it('should fall back to default model when resolveModel throws', async () => {
    mockModelRegistry.resolveModel.mockRejectedValue(new Error('No config'));

    mockEngagementService.create.mockResolvedValue({
      id: 'eng-1',
      phase: 'listen',
      status: 'active',
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    const result = await agent.handleMeetingCompleted('tenant-1', 'mtg-1', 'Test');

    expect(result.success).toBe(true);
    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4',
      }),
    );
  });

  it('should work without model registry (backward compatibility)', async () => {
    const agentWithoutRegistry = new SupervisorAgent(mockModelClient, mockEngagementService, undefined, mockQueueService);

    mockEngagementService.create.mockResolvedValue({
      id: 'eng-1',
      phase: 'listen',
      status: 'active',
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    const result = await agentWithoutRegistry.handleMeetingCompleted('tenant-1', 'mtg-1', 'Test');

    expect(result.success).toBe(true);
    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4',
      }),
    );
  });

  // ---- Token tracking ----

  it('should track total tokens across the run', async () => {
    mockEngagementService.create.mockResolvedValue({
      id: 'eng-1',
      phase: 'listen',
      status: 'active',
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Creating.',
        toolCalls: [
          {
            name: 'create_engagement',
            input: { title: 'Test', meetingId: 'mtg-1' },
          },
        ],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const result = await agent.handleMeetingCompleted(
      'tenant-1',
      'mtg-1',
      'Test',
    );

    expect(result.totalTokens.input).toBe(300);
    expect(result.totalTokens.output).toBe(110);
  });
});
