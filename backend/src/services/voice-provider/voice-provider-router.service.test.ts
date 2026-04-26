/**
 * Tests for VoiceProviderRouter — picks a provider per tenant with fallback.
 *
 * @module services/voice-provider/voice-provider-router.service.test
 */

import { describe, it, expect, vi } from 'vitest';
import { VoiceProviderRouter } from './voice-provider-router.service.js';
import type { VoiceProvider, VoiceProviderId } from './voice-provider.types.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const fake = (id: VoiceProviderId, available: boolean): VoiceProvider => ({
  id,
  isAvailable: vi.fn().mockResolvedValue(available),
  startSession: vi.fn(),
});

const settings = (preferred: VoiceProviderId | null) => ({
  get: vi.fn().mockResolvedValue({ voiceProviderId: preferred }),
});

describe('VoiceProviderRouter', () => {
  it('uses preferred when available', async () => {
    const r = new VoiceProviderRouter(
      [fake('pipecat', true), fake('gemini', true), fake('openai', true)],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings('gemini') as any,
    );
    const p = await r.resolveProvider('t1');
    expect(p?.id).toBe('gemini');
  });

  it('falls through default order when preferred is unavailable', async () => {
    // DEFAULT_ORDER is `['pipecat', 'gemini', 'openai']`. With preferred
    // `gemini` unavailable, the router tries pipecat next (default first),
    // then would fall through to openai. pipecat is up, so it wins.
    const r = new VoiceProviderRouter(
      [fake('pipecat', true), fake('gemini', false), fake('openai', true)],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings('gemini') as any,
    );
    const p = await r.resolveProvider('t1');
    expect(p?.id).toBe('pipecat');
  });

  it('falls through to gemini when pipecat is unavailable', async () => {
    // Practical safety net: in production di-container only registers pipecat,
    // so this case is only reachable if a future wiring registers gemini too.
    // The router's behaviour is what matters here — DEFAULT_ORDER skips
    // unavailable entries.
    const r = new VoiceProviderRouter(
      [fake('pipecat', false), fake('gemini', true), fake('openai', true)],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings(null) as any,
    );
    const p = await r.resolveProvider('t1');
    expect(p?.id).toBe('gemini');
  });

  it('silently skips IDs in DEFAULT_ORDER that are not registered', async () => {
    // Mirrors the production di-container today: only pipecat is registered.
    // gemini/openai are in DEFAULT_ORDER conceptually but the router skips
    // them because `providers.get('gemini')` returns undefined.
    const r = new VoiceProviderRouter(
      [fake('pipecat', true)],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings(null) as any,
    );
    const p = await r.resolveProvider('t1');
    expect(p?.id).toBe('pipecat');
  });

  it('returns null when all unavailable', async () => {
    const r = new VoiceProviderRouter(
      [fake('pipecat', false), fake('gemini', false), fake('openai', false)],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings(null) as any,
    );
    const p = await r.resolveProvider('t1');
    expect(p).toBeNull();
  });
});
