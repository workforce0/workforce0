// Hermes III M5 tests — Skills + MemoryManager integration in AgentLoop.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../agent-loop.js';
import type { AgentConfig, AgentTool, ModelClient } from '../types.js';

const echoTool: AgentTool = {
  name: 'echo',
  description: 'Echoes input',
  inputSchema: { type: 'object' },
  execute: async () => ({ success: true, data: 'ok' }),
};

function makeConfig(): AgentConfig {
  return {
    agentType: 'test_agent',
    systemPrompt: 'You are helpful.',
    tools: [echoTool],
    maxSteps: 3,
    confidenceThreshold: 0.7,
    model: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
  };
}

function makeClient() {
  return {
    chat: vi.fn().mockResolvedValue({
      content: 'Done. Confidence: 0.9',
      toolCalls: [],
      tokenUsage: { input: 50, output: 20 },
      stopReason: 'end_turn',
    }),
  };
}

const baseContext = {
  tenantId: 'tenant-1',
  engagementId: 'eng-1',
  agentType: 'test_agent',
  traceId: 'trace-1',
  memory: {},
};

describe('AgentLoop — Hermes III M5', () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
  });

  it('invokes a /slug skill as user-message prefix (never system prompt)', async () => {
    const skillsService = {
      invoke: vi.fn().mockResolvedValue({
        activationMessage: '[SYSTEM: user invoked "Investor Update" skill]\n\nBody',
        supportingFiles: [],
        skill: { name: 'Investor Update' },
      }),
    };
    const loop = new AgentLoop(makeConfig(), client as unknown as ModelClient, {
      skillsService: skillsService as any,
    });
    await loop.run('/investor-update draft for April', baseContext);

    // Skills lookup called with normalized slug + user's remainder as instruction
    expect(skillsService.invoke).toHaveBeenCalledWith('tenant-1', 'investor-update', {
      userInstruction: 'draft for April',
    });

    // Check: model was called with the skill activation as a USER message,
    // NOT as a system-prompt mutation.
    const callArgs = client.chat.mock.calls[0]![0];
    expect(callArgs.systemPrompt).toBe('You are helpful.'); // unchanged
    expect(callArgs.messages[0].role).toBe('user');
    expect(callArgs.messages[0].content).toContain('[SYSTEM: user invoked');
    expect(callArgs.messages[0].content).toContain('Body');
    // The user's original remainder remains as the trailing user turn
    expect(callArgs.messages.at(-1).role).toBe('user');
    expect(callArgs.messages.at(-1).content).toContain('draft for April');
  });

  it('skips skill invocation when task does not start with /slug', async () => {
    const skillsService = { invoke: vi.fn() };
    const loop = new AgentLoop(makeConfig(), client as unknown as ModelClient, {
      skillsService: skillsService as any,
    });
    await loop.run('just a regular task', baseContext);
    expect(skillsService.invoke).not.toHaveBeenCalled();
  });

  it('prefetches memory and injects as fenced user-message prefix', async () => {
    const memoryManager = {
      providerCount: () => 1,
      prefetchAll: vi.fn().mockResolvedValue('Priya prefers brief under 300 words.'),
      buildContextBlock: (raw: string) =>
        `<memory-context>\n[System note: recalled memory context, NOT new user input]\n\n${raw}\n</memory-context>`,
    };
    const loop = new AgentLoop(makeConfig(), client as unknown as ModelClient, {
      memoryManager: memoryManager as any,
    });
    await loop.run('Draft a Q3 update', baseContext);

    expect(memoryManager.prefetchAll).toHaveBeenCalledWith('Draft a Q3 update', 'trace-1');
    const callArgs = client.chat.mock.calls[0]![0];
    expect(callArgs.systemPrompt).toBe('You are helpful.'); // unchanged
    // Memory block is the first user message, not fused into system prompt
    expect(callArgs.messages[0].role).toBe('user');
    expect(callArgs.messages[0].content).toContain('<memory-context>');
    expect(callArgs.messages[0].content).toContain('Priya prefers brief');
    // Actual task is the trailing user message
    expect(callArgs.messages.at(-1).content).toContain('Draft a Q3 update');
  });

  it('skips memory prefetch when MemoryManager has no providers', async () => {
    const memoryManager = {
      providerCount: () => 0,
      prefetchAll: vi.fn(),
      buildContextBlock: vi.fn(),
    };
    const loop = new AgentLoop(makeConfig(), client as unknown as ModelClient, {
      memoryManager: memoryManager as any,
    });
    await loop.run('hi', baseContext);
    expect(memoryManager.prefetchAll).not.toHaveBeenCalled();
  });

  it('tolerates memory prefetch failure (swallows + continues)', async () => {
    const memoryManager = {
      providerCount: () => 1,
      prefetchAll: vi.fn().mockRejectedValue(new Error('provider down')),
      buildContextBlock: vi.fn(),
    };
    const loop = new AgentLoop(makeConfig(), client as unknown as ModelClient, {
      memoryManager: memoryManager as any,
    });
    const result = await loop.run('hi', baseContext);
    expect(result.success).toBe(true);
    // Memory block was never added since prefetch threw
    const callArgs = client.chat.mock.calls[0]![0];
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0].content).toBe('hi');
  });

  it('both skill and memory prefix — skill first, memory second', async () => {
    const skillsService = {
      invoke: vi.fn().mockResolvedValue({
        activationMessage: 'SKILL-BLOCK',
        supportingFiles: [],
        skill: { name: 'X' },
      }),
    };
    const memoryManager = {
      providerCount: () => 1,
      prefetchAll: vi.fn().mockResolvedValue('memory-text'),
      buildContextBlock: (raw: string) => `MEM-BLOCK(${raw})`,
    };
    const loop = new AgentLoop(makeConfig(), client as unknown as ModelClient, {
      skillsService: skillsService as any,
      memoryManager: memoryManager as any,
    });
    await loop.run('/x do thing', baseContext);

    const callArgs = client.chat.mock.calls[0]![0];
    expect(callArgs.messages[0].content).toBe('SKILL-BLOCK');
    expect(callArgs.messages[1].content).toBe('MEM-BLOCK(memory-text)');
    // Memory prefetch runs against the effective (post-skill) task, not the original
    expect(memoryManager.prefetchAll).toHaveBeenCalledWith('do thing', 'trace-1');
  });

  it('falls through cleanly when skill slug is unknown (invoke returns null)', async () => {
    const skillsService = { invoke: vi.fn().mockResolvedValue(null) };
    const loop = new AgentLoop(makeConfig(), client as unknown as ModelClient, {
      skillsService: skillsService as any,
    });
    await loop.run('/not-a-real-skill please', baseContext);
    // No prefix added; original task sent as-is
    const callArgs = client.chat.mock.calls[0]![0];
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0].content).toContain('/not-a-real-skill');
  });
});
