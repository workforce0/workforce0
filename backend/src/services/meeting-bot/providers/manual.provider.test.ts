import { describe, it, expect } from 'vitest';
import { ManualProvider } from './manual.provider.js';
import { ProviderNotSchedulableError } from '../meeting-bot-provider.types.js';

describe('ManualProvider', () => {
  const provider = new ManualProvider();

  it('reports id "manual" and a display name', () => {
    expect(provider.id).toBe('manual');
    expect(provider.displayName.length).toBeGreaterThan(0);
  });

  it('is always available', async () => {
    await expect(provider.isAvailable()).resolves.toBe(true);
  });

  it('throws ProviderNotSchedulableError on scheduleBot', async () => {
    await expect(
      provider.scheduleBot({
        meetingUrl: 'https://meet.google.com/x',
        meetingId: 'm1',
        tenantId: 't1',
      }),
    ).rejects.toThrow(ProviderNotSchedulableError);
  });

  it('cancelBot is a no-op', async () => {
    await expect(provider.cancelBot('any-id')).resolves.toBeUndefined();
  });

  it('returns null transcript', async () => {
    await expect(provider.getTranscript('any-id')).resolves.toBeNull();
  });
});
