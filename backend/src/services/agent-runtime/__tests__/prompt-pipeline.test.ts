import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromptPipeline } from '../prompt-pipeline.js';
import type { ModelClient } from '../types.js';

function mockClient(response?: Partial<Awaited<ReturnType<ModelClient['chat']>>>) {
  return {
    chat: vi.fn().mockResolvedValue({
      content: response?.content ?? 'ok',
      toolCalls: response?.toolCalls ?? [],
      tokenUsage: response?.tokenUsage ?? { input: 10, output: 5 },
      stopReason: response?.stopReason ?? 'end_turn',
    }),
  };
}

const baseParams = {
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You help.',
  messages: [{ role: 'user', content: 'Hello' }],
  tools: [],
};

describe('PromptPipeline', () => {
  let raw: ReturnType<typeof mockClient>;

  beforeEach(() => {
    raw = mockClient();
  });

  it('passes through unchanged when no options set', async () => {
    const pipeline = new PromptPipeline({ redact: false });
    const wrapped = pipeline.wrap(raw);
    await wrapped.chat(baseParams);
    expect(raw.chat).toHaveBeenCalledWith(baseParams);
  });

  it('redacts message content by default', async () => {
    const pipeline = new PromptPipeline();
    const wrapped = pipeline.wrap(raw);
    await wrapped.chat({
      ...baseParams,
      messages: [{ role: 'user', content: 'Email priya@acme.com please' }],
    });
    const call = raw.chat.mock.calls[0]![0];
    expect(call.messages[0].content).toContain('[REDACTED:EMAIL]');
  });

  it('honors redactSkip', async () => {
    const pipeline = new PromptPipeline({ redactSkip: ['email'] });
    const wrapped = pipeline.wrap(raw);
    await wrapped.chat({
      ...baseParams,
      messages: [{ role: 'user', content: 'priya@acme.com' }],
    });
    expect(raw.chat.mock.calls[0]![0].messages[0].content).toContain('priya@acme.com');
  });

  it('records trajectory turn_started + turn_completed on success', async () => {
    const trajectory = { record: vi.fn().mockResolvedValue(undefined) };
    const pipeline = new PromptPipeline({
      redact: false,
      trajectory: trajectory as any,
    });
    const wrapped = pipeline.wrap(raw);
    pipeline.setTurnContext(raw, {
      tenantId: 't1',
      sessionId: 's1',
      agentName: 'ba',
    });
    await wrapped.chat(baseParams);
    expect(trajectory.record).toHaveBeenCalledTimes(2);
    expect(trajectory.record.mock.calls[0]![0].type).toBe('turn_started');
    expect(trajectory.record.mock.calls[1]![0].type).toBe('turn_completed');
  });

  it('records trajectory turn_failed when chat throws', async () => {
    raw.chat.mockRejectedValue(new Error('provider down'));
    const trajectory = { record: vi.fn().mockResolvedValue(undefined) };
    const pipeline = new PromptPipeline({
      redact: false,
      trajectory: trajectory as any,
    });
    const wrapped = pipeline.wrap(raw);
    pipeline.setTurnContext(raw, { tenantId: 't1', sessionId: 's1', agentName: 'ba' });
    await expect(wrapped.chat(baseParams)).rejects.toThrow('provider down');
    const types = trajectory.record.mock.calls.map((c) => c[0].type);
    expect(types).toContain('turn_started');
    expect(types).toContain('turn_failed');
  });

  it('does not record trajectory without setTurnContext', async () => {
    const trajectory = { record: vi.fn().mockResolvedValue(undefined) };
    const pipeline = new PromptPipeline({
      redact: false,
      trajectory: trajectory as any,
    });
    const wrapped = pipeline.wrap(raw);
    await wrapped.chat(baseParams); // no setTurnContext
    expect(trajectory.record).not.toHaveBeenCalled();
  });

  it('anthropicCache option forwards (params still reach underlying client)', async () => {
    const pipeline = new PromptPipeline({ redact: false, anthropicCache: true });
    const wrapped = pipeline.wrap(raw);
    await wrapped.chat(baseParams);
    const call = raw.chat.mock.calls[0]![0];
    expect(call.systemPrompt).toBe('You help.');
    // At least one message survived through the pipeline
    expect(call.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('propagates response unchanged', async () => {
    const pipeline = new PromptPipeline({ redact: false });
    const wrapped = pipeline.wrap(raw);
    const response = await wrapped.chat(baseParams);
    expect(response.content).toBe('ok');
    expect(response.tokenUsage).toEqual({ input: 10, output: 5 });
  });
});
