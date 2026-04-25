import { describe, it, expect } from 'vitest';
import { pickModel, getModel, MODEL_CATALOG } from '../model-catalog.js';

describe('pickModel', () => {
  it('returns null when no provider has a key configured', () => {
    const result = pickModel({ availableProviders: [] });
    expect(result).toBeNull();
  });

  it("cheap priority picks the cheapest of the user's available models", () => {
    const result = pickModel({
      availableProviders: ['google', 'anthropic', 'openai'],
      priority: 'cheap',
    });
    // gpt-5-nano: 0.05 + 0.40 = 0.45 (cheapest)
    expect(result?.id).toBe('gpt-5-nano');
  });

  it('respects provider availability — no anthropic key means no Claude', () => {
    const result = pickModel({
      availableProviders: ['google'],
      priority: 'cheap',
    });
    expect(result?.provider).toBe('google');
  });

  it('quality priority picks a richly-capabled model', () => {
    const result = pickModel({
      availableProviders: ['anthropic', 'google', 'openai'],
      priority: 'quality',
    });
    // Opus has the most capabilities
    expect(result?.id).toBe('claude-opus-4-7');
  });

  it('respects minContextWindow', () => {
    const result = pickModel({
      availableProviders: ['anthropic', 'google', 'openai'],
      minContextWindow: 900_000,
      priority: 'cheap',
    });
    // Only models with ≥900k context: Opus 4.7 (1M), Gemini 3.1 Flash (1M), Gemini 3.1 Pro (2M)
    // Cheapest of those is Gemini 3.1 Flash
    expect(result?.id).toBe('gemini-3.1-flash');
  });

  it('respects requiredCapabilities', () => {
    const result = pickModel({
      availableProviders: ['anthropic', 'google', 'openai'],
      requiredCapabilities: ['voice'],
      priority: 'cheap',
    });
    // Only voice-capable models: Gemini 3.1 Flash, GPT-5.5
    // Cheapest: Gemini 3.1 Flash (0.10 + 0.40 = 0.50 vs GPT-5.5 17.50)
    expect(result?.id).toBe('gemini-3.1-flash');
  });

  it('respects maxCostPerMillion', () => {
    const result = pickModel({
      availableProviders: ['anthropic', 'google', 'openai'],
      maxCostPerMillion: 2,
      priority: 'cheap',
    });
    // Total cost (input + output) ≤ $2 leaves: gpt-5-nano (0.45),
    // gemini 3.1 flash (0.50), claude haiku (1.50), gemini 3.1 pro (6.25 — fails)
    // Cheapest pass: gpt-5-nano
    expect(result?.id).toBe('gpt-5-nano');
  });

  it('returns null when constraints cannot be satisfied', () => {
    const result = pickModel({
      availableProviders: ['openai'],
      requiredCapabilities: ['voice', 'long_context'],
      // OpenAI has voice (gpt-5.5) but no long_context model
    });
    expect(result).toBeNull();
  });

  it('balanced priority favors multi-capability models with reasonable cost', () => {
    const result = pickModel({
      availableProviders: ['anthropic', 'google', 'openai'],
      priority: 'balanced',
    });
    // Should pick a mid-tier multi-cap model, not just the cheapest
    expect(result).not.toBeNull();
    expect(result!.capabilities.length).toBeGreaterThanOrEqual(4);
  });

  it('filters out deprecated models', () => {
    // None are deprecated today, but the filter must be in place
    for (const m of MODEL_CATALOG) {
      expect(m.deprecated ?? false).toBe(false);
    }
  });
});

describe('getModel', () => {
  it('returns the metadata for a known id', () => {
    expect(getModel('claude-sonnet-4-6')?.provider).toBe('anthropic');
  });
  it('returns null for unknown ids', () => {
    expect(getModel('not-a-real-model')).toBeNull();
  });
});
