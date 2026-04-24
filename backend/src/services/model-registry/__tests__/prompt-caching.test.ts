import { describe, it, expect } from 'vitest';
import {
  applyAnthropicCacheControl,
  readCacheUsage,
  CacheableMessage,
} from '../prompt-caching.js';

describe('applyAnthropicCacheControl', () => {
  it('leaves empty input alone', () => {
    expect(applyAnthropicCacheControl([])).toEqual([]);
  });

  it('never mutates the caller array', () => {
    const input: CacheableMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi.' },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    applyAnthropicCacheControl(input);
    expect(input).toEqual(snapshot);
  });

  it('marks system + last 3 non-system (4 total) when enough messages', () => {
    const msgs: CacheableMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
    ];
    const out = applyAnthropicCacheControl(msgs);
    const systemBlock = (out[0]!.content as any[])[0];
    expect(systemBlock.cache_control).toEqual({ type: 'ephemeral' });
    // Last 3 non-system: indices 3, 4, 5
    [3, 4, 5].forEach((i) => {
      const content = out[i]!.content;
      const last = Array.isArray(content) ? (content as any[]).at(-1) : content;
      expect((last as any).cache_control ?? out[i]!.cache_control).toEqual({ type: 'ephemeral' });
    });
    // index 1 and 2 should NOT be marked
    const a1Content = out[2]!.content;
    const a1Last = Array.isArray(a1Content) ? (a1Content as any[]).at(-1) : a1Content;
    expect((a1Last as any).cache_control).toBeUndefined();
  });

  it('promotes string content to block array', () => {
    const out = applyAnthropicCacheControl([{ role: 'user', content: 'hello' }]);
    expect(Array.isArray(out[0]!.content)).toBe(true);
    expect((out[0]!.content as any[])[0]).toEqual({
      type: 'text',
      text: 'hello',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('marks last block of an array-content message', () => {
    const msg: CacheableMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    };
    const out = applyAnthropicCacheControl([msg]);
    const blocks = out[0]!.content as any[];
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('marks top-level for empty / null content', () => {
    const out = applyAnthropicCacheControl([{ role: 'user', content: '' }]);
    expect(out[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('tool message: only marks when nativeAnthropic=true', () => {
    const [nativeOut] = applyAnthropicCacheControl(
      [{ role: 'tool', content: 'result' }],
      '5m',
      true,
    );
    expect(nativeOut?.cache_control).toEqual({ type: 'ephemeral' });

    const [proxyOut] = applyAnthropicCacheControl(
      [{ role: 'tool', content: 'result' }],
      '5m',
      false,
    );
    expect(proxyOut?.cache_control).toBeUndefined();
  });

  it("attaches ttl='1h' marker when requested", () => {
    const out = applyAnthropicCacheControl(
      [{ role: 'user', content: 'hello' }],
      '1h',
    );
    const block = (out[0]!.content as any[])[0];
    expect(block.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('uses all 4 breakpoints when no system prompt', () => {
    const msgs: CacheableMessage[] = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
    ];
    const out = applyAnthropicCacheControl(msgs);
    // indices 1..4 (last 4 non-system) should be marked; index 0 not
    const idx0Content = out[0]!.content;
    const idx0Last = Array.isArray(idx0Content) ? (idx0Content as any[]).at(-1) : idx0Content;
    expect((idx0Last as any).cache_control).toBeUndefined();
    [1, 2, 3, 4].forEach((i) => {
      const content = out[i]!.content;
      const last = Array.isArray(content) ? (content as any[]).at(-1) : content;
      expect((last as any).cache_control).toEqual({ type: 'ephemeral' });
    });
  });
});

describe('readCacheUsage', () => {
  it('returns zeros for undefined usage', () => {
    const u = readCacheUsage(undefined);
    expect(u).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheHitRatio: 0,
    });
  });

  it('computes cacheHitRatio correctly', () => {
    const u = readCacheUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 700,
      cache_creation_input_tokens: 200,
    });
    expect(u.cacheHitRatio).toBeCloseTo(700 / (100 + 700 + 200), 5);
  });
});
