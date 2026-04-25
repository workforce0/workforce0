// mvp/src/services/agents/dev/__tests__/dev.agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevAgent } from '../dev.agent.js';
import type { ModelClient } from '../../../agent-runtime/types.js';
import type { MemoryService } from '../../../memory/memory.service.js';
import type { ModelRegistryService } from '../../../model-registry/model-registry.service.js';

describe('DevAgent', () => {
  let mockModelClient: ModelClient;
  let mockPrisma: any;
  let mockMemoryService: any;
  let mockModelRegistry: any;
  let agent: DevAgent;

  beforeEach(() => {
    mockModelClient = { chat: vi.fn() };

    mockPrisma = {
      pRD: {
        findUnique: vi.fn(),
      },
    };

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
        maxSteps: 50,
      }),
    };

    agent = new DevAgent(
      mockModelClient,
      mockPrisma,
      mockMemoryService,
      mockModelRegistry,
    );
  });

  // ---- Identity ----

  it('should have agentType "dev_agent"', () => {
    expect(agent.agentType).toBe('dev_agent');
  });

  it('should have exactly 5 tools', () => {
    expect(agent.tools).toHaveLength(5);
  });

  it('should expose the correct tool names', () => {
    const names = agent.tools.map((t: any) => t.name);
    expect(names).toEqual([
      'read_prd',
      'recall_codebase_context',
      'generate_code',
      'self_review',
      'create_pull_request',
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

    mockMemoryService.getContext.mockResolvedValue([]);

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.implementPrd('tenant-1', 'prd-1', 'eng-1', 'task-1');

    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-sonnet-4-6',
      }),
    );
  });

  // ---- Process flow ----

  it('should follow full process: read_prd -> recall_context -> generate_code -> self_review -> create_pr', async () => {
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

    // Mock memory service
    mockMemoryService.getContext.mockResolvedValue([
      {
        key: 'file_naming',
        category: 'convention',
        value: { style: 'kebab-case' },
        confidence: 0.9,
      },
    ]);

    (mockModelClient.chat as any)
      // Step 1: read_prd
      .mockResolvedValueOnce({
        content: 'Let me read the approved PRD first.',
        toolCalls: [
          { name: 'read_prd', input: {} },
        ],
        tokenUsage: { input: 200, output: 80 },
        stopReason: 'tool_use',
      })
      // Step 2: recall_codebase_context
      .mockResolvedValueOnce({
        content: 'Now let me check codebase conventions.',
        toolCalls: [
          { name: 'recall_codebase_context', input: {} },
        ],
        tokenUsage: { input: 400, output: 100 },
        stopReason: 'tool_use',
      })
      // Step 3: generate_code
      .mockResolvedValueOnce({
        content: 'Generating implementation code and tests.',
        toolCalls: [
          {
            name: 'generate_code',
            input: {
              requirementTitle: 'OAuth Login',
              files: [
                {
                  path: 'src/services/auth/oauth.service.ts',
                  content: 'export class OAuthService {}',
                  type: 'implementation',
                },
                {
                  path: 'src/services/auth/__tests__/oauth.service.test.ts',
                  content: 'describe("OAuthService", () => {})',
                  type: 'test',
                },
              ],
              language: 'typescript',
            },
          },
        ],
        tokenUsage: { input: 600, output: 200 },
        stopReason: 'tool_use',
      })
      // Step 4: self_review
      .mockResolvedValueOnce({
        content: 'Self-reviewing generated code.',
        toolCalls: [
          {
            name: 'self_review',
            input: {
              files: [
                {
                  path: 'src/services/auth/oauth.service.ts',
                  content: 'export class OAuthService {}',
                },
              ],
              checkCategories: ['bugs', 'security', 'conventions'],
            },
          },
        ],
        tokenUsage: { input: 700, output: 150 },
        stopReason: 'tool_use',
      })
      // Step 5: create_pull_request
      .mockResolvedValueOnce({
        content: 'Creating pull request for human review.',
        toolCalls: [
          {
            name: 'create_pull_request',
            input: {
              title: 'feat: implement OAuth login (PRD: User Authentication)',
              description: 'Implements OAuth-based login with Google provider.',
              branch: 'feat/oauth-login',
              files: [
                'src/services/auth/oauth.service.ts',
                'src/services/auth/__tests__/oauth.service.test.ts',
              ],
              labels: ['feature'],
            },
          },
        ],
        tokenUsage: { input: 800, output: 180 },
        stopReason: 'tool_use',
      })
      // Step 6: final summary
      .mockResolvedValueOnce({
        content:
          'PR created successfully for OAuth Login implementation. ' +
          'Code follows kebab-case naming convention. Self-review passed. Confidence: 0.93',
        toolCalls: [],
        tokenUsage: { input: 900, output: 120 },
        stopReason: 'end_turn',
      });

    const result = await agent.implementPrd(
      'tenant-1',
      'prd-1',
      'eng-1',
      'task-1',
    );

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(6);
    expect(result.steps[0].toolName).toBe('read_prd');
    expect(result.steps[1].toolName).toBe('recall_codebase_context');
    expect(result.steps[2].toolName).toBe('generate_code');
    expect(result.steps[3].toolName).toBe('self_review');
    expect(result.steps[4].toolName).toBe('create_pull_request');
    expect(result.confidence).toBe(0.93);

    // Verify PRD was fetched
    expect(mockPrisma.pRD.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prd-1' },
      }),
    );

    // Verify memory was queried
    expect(mockMemoryService.getContext).toHaveBeenCalled();
  });

  // ---- Tool: read_prd ----

  it('should return error when prdId is missing from context', async () => {
    const readTool = agent.tools.find((t: any) => t.name === 'read_prd')!;
    const result = await readTool.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'dev_agent',
        traceId: 'tr-1',
        memory: {}, // no prdId
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('prdId');
  });

  it('should reject PRDs that are not approved', async () => {
    mockPrisma.pRD.findUnique.mockResolvedValue({
      id: 'prd-1',
      title: 'Draft PRD',
      status: 'draft',
    });

    const readTool = agent.tools.find((t: any) => t.name === 'read_prd')!;
    const result = await readTool.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'dev_agent',
        traceId: 'tr-1',
        memory: { prdId: 'prd-1' },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('approved');
  });

  // ---- Tool: generate_code ----

  it('should return error when no files are provided for generation', async () => {
    const genTool = agent.tools.find((t: any) => t.name === 'generate_code')!;
    const result = await genTool.execute(
      { requirementTitle: 'Test', files: [] },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'dev_agent',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No files provided');
  });

  // ---- Tool: create_pull_request ----

  it('should never auto-deploy — PR status is always open', async () => {
    const prTool = agent.tools.find((t: any) => t.name === 'create_pull_request')!;
    const result = await prTool.execute(
      {
        title: 'feat: test PR',
        description: 'Test PR description',
        branch: 'feat/test',
        files: ['src/test.ts'],
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'dev_agent',
        traceId: 'tr-1',
        memory: { taskId: 'task-1' },
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).status).toBe('open');
    expect((result.data as any).autoDeploy).toBe(false);
  });

  // ---- Model Registry ----

  it('should call resolveModel with correct tenantId and agentType', async () => {
    mockPrisma.pRD.findUnique.mockResolvedValue({
      id: 'prd-1',
      title: 'Test',
      status: 'approved',
      confidence: 0.9,
    });

    mockMemoryService.getContext.mockResolvedValue([]);

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.implementPrd('tenant-42', 'prd-1', 'eng-1', 'task-1');

    expect(mockModelRegistry.resolveModel).toHaveBeenCalledWith('tenant-42', 'dev_agent');
  });

  it('should use resolved model from registry', async () => {
    mockModelRegistry.resolveModel.mockResolvedValue({
      modelId: 'gpt-4o',
      provider: 'openai',
      confidenceThreshold: 0.9,
      maxSteps: 50,
    });

    mockPrisma.pRD.findUnique.mockResolvedValue({
      id: 'prd-1',
      title: 'Test',
      status: 'approved',
      confidence: 0.9,
    });

    mockMemoryService.getContext.mockResolvedValue([]);

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.implementPrd('tenant-1', 'prd-1', 'eng-1', 'task-1');

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

    mockMemoryService.getContext.mockResolvedValue([]);

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    const result = await agent.implementPrd('tenant-1', 'prd-1', 'eng-1', 'task-1');

    expect(result.success).toBe(true);
    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-sonnet-4-6',
      }),
    );
  });

  it('should work without model registry (backward compatibility)', async () => {
    const agentWithoutRegistry = new DevAgent(
      mockModelClient,
      mockPrisma,
      mockMemoryService,
    );

    mockPrisma.pRD.findUnique.mockResolvedValue({
      id: 'prd-1',
      title: 'Test',
      status: 'approved',
      confidence: 0.9,
    });

    mockMemoryService.getContext.mockResolvedValue([]);

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    const result = await agentWithoutRegistry.implementPrd('tenant-1', 'prd-1', 'eng-1', 'task-1');

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
        content: 'Reading PRD.',
        toolCalls: [{ name: 'read_prd', input: {} }],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Failed to read PRD. Confidence: 0.1',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const result = await agent.implementPrd('tenant-1', 'prd-1', 'eng-1', 'task-1');

    expect(result.success).toBe(true); // loop itself completes
    expect(result.steps[0].toolResult?.success).toBe(false);
    expect(result.steps[0].toolResult?.error).toContain('Database connection failed');
  });
});
