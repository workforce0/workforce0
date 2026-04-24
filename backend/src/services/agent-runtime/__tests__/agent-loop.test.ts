// mvp/src/services/agent-runtime/__tests__/agent-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../agent-loop.js';
import type { AgentConfig, AgentTool, ModelClient } from '../types.js';

describe('AgentLoop', () => {
  let mockClient: ModelClient;
  let config: AgentConfig;
  const echoTool: AgentTool = {
    name: 'echo',
    description: 'Echoes input',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
    execute: async (input: any) => ({ success: true, data: input.message }),
  };

  beforeEach(() => {
    mockClient = { chat: vi.fn() };
    config = {
      agentType: 'test_agent',
      systemPrompt: 'You are a test agent.',
      tools: [echoTool],
      maxSteps: 10,
      confidenceThreshold: 0.85,
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
    };
  });

  it('should execute tool calls and loop until end_turn', async () => {
    (mockClient.chat as any)
      .mockResolvedValueOnce({
        content: 'I will echo the message.',
        toolCalls: [{ name: 'echo', input: { message: 'hello' } }],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Done. The result is hello. Confidence: 0.95',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const loop = new AgentLoop(config, mockClient);
    const result = await loop.run('Say hello', {
      tenantId: 't1', engagementId: 'e1', agentType: 'test_agent', traceId: 'tr1', memory: {},
    });

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(2);
    expect(result.steps[0].toolName).toBe('echo');
    expect(result.steps[0].toolCalls).toHaveLength(1);
    expect(result.steps[0].toolCalls[0].toolName).toBe('echo');
  });

  it('should stop at maxSteps and return partial result', async () => {
    (mockClient.chat as any).mockResolvedValue({
      content: 'Still working...',
      toolCalls: [{ name: 'echo', input: { message: 'loop' } }],
      tokenUsage: { input: 100, output: 50 },
      stopReason: 'tool_use',
    });

    config.maxSteps = 3;
    const loop = new AgentLoop(config, mockClient);
    const result = await loop.run('Infinite task', {
      tenantId: 't1', engagementId: 'e1', agentType: 'test_agent', traceId: 'tr1', memory: {},
    });

    expect(result.steps.length).toBe(3);
    expect(result.success).toBe(false);
  });

  it('should handle tool execution errors gracefully', async () => {
    const failTool: AgentTool = {
      name: 'fail',
      description: 'Always fails',
      inputSchema: {},
      execute: async () => { throw new Error('Tool broke'); },
    };
    config.tools = [failTool];

    (mockClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Trying fail tool.',
        toolCalls: [{ name: 'fail', input: {} }],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'The tool failed. I will report the error. Confidence: 0.3',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const loop = new AgentLoop(config, mockClient);
    const result = await loop.run('Use fail tool', {
      tenantId: 't1', engagementId: 'e1', agentType: 'test_agent', traceId: 'tr1', memory: {},
    });

    expect(result.steps[0].toolResult?.success).toBe(false);
    expect(result.steps[0].toolResult?.error).toContain('Tool broke');
  });

  it('should handle unknown tool calls', async () => {
    (mockClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Calling nonexistent tool.',
        toolCalls: [{ name: 'nonexistent', input: {} }],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Tool not found. Confidence: 0.2',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const loop = new AgentLoop(config, mockClient);
    const result = await loop.run('Use unknown tool', {
      tenantId: 't1', engagementId: 'e1', agentType: 'test_agent', traceId: 'tr1', memory: {},
    });

    expect(result.steps[0].toolResult?.success).toBe(false);
    expect(result.steps[0].toolResult?.error).toContain('Unknown tool');
  });

  it('should extract confidence from response content', async () => {
    (mockClient.chat as any).mockResolvedValueOnce({
      content: 'Task complete. Confidence: 0.92',
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      stopReason: 'end_turn',
    });

    const loop = new AgentLoop(config, mockClient);
    const result = await loop.run('Simple task', {
      tenantId: 't1', engagementId: 'e1', agentType: 'test_agent', traceId: 'tr1', memory: {},
    });

    expect(result.confidence).toBe(0.92);
  });

  it('should track total token usage across steps', async () => {
    (mockClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Step 1.',
        toolCalls: [{ name: 'echo', input: { message: 'a' } }],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Done. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const loop = new AgentLoop(config, mockClient);
    const result = await loop.run('Track tokens', {
      tenantId: 't1', engagementId: 'e1', agentType: 'test_agent', traceId: 'tr1', memory: {},
    });

    expect(result.totalTokens.input).toBe(300);
    expect(result.totalTokens.output).toBe(110);
  });

  // ---- Parallel Tool Calls ----

  it('should execute multiple tool calls in parallel', async () => {
    const addTool: AgentTool = {
      name: 'add',
      description: 'Adds numbers',
      inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      execute: async (input: any) => ({ success: true, data: input.a + input.b }),
    };
    config.tools = [echoTool, addTool];

    (mockClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Running echo and add in parallel.',
        toolCalls: [
          { name: 'echo', input: { message: 'hello' } },
          { name: 'add', input: { a: 2, b: 3 } },
        ],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Both tools completed. Confidence: 0.95',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const loop = new AgentLoop(config, mockClient);
    const result = await loop.run('Run both tools', {
      tenantId: 't1', engagementId: 'e1', agentType: 'test_agent', traceId: 'tr1', memory: {},
    });

    expect(result.success).toBe(true);
    expect(result.steps[0].toolCalls).toHaveLength(2);
    expect(result.steps[0].toolCalls[0].toolName).toBe('echo');
    expect(result.steps[0].toolCalls[0].toolResult.data).toBe('hello');
    expect(result.steps[0].toolCalls[1].toolName).toBe('add');
    expect(result.steps[0].toolCalls[1].toolResult.data).toBe(5);

    // Backward compat: first tool in legacy fields
    expect(result.steps[0].toolName).toBe('echo');
    expect(result.steps[0].toolResult?.data).toBe('hello');
  });

  it('should handle mixed success/failure in parallel tool calls', async () => {
    const failTool: AgentTool = {
      name: 'fail',
      description: 'Always fails',
      inputSchema: {},
      execute: async () => { throw new Error('Broken'); },
    };
    config.tools = [echoTool, failTool];

    (mockClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Running echo and fail in parallel.',
        toolCalls: [
          { name: 'echo', input: { message: 'works' } },
          { name: 'fail', input: {} },
        ],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'One tool worked, one failed. Confidence: 0.6',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const loop = new AgentLoop(config, mockClient);
    const result = await loop.run('Test mixed', {
      tenantId: 't1', engagementId: 'e1', agentType: 'test_agent', traceId: 'tr1', memory: {},
    });

    expect(result.steps[0].toolCalls[0].toolResult.success).toBe(true);
    expect(result.steps[0].toolCalls[1].toolResult.success).toBe(false);
    expect(result.steps[0].toolCalls[1].toolResult.error).toContain('Broken');
  });

  it('should include all parallel tool results in conversation context', async () => {
    config.tools = [echoTool];

    (mockClient.chat as any)
      .mockResolvedValueOnce({
        content: 'Echoing two messages.',
        toolCalls: [
          { name: 'echo', input: { message: 'first' } },
          { name: 'echo', input: { message: 'second' } },
        ],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: 'Both echoed. Confidence: 0.9',
        toolCalls: [],
        tokenUsage: { input: 200, output: 60 },
        stopReason: 'end_turn',
      });

    const loop = new AgentLoop(config, mockClient);
    await loop.run('Echo twice', {
      tenantId: 't1', engagementId: 'e1', agentType: 'test_agent', traceId: 'tr1', memory: {},
    });

    // Verify the second chat call received both tool results
    const secondCallMessages = (mockClient.chat as any).mock.calls[1][0].messages;
    const lastUserMsg = secondCallMessages[secondCallMessages.length - 1];
    expect(lastUserMsg.content).toContain('"first"');
    expect(lastUserMsg.content).toContain('"second"');
  });

  it('should have empty toolCalls array on end_turn steps', async () => {
    (mockClient.chat as any).mockResolvedValueOnce({
      content: 'Done. Confidence: 0.9',
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      stopReason: 'end_turn',
    });

    const loop = new AgentLoop(config, mockClient);
    const result = await loop.run('Quick task', {
      tenantId: 't1', engagementId: 'e1', agentType: 'test_agent', traceId: 'tr1', memory: {},
    });

    expect(result.steps[0].toolCalls).toEqual([]);
    expect(result.steps[0].toolName).toBeNull();
  });
});
