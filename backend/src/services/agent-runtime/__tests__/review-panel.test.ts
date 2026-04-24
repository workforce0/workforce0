import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewPanel } from '../review-panel.js';
import type { ModelClient } from '../types.js';

describe('ReviewPanel', () => {
  let mockClient: ModelClient;
  let modelClients: Map<string, ModelClient>;

  const defaultReviewers = [
    { provider: 'anthropic', modelId: 'claude-sonnet-4' },
    { provider: 'openai', modelId: 'gpt-4o' },
    { provider: 'google', modelId: 'gemini-2.0-flash' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      chat: vi.fn().mockResolvedValue({
        content: 'Looks good. Confidence: 0.85\nFeedback: Solid output with minor issues.',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn' as const,
      }),
    };

    modelClients = new Map<string, ModelClient>();
    modelClients.set('anthropic', mockClient);
    modelClients.set('openai', mockClient);
    modelClients.set('google', mockClient);
  });

  it('should auto-pass when confidence >= 0.9 (skipped review)', async () => {
    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'High quality output',
      confidence: 0.95,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.8,
      context: 'Some context',
    });

    expect(result.approved).toBe(true);
    expect(result.skippedReview).toBe(true);
    expect(result.finalConfidence).toBe(0.95);
    expect(result.reviews).toHaveLength(0);
    expect(result.engagementPaused).toBe(false);
    expect(result.requiresHumanApproval).toBe(false);
    // No reviewer should have been called
    expect(mockClient.chat).not.toHaveBeenCalled();
  });

  it('should use single reviewer when confidence is between 0.7 and 0.89', async () => {
    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Medium quality output',
      confidence: 0.8,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.7,
      context: 'Some context',
    });

    expect(result.skippedReview).toBe(false);
    // Only first reviewer should have been consulted
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0].provider).toBe('anthropic');
    expect(mockClient.chat).toHaveBeenCalledTimes(1);
  });

  it('should use full panel when confidence < 0.7', async () => {
    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Low quality output',
      confidence: 0.5,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.7,
      context: 'Some context',
    });

    expect(result.skippedReview).toBe(false);
    // All three reviewers should have been consulted
    expect(result.reviews).toHaveLength(3);
    expect(result.reviews[0].provider).toBe('anthropic');
    expect(result.reviews[1].provider).toBe('openai');
    expect(result.reviews[2].provider).toBe('google');
    expect(mockClient.chat).toHaveBeenCalledTimes(3);
  });

  it('should approve when final confidence meets threshold', async () => {
    // All reviewers return confidence 0.85
    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Decent output',
      confidence: 0.5,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.8,
      context: 'Some context',
    });

    // Average of 0.85 + 0.85 + 0.85 = 0.85, which meets the 0.8 threshold
    expect(result.approved).toBe(true);
    expect(result.finalConfidence).toBe(0.85);
  });

  it('should reject when final confidence is below threshold', async () => {
    // Override mock to return low confidence
    (mockClient.chat as any).mockResolvedValue({
      content: 'Poor quality. Confidence: 0.4\nFeedback: Missing key details.',
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      stopReason: 'end_turn' as const,
    });

    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Poor output',
      confidence: 0.5,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.7,
      context: 'Some context',
    });

    // Average of 0.4 + 0.4 + 0.4 = 0.4, which is below the 0.7 threshold
    expect(result.approved).toBe(false);
    expect(result.finalConfidence).toBeCloseTo(0.4, 10);
    expect(result.reviews[0].feedback).toBe('Missing key details.');
  });

  it('should handle reviewer failures gracefully', async () => {
    // Make openai client fail
    const failingClient: ModelClient = {
      chat: vi.fn().mockRejectedValue(new Error('API timeout')),
    };
    modelClients.set('openai', failingClient);

    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Some output',
      confidence: 0.5,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.5,
      context: 'Some context',
    });

    // Should still have 3 reviews (failed ones get 0 confidence)
    expect(result.reviews).toHaveLength(3);
    const openaiReview = result.reviews.find((r: any) => r.provider === 'openai');
    expect(openaiReview?.confidence).toBe(0);
    expect(openaiReview?.feedback).toBe('Reviewer failed to respond');
  });

  it('should extract feedback from reviewer response', async () => {
    (mockClient.chat as any).mockResolvedValue({
      content: 'Analysis complete.\nConfidence: 0.75\nFeedback: The output covers the main points but lacks detail on edge cases.',
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      stopReason: 'end_turn' as const,
    });

    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Some output',
      confidence: 0.8,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.7,
      context: 'Some context',
    });

    expect(result.reviews[0].confidence).toBe(0.75);
    expect(result.reviews[0].feedback).toBe(
      'The output covers the main points but lacks detail on edge cases.',
    );
  });

  it('should handle exact boundary at 0.9 as auto-pass', async () => {
    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Boundary output',
      confidence: 0.9,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.8,
      context: 'Some context',
    });

    expect(result.approved).toBe(true);
    expect(result.skippedReview).toBe(true);
    expect(mockClient.chat).not.toHaveBeenCalled();
  });

  it('should handle exact boundary at 0.7 as single reviewer', async () => {
    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Boundary output',
      confidence: 0.7,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.7,
      context: 'Some context',
    });

    expect(result.skippedReview).toBe(false);
    expect(result.reviews).toHaveLength(1);
    expect(mockClient.chat).toHaveBeenCalledTimes(1);
  });

  it('should set engagementPaused when all reviewers below 50%', async () => {
    // All reviewers return confidence 0.3
    (mockClient.chat as any).mockResolvedValue({
      content: 'Very poor quality. Confidence: 0.30\nFeedback: Output is fundamentally flawed.',
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      stopReason: 'end_turn' as const,
    });

    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Terrible output',
      confidence: 0.3,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.7,
      context: 'Some context',
    });

    expect(result.approved).toBe(false);
    expect(result.engagementPaused).toBe(true);
    expect(result.pauseReason).toBe('All reviewers below 50% confidence threshold');
    expect(result.requiresHumanApproval).toBe(false);
    expect(result.finalConfidence).toBeCloseTo(0.3, 10);
  });

  it('should set requiresHumanApproval when confidence below 70% but not all below 50%', async () => {
    // Create separate clients with different confidence levels
    const client65: ModelClient = {
      chat: vi.fn().mockResolvedValue({
        content: 'Mediocre. Confidence: 0.65\nFeedback: Needs improvement.',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn' as const,
      }),
    };
    const client55: ModelClient = {
      chat: vi.fn().mockResolvedValue({
        content: 'Below average. Confidence: 0.55\nFeedback: Several issues found.',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn' as const,
      }),
    };

    modelClients.set('anthropic', client65);
    modelClients.set('openai', client55);
    modelClients.set('google', client55);

    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Mediocre output',
      confidence: 0.5,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.7,
      context: 'Some context',
    });

    // Average: (0.65 + 0.55 + 0.55) / 3 ≈ 0.583
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.engagementPaused).toBe(false);
    expect(result.approved).toBe(false);
  });

  it('should not set engagementPaused when only some reviewers below 50%', async () => {
    // Primary returns 0.6, one returns 0.3, one returns 0.55
    const client60: ModelClient = {
      chat: vi.fn().mockResolvedValue({
        content: 'OK. Confidence: 0.60\nFeedback: Acceptable but not great.',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn' as const,
      }),
    };
    const client30: ModelClient = {
      chat: vi.fn().mockResolvedValue({
        content: 'Poor. Confidence: 0.30\nFeedback: Major issues.',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn' as const,
      }),
    };
    const client55: ModelClient = {
      chat: vi.fn().mockResolvedValue({
        content: 'Below average. Confidence: 0.55\nFeedback: Needs work.',
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        stopReason: 'end_turn' as const,
      }),
    };

    modelClients.set('anthropic', client60);
    modelClients.set('openai', client30);
    modelClients.set('google', client55);

    const panel = new ReviewPanel(modelClients);

    const result = await panel.review({
      agentOutput: 'Mixed quality output',
      confidence: 0.5,
      reviewers: defaultReviewers,
      confidenceThreshold: 0.7,
      context: 'Some context',
    });

    // Not all below 50% (0.60 and 0.55 are >= 0.5), so no pause
    expect(result.engagementPaused).toBe(false);
    // Average: (0.60 + 0.30 + 0.55) / 3 ≈ 0.483, which is < 0.7
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.approved).toBe(false);
  });
});
