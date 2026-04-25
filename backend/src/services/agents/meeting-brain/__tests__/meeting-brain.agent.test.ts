// mvp/src/services/agents/meeting-brain/__tests__/meeting-brain.agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeetingBrainAgent } from '../meeting-brain.agent.js';
import type { ModelClient } from '../../../agent-runtime/types.js';
import type { MemoryService } from '../../../memory/memory.service.js';
import type { ModelRegistryService } from '../../../model-registry/model-registry.service.js';

describe('MeetingBrainAgent', () => {
  let mockModelClient: ModelClient;
  let mockPrisma: any;
  let mockMemoryService: any;
  let mockModelRegistry: any;
  let agent: MeetingBrainAgent;

  beforeEach(() => {
    mockModelClient = { chat: vi.fn() };

    mockPrisma = {
      transcript: {
        findUnique: vi.fn(),
      },
      meetingInsights: {
        create: vi.fn(),
      },
    };

    mockMemoryService = {
      getContext: vi.fn().mockResolvedValue([]),
      recall: vi.fn(),
      remember: vi.fn().mockResolvedValue(undefined),
    } as unknown as MemoryService;

    mockModelRegistry = {
      resolveModel: vi.fn().mockResolvedValue({
        modelId: 'gemini-3.1-flash',
        provider: 'google',
        confidenceThreshold: 0.85,
        maxSteps: 25,
      }),
    };

    agent = new MeetingBrainAgent(
      mockModelClient,
      mockPrisma,
      mockMemoryService,
      mockModelRegistry,
    );
  });

  // ---- Identity ----

  it('should have agentType "meeting_brain"', () => {
    expect(agent.agentType).toBe('meeting_brain');
  });

  it('should have exactly 5 tools', () => {
    expect(agent.tools).toHaveLength(5);
  });

  it('should expose the correct tool names', () => {
    const names = agent.tools.map((t: any) => t.name);
    expect(names).toEqual([
      'analyze_transcript',
      'identify_participants',
      'extract_decisions',
      'extract_action_items',
      'create_meeting_summary',
    ]);
  });

  // ---- processTranscript: full flow ----

  it('should process transcript through all tools (analyze -> identify -> decisions -> actions -> summary)', async () => {
    const transcriptText =
      'Alice: We need to implement OAuth by next Friday.\n' +
      'Bob: Agreed. I will handle the backend integration.\n' +
      'Alice: Let us go with Google and GitHub providers.\n' +
      'Bob: Sounds good. I will create the Jira tickets today.';

    // Mock meeting summary creation
    mockPrisma.meetingInsights.create.mockResolvedValue({
      id: 'summary-1',
      title: 'OAuth Planning Meeting',
      topics: ['OAuth implementation', 'Provider selection'],
      decisions: [
        { description: 'Use Google and GitHub OAuth', madeBy: 'Alice', context: 'Provider selection' },
      ],
      actionItems: [
        { description: 'Handle backend integration', assignee: 'Bob', priority: 'high' },
      ],
      confidence: 0.9,
    });

    (mockModelClient.chat as any)
      // Step 1: model calls analyze_transcript
      .mockResolvedValueOnce({
        content: 'Let me analyze the transcript.',
        toolCalls: [
          { name: 'analyze_transcript', input: { transcript: transcriptText } },
        ],
        tokenUsage: { input: 200, output: 80 },
        stopReason: 'tool_use',
      })
      // Step 2: model calls identify_participants
      .mockResolvedValueOnce({
        content: 'Now identifying participants and their roles.',
        toolCalls: [
          {
            name: 'identify_participants',
            input: {
              participants: [
                { name: 'Alice', role: 'PM', confidence: 0.8, keyStatements: ['We need to implement OAuth'] },
                { name: 'Bob', role: 'Engineer', confidence: 0.85, keyStatements: ['I will handle the backend'] },
              ],
            },
          },
        ],
        tokenUsage: { input: 400, output: 100 },
        stopReason: 'tool_use',
      })
      // Step 3: model calls extract_decisions
      .mockResolvedValueOnce({
        content: 'Extracting decisions from the meeting.',
        toolCalls: [
          {
            name: 'extract_decisions',
            input: {
              decisions: [
                {
                  description: 'Use Google and GitHub as OAuth providers',
                  madeBy: 'Alice',
                  context: 'Choosing OAuth providers for the platform',
                  confidence: 0.95,
                },
              ],
            },
          },
        ],
        tokenUsage: { input: 500, output: 120 },
        stopReason: 'tool_use',
      })
      // Step 4: model calls extract_action_items
      .mockResolvedValueOnce({
        content: 'Extracting action items.',
        toolCalls: [
          {
            name: 'extract_action_items',
            input: {
              actionItems: [
                {
                  description: 'Handle backend OAuth integration',
                  assignee: 'Bob',
                  deadline: 'next Friday',
                  priority: 'high',
                },
                {
                  description: 'Create Jira tickets for OAuth work',
                  assignee: 'Bob',
                  deadline: 'today',
                  priority: 'high',
                },
              ],
            },
          },
        ],
        tokenUsage: { input: 600, output: 140 },
        stopReason: 'tool_use',
      })
      // Step 5: model calls create_meeting_summary
      .mockResolvedValueOnce({
        content: 'Creating the meeting summary.',
        toolCalls: [
          {
            name: 'create_meeting_summary',
            input: {
              title: 'OAuth Planning Meeting',
              topics: ['OAuth implementation', 'Provider selection'],
              keyPoints: ['OAuth needed by next Friday', 'Google and GitHub chosen as providers'],
              participants: [
                { name: 'Alice', role: 'PM' },
                { name: 'Bob', role: 'Engineer' },
              ],
              decisions: [
                { description: 'Use Google and GitHub OAuth', madeBy: 'Alice', context: 'Provider selection' },
              ],
              actionItems: [
                { description: 'Handle backend integration', assignee: 'Bob', deadline: 'next Friday', priority: 'high' },
                { description: 'Create Jira tickets', assignee: 'Bob', deadline: 'today', priority: 'high' },
              ],
              followUps: ['Review OAuth implementation progress next week'],
              confidence: 0.9,
            },
          },
        ],
        tokenUsage: { input: 700, output: 200 },
        stopReason: 'tool_use',
      })
      // Step 6: model summarizes and ends
      .mockResolvedValueOnce({
        content:
          'Meeting summary created successfully for OAuth Planning Meeting. ' +
          'Identified 2 participants, 1 decision, and 2 action items. Confidence: 0.90',
        toolCalls: [],
        tokenUsage: { input: 800, output: 150 },
        stopReason: 'end_turn',
      });

    const result = await agent.processTranscript(
      'tenant-1',
      'mtg-1',
      transcriptText,
      'eng-1',
    );

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(6);
    expect(result.steps[0].toolName).toBe('analyze_transcript');
    expect(result.steps[1].toolName).toBe('identify_participants');
    expect(result.steps[2].toolName).toBe('extract_decisions');
    expect(result.steps[3].toolName).toBe('extract_action_items');
    expect(result.steps[4].toolName).toBe('create_meeting_summary');
    expect(result.confidence).toBe(0.9);
  });

  // ---- Tool: analyze_transcript ----

  it('should analyze transcript from raw text input', async () => {
    const analyzeTool = agent.tools.find((t: any) => t.name === 'analyze_transcript')!;
    const result = await analyzeTool.execute(
      { transcript: 'Alice: Hello.\nBob: Hi there.' },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'meeting_brain',
        traceId: 'tr-1',
        memory: { meetingId: 'mtg-1' },
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).speakers).toContain('Alice');
    expect((result.data as any).speakers).toContain('Bob');
    expect((result.data as any).wordCount).toBeGreaterThan(0);
  });

  it('should analyze transcript from database when no text provided', async () => {
    mockPrisma.transcript.findUnique.mockResolvedValue({
      id: 'tx-1',
      meetingId: 'mtg-1',
      fullText: 'Alice: We need auth.\nBob: Agreed.',
      segments: [
        { speaker: 'Alice', text: 'We need auth.', startTime: 0, endTime: 5 },
      ],
      speakers: ['Alice', 'Bob'],
      meeting: {
        id: 'mtg-1',
        title: 'Auth Meeting',
        participants: ['Alice', 'Bob'],
        startTime: new Date(),
        endTime: new Date(),
      },
    });

    const analyzeTool = agent.tools.find((t: any) => t.name === 'analyze_transcript')!;
    const result = await analyzeTool.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'meeting_brain',
        traceId: 'tr-1',
        memory: { meetingId: 'mtg-1' },
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).meetingTitle).toBe('Auth Meeting');
    expect((result.data as any).speakers).toEqual(['Alice', 'Bob']);
  });

  it('should return error when no meetingId and no transcript text', async () => {
    const analyzeTool = agent.tools.find((t: any) => t.name === 'analyze_transcript')!;
    const result = await analyzeTool.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'meeting_brain',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('meetingId');
  });

  it('should return error when transcript not found in database', async () => {
    mockPrisma.transcript.findUnique.mockResolvedValue(null);

    const analyzeTool = agent.tools.find((t: any) => t.name === 'analyze_transcript')!;
    const result = await analyzeTool.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'meeting_brain',
        traceId: 'tr-1',
        memory: { meetingId: 'mtg-missing' },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No transcript found');
  });

  // ---- Tool: identify_participants ----

  it('should identify participants and enrich with tenant memory', async () => {
    mockMemoryService.getContext.mockResolvedValue([
      {
        key: 'team_roles',
        category: 'convention',
        value: { Alice: 'Product Manager' },
        confidence: 1.0,
      },
    ]);

    const participantTool = agent.tools.find((t: any) => t.name === 'identify_participants')!;
    const result = await participantTool.execute(
      {
        participants: [
          { name: 'Alice', role: 'PM', confidence: 0.7 },
          { name: 'Bob', role: 'Engineer', confidence: 0.8 },
        ],
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'meeting_brain',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).count).toBe(2);

    const participants = (result.data as any).participants;
    // Alice should be enriched from tenant memory
    expect(participants[0].role).toBe('Product Manager');
    expect(participants[0].confidence).toBe(1.0);
    expect(participants[0].roleSource).toBe('tenant_memory');
    // Bob should keep inferred role
    expect(participants[1].role).toBe('Engineer');
    expect(participants[1].roleSource).toBe('inferred');
  });

  it('should return error when no participants provided', async () => {
    const participantTool = agent.tools.find((t: any) => t.name === 'identify_participants')!;
    const result = await participantTool.execute(
      { participants: [] },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'meeting_brain',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No participants');
  });

  // ---- Tool: extract_decisions ----

  it('should extract decisions and store in memory', async () => {
    const decisionsTool = agent.tools.find((t: any) => t.name === 'extract_decisions')!;
    const result = await decisionsTool.execute(
      {
        decisions: [
          {
            description: 'Use PostgreSQL as the database',
            madeBy: 'Alice',
            context: 'Database selection discussion',
            confidence: 0.95,
          },
        ],
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'meeting_brain',
        traceId: 'tr-1',
        memory: { meetingId: 'mtg-1' },
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).count).toBe(1);
    expect((result.data as any).decisions[0].description).toBe('Use PostgreSQL as the database');
    expect((result.data as any).decisions[0].madeBy).toBe('Alice');

    // Verify decision was stored in memory
    expect(mockMemoryService.remember).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      key: 'meeting_decisions_mtg-1',
      category: 'decision',
    }));
  });

  // ---- Tool: extract_action_items ----

  it('should extract action items and store in memory', async () => {
    const actionTool = agent.tools.find((t: any) => t.name === 'extract_action_items')!;
    const result = await actionTool.execute(
      {
        actionItems: [
          {
            description: 'Set up OAuth integration',
            assignee: 'Bob',
            deadline: '2026-03-15',
            priority: 'high',
          },
          {
            description: 'Write documentation',
            assignee: 'unassigned',
            priority: 'low',
          },
        ],
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'meeting_brain',
        traceId: 'tr-1',
        memory: { meetingId: 'mtg-1' },
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).count).toBe(2);
    expect((result.data as any).actionItems[0].assignee).toBe('Bob');
    expect((result.data as any).actionItems[0].deadline).toBe('2026-03-15');
    expect((result.data as any).actionItems[1].assignee).toBe('unassigned');
    expect((result.data as any).actionItems[1].deadline).toBeNull();

    // Verify action items were stored in memory
    expect(mockMemoryService.remember).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      key: 'meeting_actions_mtg-1',
      category: 'decision',
    }));
  });

  // ---- Tool: create_meeting_summary ----

  it('should create meeting summary in database', async () => {
    mockPrisma.meetingInsights.create.mockResolvedValue({
      id: 'summary-1',
      title: 'Sprint Planning',
      topics: ['OAuth', 'Database'],
      decisions: [{ description: 'Use PostgreSQL', madeBy: 'Alice', context: 'DB choice' }],
      actionItems: [{ description: 'Set up DB', assignee: 'Bob', priority: 'high' }],
      confidence: 0.88,
    });

    const summaryTool = agent.tools.find((t: any) => t.name === 'create_meeting_summary')!;
    const result = await summaryTool.execute(
      {
        title: 'Sprint Planning',
        topics: ['OAuth', 'Database'],
        keyPoints: ['Need OAuth by Friday', 'PostgreSQL chosen'],
        participants: [{ name: 'Alice', role: 'PM' }],
        decisions: [{ description: 'Use PostgreSQL', madeBy: 'Alice', context: 'DB choice' }],
        actionItems: [{ description: 'Set up DB', assignee: 'Bob', priority: 'high' }],
        followUps: ['Review next week'],
        confidence: 0.88,
      },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'meeting_brain',
        traceId: 'tr-1',
        memory: { meetingId: 'mtg-1' },
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).summaryId).toBe('summary-1');
    expect((result.data as any).title).toBe('Sprint Planning');
    expect((result.data as any).topicCount).toBe(2);
    expect((result.data as any).decisionCount).toBe(1);
    expect((result.data as any).actionItemCount).toBe(1);

    // Verify database call — tool stores 'summary' not 'title'
    expect(mockPrisma.meetingInsights.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          meetingId: 'mtg-1',
          tenantId: 'tenant-1',
        }),
      }),
    );
  });

  it('should return error when meetingId is missing for create_meeting_summary', async () => {
    const summaryTool = agent.tools.find((t: any) => t.name === 'create_meeting_summary')!;
    const result = await summaryTool.execute(
      { title: 'Test', topics: ['A'], keyPoints: ['B'] },
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'meeting_brain',
        traceId: 'tr-1',
        memory: {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('meetingId');
  });

  // ---- Model Registry ----

  it('should call resolveModel with correct tenantId and agentType', async () => {
    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    await agent.processTranscript('tenant-42', 'mtg-1', 'Hello world transcript');

    expect(mockModelRegistry.resolveModel).toHaveBeenCalledWith('tenant-42', 'meeting_brain');
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

    await agent.processTranscript('tenant-1', 'mtg-1', 'Hello world transcript');

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

    const result = await agent.processTranscript('tenant-1', 'mtg-1', 'Hello world transcript');

    expect(result.success).toBe(true);
    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-flash',
      }),
    );
  });

  it('should work without model registry (backward compatibility)', async () => {
    const agentWithoutRegistry = new MeetingBrainAgent(
      mockModelClient,
      mockPrisma,
      mockMemoryService,
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

    const result = await agentWithoutRegistry.processTranscript('tenant-1', 'mtg-1', 'Hello world transcript');

    expect(result.success).toBe(true);
    expect(mockModelClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-flash',
      }),
    );
  });

  // ---- Token tracking ----

  it('should track total tokens across the run', async () => {
    mockPrisma.meetingInsights.create.mockResolvedValue({
      id: 'summary-1',
      title: 'Test',
      topics: ['A'],
      decisions: [],
      actionItems: [],
      confidence: 0.8,
    });

    (mockModelClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Analyzing transcript.',
        toolCalls: [{ name: 'analyze_transcript', input: { transcript: 'Alice: Hello.' } }],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.80',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const result = await agent.processTranscript('tenant-1', 'mtg-1', 'Alice: Hello.');

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
        content: 'Analyzing transcript.',
        toolCalls: [{ name: 'analyze_transcript', input: {} }],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Failed to analyze transcript. Confidence: 0.1',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const result = await agent.processTranscript('tenant-1', 'mtg-1', '');

    expect(result.success).toBe(true); // loop itself completes
    expect(result.steps[0].toolResult?.success).toBe(false);
    expect(result.steps[0].toolResult?.error).toContain('Database connection failed');
  });
});
