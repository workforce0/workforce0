/**
 * Integration test: STTProviderRouter falls through correctly across
 * available/unavailable providers and exception paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STTProviderRouter } from '../../services/stt/stt-router.service.js';
import type { STTProvider, STTProviderId, TranscribeInput } from '../../services/stt/stt-provider.types.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

function fake(id: STTProviderId, available: boolean, opts?: { throws?: boolean; text?: string }): STTProvider {
  return {
    id,
    isAvailable: vi.fn().mockResolvedValue(available),
    transcribe: vi.fn().mockImplementation(async () => {
      if (opts?.throws) throw new Error(`${id} exploded`);
      return { text: opts?.text ?? id, segments: [], durationSec: 0, language: 'en' };
    }),
  };
}

const input: TranscribeInput = { audio: new Uint8Array([1, 2, 3]), filename: 'a.wav' };

describe('integration: STTProviderRouter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses local when available', async () => {
    const router = new STTProviderRouter([fake('local', true), fake('openai', true)], ['local', 'openai']);
    const out = await router.transcribe(input);
    expect(out.text).toBe('local');
  });

  it('falls through when local is unavailable', async () => {
    const router = new STTProviderRouter([fake('local', false), fake('openai', true)], ['local', 'openai']);
    const out = await router.transcribe(input);
    expect(out.text).toBe('openai');
  });

  it('falls through when local throws', async () => {
    const router = new STTProviderRouter([fake('local', true, { throws: true }), fake('openai', true)], ['local', 'openai']);
    const out = await router.transcribe(input);
    expect(out.text).toBe('openai');
  });

  it('throws after exhausting chain', async () => {
    const router = new STTProviderRouter([fake('local', false), fake('openai', false)], ['local', 'openai']);
    await expect(router.transcribe(input)).rejects.toThrow(/All STT providers exhausted/);
  });
});
