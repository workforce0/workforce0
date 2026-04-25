/**
 * =============================================================================
 * MODEL CATALOG + SMART ROUTING
 * =============================================================================
 *
 * Ported (algorithm only) from NousResearch/hermes-agent
 * `agent/models_dev.py` + `agent/model_metadata.py` + `agent/smart_model_routing.py`.
 *
 * Instead of hardcoding model names per task, keep a small capability catalog
 * and let callers ask for "the cheapest model that can reason with 128k
 * context" or "the best code-generation model available." Updates to the
 * catalog (new model releases, price changes) don't require code changes
 * elsewhere.
 *
 * Design note: we deliberately don't fetch from models.dev at runtime here.
 * The hardcoded catalog is a sane v1 — a future iteration can add a
 * background fetcher that hydrates from models.dev and falls back to this.
 *
 * @module services/model-registry/model-catalog
 */

export type Provider = 'anthropic' | 'google' | 'openai';

export type ModelCapability =
  | 'reasoning'       // strong chain-of-thought / planning
  | 'code_generation' // strong at writing code
  | 'code_review'     // strong at reviewing / critique
  | 'fast'            // sub-second latency
  | 'cheap'           // <$1 per million input tokens
  | 'long_context'    // ≥200k context window
  | 'vision'          // multimodal (images)
  | 'tool_use'        // reliable structured tool calls
  | 'voice';          // realtime audio

export interface ModelMetadata {
  id: string;             // provider-scoped model id (e.g. "claude-sonnet-4-6")
  provider: Provider;
  displayName: string;
  contextWindow: number;  // tokens
  maxOutput: number;      // tokens
  inputPricePerMillion: number;  // USD
  outputPricePerMillion: number; // USD
  capabilities: ModelCapability[];
  deprecated?: boolean;
}

/**
 * Source-of-truth catalog. Update when new models ship.
 *
 * Prices & context are April 2026 published rates. Capabilities are
 * curated — based on published benchmarks, not a single test run.
 */
export const MODEL_CATALOG: ModelMetadata[] = [
  // ─── Anthropic ────────────────────────────────────────────────────────────
  {
    id: 'claude-opus-4-7',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.7 (1M context)',
    contextWindow: 1_000_000,
    maxOutput: 16_000,
    inputPricePerMillion: 15,
    outputPricePerMillion: 75,
    capabilities: ['reasoning', 'code_generation', 'code_review', 'long_context', 'tool_use', 'vision'],
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 200_000,
    maxOutput: 8_000,
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    capabilities: ['reasoning', 'code_generation', 'code_review', 'tool_use', 'vision'],
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    maxOutput: 4_000,
    inputPricePerMillion: 0.8,
    outputPricePerMillion: 4,
    capabilities: ['fast', 'cheap', 'code_generation', 'tool_use'],
  },
  // ─── Google ───────────────────────────────────────────────────────────────
  {
    id: 'gemini-3.1-flash',
    provider: 'google',
    displayName: 'Gemini 3.1 Flash',
    contextWindow: 1_000_000,
    maxOutput: 8_000,
    inputPricePerMillion: 0.10,
    outputPricePerMillion: 0.40,
    capabilities: ['fast', 'cheap', 'long_context', 'tool_use', 'vision', 'voice'],
  },
  {
    id: 'gemini-3.1-pro',
    provider: 'google',
    displayName: 'Gemini 3.1 Pro',
    contextWindow: 2_000_000,
    maxOutput: 8_000,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 5,
    capabilities: ['reasoning', 'long_context', 'tool_use', 'vision', 'code_generation'],
  },
  // ─── OpenAI ──────────────────────────────────────────────────────────────
  {
    id: 'o3',
    provider: 'openai',
    displayName: 'OpenAI o3',
    contextWindow: 200_000,
    maxOutput: 100_000,
    inputPricePerMillion: 2,
    outputPricePerMillion: 8,
    capabilities: ['reasoning', 'code_review'],
  },
  {
    id: 'gpt-5.5',
    provider: 'openai',
    displayName: 'GPT-5.5',
    contextWindow: 272_000,
    maxOutput: 16_000,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 15,
    capabilities: ['tool_use', 'vision', 'voice', 'code_generation'],
  },
  {
    id: 'gpt-5-nano',
    provider: 'openai',
    displayName: 'GPT-5 nano',
    contextWindow: 128_000,
    maxOutput: 16_000,
    inputPricePerMillion: 0.05,
    outputPricePerMillion: 0.40,
    capabilities: ['fast', 'cheap', 'tool_use', 'vision'],
  },
];

export interface RoutingRequirements {
  /** Which provider(s) the user actually has keys configured for. */
  availableProviders: Provider[];
  /** Features the task requires. Model must have ALL of these. */
  requiredCapabilities?: ModelCapability[];
  /** Upper bound on input+output per-million cost. */
  maxCostPerMillion?: number;
  /** Minimum context window needed. */
  minContextWindow?: number;
  /** Cost vs quality lever. 'cheap' picks the cheapest match; 'quality' picks the highest-cap match. */
  priority?: 'cheap' | 'quality' | 'balanced';
}

/**
 * Pick a model for the task.
 *
 * Returns null when no model in the catalog satisfies the constraints and
 * the user's available providers — callers should fall back to a provider
 * default or fail loudly.
 */
export function pickModel(req: RoutingRequirements): ModelMetadata | null {
  const {
    availableProviders,
    requiredCapabilities = [],
    maxCostPerMillion,
    minContextWindow = 0,
    priority = 'balanced',
  } = req;

  const providerSet = new Set(availableProviders);
  const capSet = new Set(requiredCapabilities);

  const candidates = MODEL_CATALOG.filter((m) => {
    if (m.deprecated) return false;
    if (!providerSet.has(m.provider)) return false;
    if (m.contextWindow < minContextWindow) return false;
    for (const cap of capSet) if (!m.capabilities.includes(cap)) return false;
    if (maxCostPerMillion != null) {
      const total = m.inputPricePerMillion + m.outputPricePerMillion;
      if (total > maxCostPerMillion) return false;
    }
    return true;
  });

  if (candidates.length === 0) return null;

  if (priority === 'cheap') {
    return [...candidates].sort(
      (a, b) =>
        a.inputPricePerMillion + a.outputPricePerMillion -
        (b.inputPricePerMillion + b.outputPricePerMillion),
    )[0]!;
  }

  if (priority === 'quality') {
    // Highest cap-count, break ties by higher per-million cost (quality signal).
    return [...candidates].sort((a, b) => {
      if (b.capabilities.length !== a.capabilities.length) {
        return b.capabilities.length - a.capabilities.length;
      }
      return b.outputPricePerMillion - a.outputPricePerMillion;
    })[0]!;
  }

  // Balanced: normalize cap-count vs price; pick best score.
  return [...candidates].sort((a, b) => {
    const scoreA = a.capabilities.length - (a.inputPricePerMillion + a.outputPricePerMillion) / 20;
    const scoreB = b.capabilities.length - (b.inputPricePerMillion + b.outputPricePerMillion) / 20;
    return scoreB - scoreA;
  })[0]!;
}

/** Lookup helper for callers that already know the id. */
export function getModel(id: string): ModelMetadata | null {
  return MODEL_CATALOG.find((m) => m.id === id) ?? null;
}
