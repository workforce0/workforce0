// mvp/src/services/agents/ba/__tests__/ba.agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BAAgent } from '../ba.agent.js';
import type { ModelClient } from '../../../agent-runtime/types.js';
import type { CommunicationRouter } from '../../../communication/router.js';
import type { MemoryService } from '../../../memory/memory.service.js';
import type { ModelRegistryService } from '../../../model-registry/model-registry.service.js';

describe('BAAgent', () => {
  let mockModelClient: ModelClient;
  let mockPrisma: any;
  let mockCommsRouter: any;
  let mockMemoryService: any;
  let mockModelRegistry: any;
  let agent: BAAgent;

  beforeEach(() => {
    mockModelClient = { chat: vi.fn() };

    mockPrisma = {
      transcript: {
        findUnique: vi.fn(),
      },
      pRD: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      clarificationRequest: {
        create: vi.fn(),
      },
    };

    mockCommsRouter = {
      send: vi.fn(),
    } as unknown as CommunicationRouter;

    mockMemoryService = {
      getContext: vi.fn(),
      recall: vi.fn(),
      remember: vi.fn(),
    } as unknown as MemoryService;

    mockModelRegistry = {
      resolveModel: vi.fn().mockResolvedValue({
        modelId: 'gemini-3.1-pro',
        provider: 'google',
        confidenceThreshold: 0.85,
        maxSteps: 25,
      }),
    };

    agent = new BAAgent(
      mockModelClient,
      mockPrisma,
      mockCommsRouter,
      mockMemoryService,
      mockModelRegistry,
    );
  });

  // ---- Identity ----

  it('should have agentType "ba_agent"', () => {
    expect(agent.agentType).toBe('ba_agent');
  });

  it('should have exactly 5 tools', () => {
    expect(agent.tools).toHaveLength(5);
  });

  it('should expose the correct tool names', () => {
    const names = agent.tools.map((t: any) => t.name);
    expect(names).toEqual([
      'read_transcript',
      'recall_tenant_context',
      'create_prd',
      'ask_clarification',
      'check_existing_backlog',
    ]);
  });

  // ---- processTranscript: full flow ----

  it('should process transcript into PRD (read_transcript -> recall_context -> create_prd)', async () => {
    // Mock transcript data
    mockPrisma.transcript.findUnique.mockResolvedValue({
      id: 'tx-1',
      meetingId: 'mtg-1',
      fullText: 'Alice: We need a user auth system. Bob: Agreed, with OAuth support.',
      segments: [
        { speaker: 'Alice', text: 'We need a user auth system.', startTime: 0, endTime: 10 },
        { speaker: 'Bob', text: 'Agreed, with OAuth support.', startTime: 10, endTime: 20 },
      ],
      speakers: ['Alice', 'Bob'],
      wordCount: 14,
      duration: 20,
      meeting: {
        id: 'mtg-1',
        title: 'Auth Feature Planning',
        participants: ['Alice', 'Bob'],
        startTime: new Date('2026-03-01T10:00:00Z'),
        endTime: new Date('2026-03-01T10:30:00Z'),
        metadata: {},
      },
    });

    // Mock memory service
    mockMemoryService.getContext.mockResolvedValue([
      {
        key: 'naming_convention',
        category: 'convention',
        value: { style: 'kebab-case' },
        confidence: 0.9,
      },
    ]);

    // Mock PRD creation
    mockPrisma.pRD.create.mockResolvedValue({
      id: 'prd-1',
      title: 'User Authentication System',
      status: 'draft',
      confidence: 0.92,
    });

    // Mock backlog check (no duplicates)
    mockPrisma.pRD.findMany.mockResolvedValue([]);

    (mockModelClient.chat as any)
      // Step 1: model calls read_transcript
      .mockResolvedValueOnce({
        content: 'Let me read the meeting transcript first.',
        toolCalls: [
          { name: 'read_transcript', input: {} },
        ],
        tokenUsage: { input: 200, output: 80 },
        stopReason: 'tool_use',
      })
      // Step 2: model calls recall_tenant_context
      .mockResolvedValueOnce({
        content: 'Now let me check tenant preferences and conventions.',
        toolCalls: [
          { name: 'recall_tenant_context', input: {} },
        ],
        tokenUsage: { input: 400, output: 100 },
        stopReason: 'tool_use',
      })
      // Step 3: model calls check_existing_backlog
      .mockResolvedValueOnce({
        content: 'Let me check for existing related PRDs.',
        toolCalls: [
          { name: 'check_existing_backlog', input: { searchTerms: ['auth', 'authentication', 'OAuth'] } },
        ],
        tokenUsage: { input: 500, output: 120 },
        stopReason: 'tool_use',
      })
      // Step 4: model calls create_prd
      .mockResolvedValueOnce({
        content: 'Creating the PRD based on transcript analysis.',
        toolCalls: [
          {
            name: 'create_prd',
            input: {
              title: 'User Authentication System',
              summary: 'Implement user authentication with OAuth support.',
              objectives: ['Secure user access', 'OAuth provider integration'],
              requirements: [
                {
                  title: 'OAuth Integration',
                  description: 'Support Google and GitHub OAuth',
                  priority: 'P0',
                  acceptanceCriteria: ['Users can log in via Google', 'Users can log in via GitHub'],
                },
              ],
              acceptanceCriteria: ['All auth flows tested', 'Security audit passed'],
              outOfScope: ['SAML support'],
              assumptions: ['OAuth providers have stable APIs'],
              risks: [
                {
                  description: 'OAuth provider downtime',
                  impact: 'high',
                  mitigation: 'Implement fallback email/password auth',
                },
              ],
              confidence: 0.92,
            },
          },
        ],
        tokenUsage: { input: 700, output: 200 },
        stopReason: 'tool_use',
      })
      // Step 5: model summarises and ends
      .mockResolvedValueOnce({
        content:
          'PRD created successfully for User Authentication System. ' +
          'No duplicates found in the backlog. Applied tenant naming conventions. Confidence: 0.92',
        toolCalls: [],
        tokenUsage: { input: 800, output: 150 },
        stopReason: 'end_turn',
      });

    const result = await agent.processTranscript(
      'tenant-1',
      'mtg-1',
      'eng-1',
      'task-1',
    );

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(5);
    expect(result.steps[0].toolName).toBe('read_transcript');
    expect(result.steps[1].toolName).toBe('recall_tenant_context');
    expect(result.steps[2].toolName).toBe('check_existing_backlog');
    expect(result.steps[3].toolName).toBe('create_prd');
    expect(result.confidence).toBe(0.92);

    // Verify transcript was fetched with correct meetingId
    expect(mockPrisma.transcript.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { meetingId: 'mtg-1' },
      }),
    );

    // Verify memory was queried
    expect(mockMemoryService.getContext).toHaveBeenCalledWith('tenant-1', {
      categories: undefined,
    });

    // Verify PRD was created
    expect(mockPrisma.pRD.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: 'task-1',
          meetingId: 'mtg-1',
          tenantId: 'tenant-1',
          title: 'User Authentication System',
          status: 'draft',
        }),
      }),
    );
  });

  // ---- Tool: read_transcript ----

  it('should return error when meetingId is missing from context', async () => {
    const readTool = agent.tools.find((t: any) => t.name === 'read_transcript')!;
    const result = await readTool.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'ba_agent',
        traceId: 'tr-1',
        memory: {}, // no meetingId
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('meetingId');
  });

  it('should return error when transcript is not found', async () => {
    mockPrisma.transcript.findUnique.mockResolvedValue(null);

    const readTool = agent.tools.find((t: any) => t.name === 'read_transcript')!;
    const result = await readTool.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'ba_agent',
        traceId: 'tr-1',
        memory: { meetingId: 'mtg-missing' },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No transcript found');
  });

  // ---- Tool: recall_tenant_context ----

  it('should recall tenant memories with category filter', async () => {
    mockMemoryService.getContext.mockResolvedValue([
      { key: 'prd_template', category: 'convention', value: { format: 'standard' }, confidence: 0.8 },
    ]);

    const recallTool = agent.tools.find((t: any) => t.name === 'recall_tenant_context')!;
    const result = await recallTool.execute(
      { categories: ['convention'] },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'ba_agent',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).count).toBe(1);
    expect((result.data as any).memories[0].key).toBe('prd_template');
    expect(mockMemoryService.getContext).toHaveBeenCalledWith('tenant-1', {
      categories: ['convention'],
    });
  });

  // ---- Tool: create_prd ----

  it('should return error when taskId is missing from context', async () => {
    const createTool = agent.tools.find((t: any) => t.name === 'create_prd')!;
    const result = await createTool.execute(
      { title: 'Test', summary: 'Test', requirements: [] },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'ba_agent',
        traceId: 'tr-1',
        memory: { meetingId: 'mtg-1' }, // no taskId
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('taskId');
  });

  // ---- Tool: ask_clarification ----

  it('should create clarification request and send via comms router', async () => {
    mockPrisma.clarificationRequest.create.mockResolvedValue({
      id: 'clar-1',
      question: 'What OAuth providers should we support?',
      routeTo: 'cto',
      status: 'pending',
    });

    (mockCommsRouter.send as any).mockResolvedValue({
      success: true,
      messageLogId: 'msg-1',
      channel: 'slack',
    });

    const askTool = agent.tools.find((t: any) => t.name === 'ask_clarification')!;
    const result = await askTool.execute(
      {
        question: 'What OAuth providers should we support?',
        questionContext: 'The transcript mentions OAuth but does not specify providers.',
        routeTo: 'cto',
        urgency: 'medium',
        options: ['Google only', 'Google + GitHub', 'All major providers'],
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'ba_agent',
        traceId: 'tr-1',
        memory: { meetingId: 'mtg-1', taskId: 'task-1' },
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).clarificationId).toBe('clar-1');
    expect((result.data as any).routedTo).toBe('cto');
    expect((result.data as any).messageSent).toBe(true);
    expect((result.data as any).channel).toBe('slack');

    // Verify clarification record was created
    expect(mockPrisma.clarificationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: 'task-1',
          question: 'What OAuth providers should we support?',
          routeTo: 'cto',
          urgency: 'medium',
        }),
      }),
    );

    // Verify comms router was called with correct role
    expect(mockCommsRouter.send).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        recipientRole: 'cto',
        messageType: 'clarification',
      }),
    );
  });

  // ---- Tool: check_existing_backlog ----

  it('should find related PRDs in the backlog', async () => {
    mockPrisma.pRD.findMany.mockResolvedValue([
      {
        id: 'prd-existing',
        title: 'Authentication MVP',
        summary: 'Basic email/password authentication for the platform.',
        status: 'approved',
        confidence: 0.88,
        version: 1,
        createdAt: new Date('2026-02-15'),
      },
    ]);

    const backlogTool = agent.tools.find((t: any) => t.name === 'check_existing_backlog')!;
    const result = await backlogTool.execute(
      { searchTerms: ['auth', 'authentication'] },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'ba_agent',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).count).toBe(1);
    expect((result.data as any).prds[0].title).toBe('Authentication MVP');

    // Verify search was scoped to tenant
    expect(mockPrisma.pRD.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
        }),
      }),
    );
  });

  // ---- Model Registry ----

  it('should call resolveModel with correct tenantId and agentType', async () => {
    mockPrisma.transcript.findUnique.mockResolvedValue({
      id: 'tx-1',
      meetingId: 'mtg-1',
      fullText: 'Test.',
      segments: [],
      speakers: ['Alice'],
      wordCount: 1,
      duration: 5,
      meeting: {
        id: 'mtg-1',
        title: 'Test',
        participants: ['Alice'],
        startTime: new Date(),
        endTime: new Date(),
        metadata: {},
      },
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.processTranscript('tenant-42', 'mtg-1', 'eng-1', 'task-1');

    expect(mockModelRegistry.resolveModel).toHaveBeenCalledWith('tenant-42', 'ba_agent');
  });

  it('should use resolved model from registry', async () => {
    mockModelRegistry.resolveModel.mockResolvedValue({
      modelId: 'gpt-4o',
      provider: 'openai',
      confidenceThreshold: 0.85,
      maxSteps: 25,
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.processTranscript('tenant-1', 'mtg-1', 'eng-1', 'task-1');

    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
      }),
    );
  });

  it('should fall back to default model when resolveModel throws', async () => {
    mockModelRegistry.resolveModel.mockRejectedValue(new Error('No config'));

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    const result = await agent.processTranscript('tenant-1', 'mtg-1', 'eng-1', 'task-1');

    expect(result.success).toBe(true);
    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-pro',
      }),
    );
  });

  it('should work without model registry (backward compatibility)', async () => {
    const agentWithoutRegistry = new BAAgent(
      mockModelClient,
      mockPrisma,
      mockCommsRouter,
      mockMemoryService,
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    const result = await agentWithoutRegistry.processTranscript('tenant-1', 'mtg-1', 'eng-1', 'task-1');

    expect(result.success).toBe(true);
    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-pro',
      }),
    );
  });

  // ---- Token tracking ----

  it('should track total tokens across the run', async () => {
    mockPrisma.transcript.findUnique.mockResolvedValue({
      id: 'tx-1',
      meetingId: 'mtg-1',
      fullText: 'Discussion content.',
      segments: [],
      speakers: ['Alice'],
      wordCount: 2,
      duration: 10,
      meeting: {
        id: 'mtg-1',
        title: 'Quick Sync',
        participants: ['Alice'],
        startTime: new Date(),
        endTime: new Date(),
        metadata: {},
      },
    });

    mockMemoryService.getContext.mockResolvedValue([]);
    mockPrisma.pRD.findMany.mockResolvedValue([]);
    mockPrisma.pRD.create.mockResolvedValue({
      id: 'prd-1',
      title: 'Test PRD',
      status: 'draft',
      confidence: 0.8,
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Reading transcript.',
        toolCalls: [{ name: 'read_transcript', input: {} }],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.80',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const result = await agent.processTranscript('tenant-1', 'mtg-1', 'eng-1', 'task-1');

    expect(result.totalTokens.input).toBe(300);
    expect(result.totalTokens.output).toBe(110);
  });

  // ---- Error handling ----

  it('should handle tool execution errors gracefully', async () => {
    mockPrisma.transcript.findUnique.mockRejectedValue(
      new Error('Database connection failed'),
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Reading transcript.',
        toolCalls: [{ name: 'read_transcript', input: {} }],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Failed to read transcript. Confidence: 0.1',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const result = await agent.processTranscript('tenant-1', 'mtg-1', 'eng-1', 'task-1');

    expect(result.success).toBe(true); // loop itself completes
    expect(result.steps[0].toolResult?.success).toBe(false);
    expect(result.steps[0].toolResult?.error).toContain('Database connection failed');
  });
});
