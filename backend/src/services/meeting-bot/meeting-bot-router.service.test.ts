import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeetingBotRouter } from './meeting-bot-router.service.js';
import { ManualProvider } from './providers/manual.provider.js';
import type { MeetingBotProvider, ProviderId } from './meeting-bot-provider.types.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

function fakeProvider(id: ProviderId, available: boolean): MeetingBotProvider {
  return {
    id,
    displayName: id,
    isAvailable: vi.fn().mockResolvedValue(available),
    scheduleBot: vi.fn(),
    cancelBot: vi.fn(),
    getTranscript: vi.fn(),
  };
}

interface FakeTenantSettings {
  get(tenantId: string): Promise<{ meetingBotProviderId: ProviderId | null }>;
}

const settings = (preferred: ProviderId | null): FakeTenantSettings => ({
  get: vi.fn().mockResolvedValue({ meetingBotProviderId: preferred }),
});

describe('MeetingBotRouter', () => {
  let manual: ManualProvider;
  beforeEach(() => { manual = new ManualProvider(); });

  it('returns the preferred provider when available', async () => {
    const vexa = fakeProvider('vexa', true);
    const router = new MeetingBotRouter([vexa, manual], settings('vexa'));
    const p = await router.resolveProvider('t1');
    expect(p.id).toBe('vexa');
  });

  it('falls through to manual when preferred (vexa) is unavailable', async () => {
    const vexa = fakeProvider('vexa', false);
    const router = new MeetingBotRouter([vexa, manual], settings('vexa'));
    const p = await router.resolveProvider('t1');
    expect(p.id).toBe('manual');
  });

  it('returns manual as terminal fallback when nothing else is available', async () => {
    const vexa = fakeProvider('vexa', false);
    const router = new MeetingBotRouter([vexa, manual], settings('vexa'));
    const p = await router.resolveProvider('t1');
    expect(p.id).toBe('manual');
  });

  it('uses default order (vexa → manual) when tenant has no preference', async () => {
    const vexa = fakeProvider('vexa', true);
    const router = new MeetingBotRouter([vexa, manual], settings(null));
    const p = await router.resolveProvider('t1');
    expect(p.id).toBe('vexa');
  });

  it('skips a missing provider entry gracefully', async () => {
    // The router is constructed without a vexa provider — only manual is
    // registered. The default order still tries 'vexa' first, finds nothing,
    // and falls through to manual.
    const router = new MeetingBotRouter([manual], settings(null));
    const p = await router.resolveProvider('t1');
    expect(p.id).toBe('manual');
  });
});
