import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HardwareDetectService } from './hardware-detect.service.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('HardwareDetectService', () => {
  let service: HardwareDetectService;
  beforeEach(() => {
    service = new HardwareDetectService();
  });

  it('returns total RAM, CPU count, and recommended tier', async () => {
    const profile = await service.detect();
    expect(profile.totalRamGB).toBeGreaterThan(0);
    expect(profile.cpuCores).toBeGreaterThan(0);
    expect(profile.availableForLLM_GB).toBe(Math.max(0, profile.totalRamGB - 7));
    expect(['light', 'default', 'heavy']).toContain(profile.recommendedTier);
  });

  it('classifies <9 GB available as light tier', () => {
    expect(service.pickTier(8)).toBe('light');
    expect(service.pickTier(0)).toBe('light');
  });

  it('classifies 9-25 GB available as default tier', () => {
    expect(service.pickTier(9)).toBe('default');
    expect(service.pickTier(20)).toBe('default');
    expect(service.pickTier(24)).toBe('default');
  });

  it('classifies 25 GB+ available as heavy tier', () => {
    expect(service.pickTier(25)).toBe('heavy');
    expect(service.pickTier(64)).toBe('heavy');
  });
});
