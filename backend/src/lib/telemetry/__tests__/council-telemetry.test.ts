import { describe, it, expect, vi, beforeEach } from 'vitest';

const { infoSpy } = vi.hoisted(() => ({ infoSpy: vi.fn() }));

vi.mock('../../logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: infoSpy,
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { emitCouncilSessionComplete } from '../council-telemetry.js';

describe('emitCouncilSessionComplete', () => {
  beforeEach(() => infoSpy.mockReset());

  it('logs at info with the event shape', () => {
    emitCouncilSessionComplete({
      agentType: 'ba_agent',
      rounds: 1,
      exitReason: 'threshold',
      totalLatencyMs: 567,
      totalCostUsd: 0.12,
      primaryProvider: 'anthropic',
      primaryModelId: 'claude-opus-4-7',
      reviewerCount: 2,
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'ba_agent',
        exitReason: 'threshold',
        rounds: 1,
        reviewerCount: 2,
      }),
      'council.session_complete',
    );
  });

  it('accepts all defined exit reasons', () => {
    const reasons = ['threshold', 'max_rounds', 'first_pass', 'rejected', 'error'] as const;
    for (const exitReason of reasons) {
      emitCouncilSessionComplete({
        agentType: 'qa_agent', rounds: 0, exitReason,
        totalLatencyMs: 0, totalCostUsd: 0,
        primaryProvider: 'anthropic', primaryModelId: 'claude-opus-4-7', reviewerCount: 0,
      });
    }
    expect(infoSpy).toHaveBeenCalledTimes(reasons.length);
  });
});
