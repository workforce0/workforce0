import { describe, it, expect, vi } from 'vitest';
import { STTProviderRouter } from './stt-router.service.js';
import type { STTProvider, STTProviderId, TranscribeInput, TranscribeResult } from './stt-provider.types.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

function fake(id: STTProviderId, available: boolean, result?: Partial<TranscribeResult> | Error): STTProvider {
  return {
    id,
    isAvailable: vi.fn().mockResolvedValue(available),
    transcribe: vi.fn().mockImplementation(async () => {
      if (result instanceof Error) throw result;
      return { text: id, segments: [], durationSec: 0, language: 'en', ...(result ?? {}) };
    }),
  };
}

const input: TranscribeInput = { audio: new Uint8Array([1]), filename: 'a.wav' };

describe('STTProviderRouter', () => {
  it('uses first available in chain', async () => {
    const r = new STTProviderRouter([fake('local', true), fake('openai', true)], ['local', 'openai']);
    const out = await r.transcribe(input);
    expect(out.text).toBe('local');
  });

  it('falls through when first is unavailable', async () => {
    const r = new STTProviderRouter([fake('local', false), fake('openai', true)], ['local', 'openai']);
    const out = await r.transcribe(input);
    expect(out.text).toBe('openai');
  });

  it('falls through when first throws', async () => {
    const r = new STTProviderRouter([fake('local', true, new Error('boom')), fake('openai', true)], ['local', 'openai']);
    const out = await r.transcribe(input);
    expect(out.text).toBe('openai');
  });

  it('throws when chain exhausted', async () => {
    const r = new STTProviderRouter([fake('local', false), fake('openai', false)], ['local', 'openai']);
    await expect(r.transcribe(input)).rejects.toThrow(/All STT providers exhausted/);
  });

  it('skips ids not registered', async () => {
    const r = new STTProviderRouter([fake('openai', true)], ['local', 'openai']);
    const out = await r.transcribe(input);
    expect(out.text).toBe('openai');
  });
});
