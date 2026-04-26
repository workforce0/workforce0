/**
 * Tests for INTAKE_SYSTEM_PROMPT — load-bearing product copy.
 *
 * @module services/voice-provider/intake-system-prompt.test
 */

import { describe, it, expect } from 'vitest';
import { INTAKE_SYSTEM_PROMPT } from './intake-system-prompt.js';

describe('INTAKE_SYSTEM_PROMPT', () => {
  it('mentions clarifying questions and a summary step', () => {
    expect(INTAKE_SYSTEM_PROMPT).toMatch(/clarifying question/);
    expect(INTAKE_SYSTEM_PROMPT).toMatch(/summari[sz]e/i);
  });
  it('caps at a reasonable length', () => {
    expect(INTAKE_SYSTEM_PROMPT.length).toBeLessThan(4000);
    expect(INTAKE_SYSTEM_PROMPT.length).toBeGreaterThan(200);
  });
});
