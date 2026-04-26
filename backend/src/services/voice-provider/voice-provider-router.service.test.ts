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

  it('falls through default order (pipecat) when preferred is unavailable', async () => {
    // DEFAULT_ORDER currently only contains `pipecat` — gemini/openai are
    // explicitly excluded from the default rotation until their session
    // adapters emit transcript completion. So when the preferred provider
    // (`gemini` here) is unavailable AND it is not in the default chain, the
    // router falls through to pipecat.
    const r = new VoiceProviderRouter(
      [fake('pipecat', true), fake('gemini', false), fake('openai', true)],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings('gemini') as any,
    );
    const p = await r.resolveProvider('t1');
    expect(p?.id).toBe('pipecat');
  });

  it('returns null when preferred is unavailable AND default chain is unavailable', async () => {
    // With pipecat-only DEFAULT_ORDER, an unavailable pipecat means no
    // provider is reachable even if gemini/openai are technically up — they
    // are not part of the default rotation.
    const r = new VoiceProviderRouter(
      [fake('pipecat', false), fake('gemini', true), fake('openai', true)],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings(null) as any,
    );
    const p = await r.resolveProvider('t1');
    expect(p).toBeNull();
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
