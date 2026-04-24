import { describe, it, expect, vi } from 'vitest';
import { compressIfNeeded, estimateTokens } from '../context-compressor.js';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('approximates 1 token per 4 chars of string content', () => {
    expect(estimateTokens([{ role: 'user', content: 'a'.repeat(40) }])).toBe(10);
  });

  it('walks array content via text blocks', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text', text: 'hello' }, // 5 / 4 = 2
        { type: 'text', text: 'world' }, // 5 / 4 = 2
      ],
    };
    // joined with space, so 11 chars → 3 tokens
    expect(estimateTokens([msg])).toBe(3);
  });
});

describe('compressIfNeeded', () => {
  const opts = { ceilingTokens: 100, targetTokens: 50, preserveTail: 2 };

  it('returns original when under the ceiling', async () => {
    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'short' },
    ];
    const summarize = vi.fn();
    const result = await compressIfNeeded(msgs, summarize, opts);
    expect(result.messages).toBe(msgs);
    expect(result.tokensSaved).toBe(0);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('returns original when conversation is already ≤ preserveTail', async () => {
    const msgs = [
      { role: 'user', content: 'a'.repeat(500) },
      { role: 'assistant', content: 'b'.repeat(500) },
    ];
    const summarize = vi.fn();
    const result = await compressIfNeeded(msgs, summarize, opts);
    expect(result.tokensSaved).toBe(0);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('compresses the middle, preserves system + tail', async () => {
    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'x'.repeat(200) },
      { role: 'assistant', content: 'y'.repeat(200) },
      { role: 'user', content: 'recent user' },
      { role: 'assistant', content: 'recent asst' },
    ];
    const summarize = vi.fn(async () => 'Earlier conversation covered: XYZ.');
    const result = await compressIfNeeded(msgs, summarize, opts);
    expect(summarize).toHaveBeenCalledOnce();

    // Output shape: [system, compressed-summary, recent user, recent asst]
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0]!.role).toBe('system');
    expect(result.messages[1]!.role).toBe('assistant');
    const summaryBlock = (result.messages[1]!.content as Array<{ text: string }>)[0]!;
    expect(summaryBlock.text).toContain('[COMPRESSED:');
    expect(summaryBlock.text).toContain('Earlier conversation covered: XYZ.');
    expect(result.messages[3]!.content).toBe('recent asst');
    expect(result.tokensSaved).toBeGreaterThan(0);
  });

  it('works with no system prompt', async () => {
    const msgs = [
      { role: 'user', content: 'x'.repeat(400) },
      { role: 'assistant', content: 'y'.repeat(400) },
      { role: 'user', content: 'tail1' },
      { role: 'assistant', content: 'tail2' },
    ];
    const summarize = async () => 'summary';
    const result = await compressIfNeeded(msgs, summarize, opts);
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]!.role).toBe('assistant');
    expect(result.messages[2]!.content).toBe('tail2');
  });
});
