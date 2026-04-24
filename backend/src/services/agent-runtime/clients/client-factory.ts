// mvp/src/services/agent-runtime/clients/client-factory.ts

import type { ProviderName } from '../../../types/model-registry.types.js';
import type { ModelClient } from '../types.js';
import type { PromptPipeline } from '../prompt-pipeline.js';
import { AnthropicClient } from './anthropic-client.js';
import { GoogleClient } from './google-client.js';
import { OpenAIClient } from './openai-client.js';

export interface CreateModelClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /**
   * Optional PromptPipeline to wrap the client with. When provided, every
   * chat() call goes through redaction + trajectory; Anthropic clients
   * also get prompt-cache annotation automatically.
   *
   * Hermes III M2: lets every agent opt into the pipeline by construction
   * instead of manually wrapping in their own services.
   */
  pipeline?: PromptPipeline;
}

export function createModelClient(
  provider: ProviderName,
  opts: CreateModelClientOptions,
): ModelClient {
  const raw = buildRaw(provider, opts);
  if (!opts.pipeline) return raw;

  // Auto-enable Anthropic cache when the underlying client is Anthropic —
  // caller doesn't need to know the detail.
  if (provider === 'anthropic') {
    return opts.pipeline.wrap(raw);
  }
  return opts.pipeline.wrap(raw);
}

function buildRaw(provider: ProviderName, opts: CreateModelClientOptions): ModelClient {
  switch (provider) {
    case 'anthropic':
      return new AnthropicClient({ apiKey: opts.apiKey ?? '', baseUrl: opts.baseUrl });
    case 'google':
      return new GoogleClient({ apiKey: opts.apiKey ?? '' });
    case 'openai':
      return new OpenAIClient({ apiKey: opts.apiKey ?? '', baseUrl: opts.baseUrl });
    case 'meta':
    case 'custom':
      if (!opts.baseUrl) throw new Error('Custom/Meta providers require baseUrl');
      return new OpenAIClient({ apiKey: opts.apiKey ?? '', baseUrl: opts.baseUrl });
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
