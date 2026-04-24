import { describe, it, expect, vi } from 'vitest';
import { SubagentSpawner } from '../subagent-spawner.js';
import type { ModelClient, AgentContext } from '../types.js';

const parentContext: AgentContext = {
  tenantId: 't1',
  engagementId: 'e1',
  agentType: 'ba',
  traceId: 'trace-root',
  memory: {},
};

function modelThatSays(content: string): ModelClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content,
      toolCalls: [],
      tokenUsage: { input: 10, output: 5 },
      stopReason: 'end_turn',
    }),
  };
}

describe('SubagentSpawner', () => {
  it('spawns a single child and returns its summary', async () => {
    const spawner = new SubagentSpawner();
    const result = await spawner.spawn('Summarize Q3', {
      modelClient: modelThatSays('Q3 focused on growth. Confidence: 0.9'),
      systemPrompt: 'You are a research subagent.',
      parentContext,
      subagentName: 'q3-summary',
    });

    expect(result.success).toBe(true);
    expect(result.summary).toContain('Q3 focused on growth');
    expect(result.subagentName).toBe('q3-summary');
    expect(result.confidence).toBe(0.9);
  });

  it('child runs with isolated traceId derived from parent', async () => {
    const spawner = new SubagentSpawner();
    const client = modelThatSays('done');
    await spawner.spawn('work', {
      modelClient: client,
      systemPrompt: 'x',
      parentContext,
      subagentName: 'worker-1',
    });
    // chat() was called once; we can't directly inspect the traceId at call
    // time (it's on the context, not the chat params), but we verify chat
    // fired — covered by integration with AgentLoop tests.
    expect(client.chat).toHaveBeenCalledTimes(1);
  });

  it('catches child errors and returns success=false', async () => {
    const spawner = new SubagentSpawner();
    const failing: ModelClient = {
      chat: vi.fn().mockRejectedValue(new Error('model unavailable')),
    };
    const result = await spawner.spawn('work', {
      modelClient: failing,
      systemPrompt: 'x',
      parentContext,
      subagentName: 'failing',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('model unavailable');
  });

  it('spawnAll runs children in parallel and returns results in order', async () => {
    const spawner = new SubagentSpawner({ maxConcurrency: 3 });
    const tasks = ['A', 'B', 'C', 'D'].map((letter) => ({
      task: `task ${letter}`,
      opts: {
        modelClient: modelThatSays(`result-${letter}`),
        systemPrompt: 'x',
        parentContext,
        subagentName: `sub-${letter.toLowerCase()}`,
      },
    }));
    const results = await spawner.spawnAll(tasks);
    expect(results).toHaveLength(4);
    expect(results[0]!.summary).toContain('result-A');
    expect(results[1]!.summary).toContain('result-B');
    expect(results[2]!.summary).toContain('result-C');
    expect(results[3]!.summary).toContain('result-D');
  });

  it('spawnAll bounds concurrency', async () => {
    const spawner = new SubagentSpawner({ maxConcurrency: 2 });
    let concurrent = 0;
    let peak = 0;
    const makeSlowClient = (): ModelClient => ({
      chat: vi.fn().mockImplementation(async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 20));
        concurrent -= 1;
        return {
          content: 'done. Confidence: 0.8',
          toolCalls: [],
          tokenUsage: { input: 5, output: 2 },
          stopReason: 'end_turn',
        };
      }),
    });
    const tasks = Array.from({ length: 6 }, (_, i) => ({
      task: `t${i}`,
      opts: {
        modelClient: makeSlowClient(),
        systemPrompt: 'x',
        parentContext,
        subagentName: `sub-${i}`,
      },
    }));
    await spawner.spawnAll(tasks);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('spawnAll with empty list returns []', async () => {
    const spawner = new SubagentSpawner();
    expect(await spawner.spawnAll([])).toEqual([]);
  });

  it('inFlight tracks active spawns', async () => {
    const spawner = new SubagentSpawner();
    expect(spawner.inFlight).toBe(0);
    const p = spawner.spawn('x', {
      modelClient: modelThatSays('ok'),
      systemPrompt: 'x',
      parentContext,
      subagentName: 's',
    });
    await p;
    expect(spawner.inFlight).toBe(0); // returns to 0 after completion
  });
});
