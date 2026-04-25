/**
 * HardwareDetectService — read host RAM/CPU and recommend a Step 0 tier.
 *
 * @module services/wizard/hardware-detect.service
 */

import os from 'node:os';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'HardwareDetectService' });

export type HardwareTier = 'light' | 'default' | 'heavy';

export interface HardwareProfile {
  totalRamGB: number;
  cpuCores: number;
  availableForLLM_GB: number;
  recommendedTier: HardwareTier;
}

/** RAM budget reserved for OS + Workforce0 base + STT, in GB. */
const RESERVED_GB = 7;

export class HardwareDetectService {
  async detect(): Promise<HardwareProfile> {
    const totalRamGB = Math.round((os.totalmem() / 1e9) * 10) / 10;
    const cpuCores = os.cpus().length;
    const availableForLLM_GB = Math.max(0, totalRamGB - RESERVED_GB);
    const recommendedTier = this.pickTier(availableForLLM_GB);
    const profile: HardwareProfile = {
      totalRamGB,
      cpuCores,
      availableForLLM_GB,
      recommendedTier,
    };
    logger.info(profile, 'Hardware detected');
    return profile;
  }

  pickTier(availableGB: number): HardwareTier {
    if (availableGB < 9) return 'light';
    if (availableGB < 25) return 'default';
    return 'heavy';
  }
}
