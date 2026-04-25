// mvp/src/services/agents/qa/__tests__/qa.agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QAAgent } from '../qa.agent.js';
import type { ModelClient } from '../../../agent-runtime/types.js';
import type { CommunicationRouter } from '../../../communication/router.js';
import type { MemoryService } from '../../../memory/memory.service.js';
import type { ModelRegistryService } from '../../../model-registry/model-registry.service.js';

describe('QAAgent', () => {
  let mockModelClient: ModelClient;
  let mockPrisma: any;
  let mockCommsRouter: any;
  let mockMemoryService: any;
  let mockModelRegistry: any;
  let agent: QAAgent;

  beforeEach(() => {
    mockModelClient = { chat: vi.fn() };

    mockPrisma = {
      pRD: {
        findUnique: vi.fn(),
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
        modelId: 'anthropic/claude-sonnet-4-6',
        provider: 'anthropic',
        confidenceThreshold: 0.9,
        maxSteps: 30,
      }),
    };

    agent = new QAAgent(
      mockModelClient,
      mockPrisma,
      mockCommsRouter,
      mockMemoryService,
      mockModelRegistry,
    );
  });

  // ---- Identity ----

  it('should have agentType "qa_agent"', () => {
    expect(agent.agentType).toBe('qa_agent');
  });

  it('should have exactly 5 tools', () => {
    expect(agent.tools).toHaveLength(5);
  });

  it('should expose the correct tool names', () => {
    const names = agent.tools.map((t: any) => t.name);
    expect(names).toEqual([
      'read_requirements',
      'read_code_changes',
      'run_test_suite',
      'check_coverage',
      'report_issues',
    ]);
  });

  // ---- Model ----

  it('should use Claude Sonnet as primary model', async () => {
    mockPrisma.pRD.findUnique.mockResolvedValue({
      id: 'prd-1',
      title: 'Auth Feature',
      summary: 'Implement OAuth',
      objectives: [],
      requirements: [],
      acceptanceCriteria: [],
      outOfScope: [],
      assumptions: [],
      risks: [],
      confidence: 0.92,
      status: 'approved',
      version: 1,
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.validatePr('tenant-1', 'prd-1', 42, 'eng-1', 'task-1');

    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-sonnet-4-6',
      }),
    );
  });

  // ---- Process flow ----

  it('should follow full QA flow: read_requirements -> read_code -> run_tests -> check_coverage -> report', async () => {
    // Mock PRD data
    mockPrisma.pRD.findUnique.mockResolvedValue({
      id: 'prd-1',
      title: 'User Authentication',
      summary: 'Implement OAuth-based authentication.',
      objectives: ['Secure access'],
      requirements: [
        {
          title: 'OAuth Login',
          description: 'Support Google OAuth',
          priority: 'P0',
          acceptanceCriteria: ['Users can log in via Google'],
        },
      ],
      acceptanceCriteria: ['All auth flows tested'],
      outOfScope: ['SAML'],
      assumptions: ['Google OAuth API stable'],
      risks: [],
      confidence: 0.92,
      status: 'approved',
      version: 1,
    });

    // Mock comms router for report
    (mockCommsRouter.send as any).mockResolvedValue({
      success: true,
      messageLogId: 'msg-1',
      channel: 'slack',
    });

    (mockModelClient.chat as any)
      // Step 1: read_requirements
      .mockResolvedValueOnce({
        content: 'Let me read the approved requirements.',
        toolCalls: [
          { name: 'read_requirements', input: {} },
        ],
        tokenUsage: { input: 200, output: 80 },
        stopReason: 'tool_use',
      })
      // Step 2: read_code_changes
      .mockResolvedValueOnce({
        content: 'Now reading the code changes from the PR.',
        toolCalls: [
          { name: 'read_code_changes', input: { prNumber: 42 } },
        ],
        tokenUsage: { input: 400, output: 100 },
        stopReason: 'tool_use',
      })
      // Step 3: run_test_suite
      .mockResolvedValueOnce({
        content: 'Running the test suite.',
        toolCalls: [
          { name: 'run_test_suite', input: { testRunner: 'vitest' } },
        ],
        tokenUsage: { input: 500, output: 90 },
        stopReason: 'tool_use',
      })
      // Step 4: check_coverage
      .mockResolvedValueOnce({
        content: 'Checking test coverage against requirements.',
        toolCalls: [
          {
            name: 'check_coverage',
            input: {
              requirements: [
                {
                  title: 'OAuth Login',
                  acceptanceCriteria: ['Users can log in via Google'],
                },
              ],
              coverageThreshold: 80,
            },
          },
        ],
        tokenUsage: { input: 600, output: 120 },
        stopReason: 'tool_use',
      })
      // Step 5: report_issues
      .mockResolvedValueOnce({
        content: 'Reporting QA findings.',
        toolCalls: [
          {
            name: 'report_issues',
            input: {
              issues: [
                {
                  title: 'Missing error handling test for OAuth callback',
                  description: 'No test covers the case where OAuth provider returns an error.',
                  severity: 'major',
                  category: 'missing_test',
                  file: 'src/services/auth/oauth.service.ts',
                  suggestion: 'Add test for OAuth error callback scenario.',
                },
              ],
              summary: 'One major issue found: missing error handling test for OAuth callback.',
              verdict: 'changes_requested',
              routeTo: 'dev_agent',
            },
          },
        ],
        tokenUsage: { input: 700, output: 150 },
        stopReason: 'tool_use',
      })
      // Step 6: final summary
      .mockResolvedValueOnce({
        content:
          'QA review complete. Changes requested — 1 major issue found: ' +
          'missing error handling test for OAuth callback. Confidence: 0.91',
        toolCalls: [],
        tokenUsage: { input: 800, output: 100 },
        stopReason: 'end_turn',
      });

    const result = await agent.validatePr(
      'tenant-1',
      'prd-1',
      42,
      'eng-1',
      'task-1',
    );

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(6);
    expect(result.steps[0].toolName).toBe('read_requirements');
    expect(result.steps[1].toolName).toBe('read_code_changes');
    expect(result.steps[2].toolName).toBe('run_test_suite');
    expect(result.steps[3].toolName).toBe('check_coverage');
    expect(result.steps[4].toolName).toBe('report_issues');
    expect(result.confidence).toBe(0.91);

    // Verify PRD was fetched
    expect(mockPrisma.pRD.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prd-1' },
      }),
    );

    // Verify comms router was called for issue report
    expect(mockCommsRouter.send).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        recipientRole: 'dev_agent',
        messageType: 'notification',
      }),
    );
  });

  // ---- Tool: read_requirements ----

  it('should return error when prdId is missing from context', async () => {
    const readTool = agent.tools.find((t: any) => t.name === 'read_requirements')!;
    const result = await readTool.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'qa_agent',
        traceId: 'tr-1',
        memory: {}, // no prdId
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('prdId');
  });

  it('should return error when PRD is not found', async () => {
    mockPrisma.pRD.findUnique.mockResolvedValue(null);

    const readTool = agent.tools.find((t: any) => t.name === 'read_requirements')!;
    const result = await readTool.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'qa_agent',
        traceId: 'tr-1',
        memory: { prdId: 'prd-missing' },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No PRD found');
  });

  // ---- Tool: read_code_changes ----

  it('should return error when prNumber is missing', async () => {
    const codeTool = agent.tools.find((t: any) => t.name === 'read_code_changes')!;
    const result = await codeTool.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'qa_agent',
        traceId: 'tr-1',
        memory: {}, // no prNumber
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('prNumber');
  });

  // ---- Tool: check_coverage ----

  it('should return error when no requirements provided', async () => {
    const coverageTool = agent.tools.find((t: any) => t.name === 'check_coverage')!;
    const result = await coverageTool.execute(
      { requirements: [] },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'qa_agent',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No requirements provided');
  });

  // ---- Tool: report_issues ----

  it('should report issues and route to dev_agent', async () => {
    (mockCommsRouter.send as any).mockResolvedValue({
      success: true,
      messageLogId: 'msg-1',
      channel: 'slack',
    });

    const reportTool = agent.tools.find((t: any) => t.name === 'report_issues')!;
    const result = await reportTool.execute(
      {
        issues: [
          {
            title: 'Missing null check',
            description: 'No null check on user input',
            severity: 'critical',
            category: 'bug',
            file: 'src/handler.ts',
            suggestion: 'Add input validation',
          },
        ],
        summary: 'Critical bug found: missing null check.',
        verdict: 'blocked',
        routeTo: 'dev_agent',
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'qa_agent',
        traceId: 'tr-1',
        memory: { taskId: 'task-1' },
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).verdict).toBe('blocked');
    expect((result.data as any).critical).toBe(1);
    expect((result.data as any).routedTo).toBe('dev_agent');
    expect((result.data as any).messageSent).toBe(true);

    // Verify urgency is high for critical issues
    expect(mockCommsRouter.send).toHaveBeenCalledWith(
      expect.objectContaining({
        urgency: 'high',
      }),
    );
  });

  // ---- Model Registry ----

  it('should call resolveModel with correct tenantId and agentType', async () => {
    mockPrisma.pRD.findUnique.mockResolvedValue({
      id: 'prd-1',
      title: 'Test',
      status: 'approved',
      confidence: 0.9,
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.validatePr('tenant-42', 'prd-1', 42, 'eng-1', 'task-1');

    expect(mockModelRegistry.resolveModel).toHaveBeenCalledWith('tenant-42', 'qa_agent');
  });

  it('should use resolved model from registry', async () => {
    mockModelRegistry.resolveModel.mockResolvedValue({
      modelId: 'gpt-4o',
      provider: 'openai',
      confidenceThreshold: 0.9,
      maxSteps: 30,
    });

    mockPrisma.pRD.findUnique.mockResolvedValue({
      id: 'prd-1',
      title: 'Test',
      status: 'approved',
      confidence: 0.9,
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.validatePr('tenant-1', 'prd-1', 42, 'eng-1', 'task-1');

    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
      }),
    );
  });

  it('should fall back to default model when resolveModel throws', async () => {
    mockModelRegistry.resolveModel.mockRejectedValue(new Error('No config'));

    mockPrisma.pRD.findUnique.mockResolvedValue({
      id: 'prd-1',
      title: 'Test',
      status: 'approved',
      confidence: 0.9,
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    const result = await agent.validatePr('tenant-1', 'prd-1', 42, 'eng-1', 'task-1');

    expect(result.success).toBe(true);
    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-sonnet-4-6',
      }),
    );
  });

  it('should work without model registry (backward compatibility)', async () => {
    const agentWithoutRegistry = new QAAgent(
      mockModelClient,
      mockPrisma,
      mockCommsRouter,
      mockMemoryService,
    );

    mockPrisma.pRD.findUnique.mockResolvedValue({
      id: 'prd-1',
      title: 'Test',
      status: 'approved',
      confidence: 0.9,
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    const result = await agentWithoutRegistry.validatePr('tenant-1', 'prd-1', 42, 'eng-1', 'task-1');

    expect(result.success).toBe(true);
    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-sonnet-4-6',
      }),
    );
  });

  // ---- Error handling ----

  it('should handle tool execution errors gracefully', async () => {
    mockPrisma.pRD.findUnique.mockRejectedValue(
      new Error('Database connection failed'),
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Reading requirements.',
        toolCalls: [{ name: 'read_requirements', input: {} }],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Failed to read requirements. Confidence: 0.1',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const result = await agent.validatePr('tenant-1', 'prd-1', 42, 'eng-1', 'task-1');

    expect(result.success).toBe(true); // loop itself completes
    expect(result.steps[0].toolResult?.success).toBe(false);
    expect(result.steps[0].toolResult?.error).toContain('Database connection failed');
  });
});
