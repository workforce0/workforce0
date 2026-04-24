/**
 * =============================================================================
 * ANTHROPIC PROMPT-CACHE CONTROL
 * =============================================================================
 *
 * Ported (algorithm only) from NousResearch/hermes-agent agent/prompt_caching.py.
 * Pure function: mutates a copy of the outbound messages to add up to 4
 * `cache_control` breakpoints following Anthropic's rules.
 *
 * Strategy: "system + last-3 non-system" — the system prompt is always
 * marked (it never changes across a session), then the trailing 3
 * non-system turns. Previous last-3 become this turn's middle-positioned
 * blocks, which Anthropic still serves from cache because the prefix
 * hash up to each breakpoint is stable.
 *
 * Rules enforced on every call, per Anthropic docs:
 *   - tool messages can only hold cache_control natively on Anthropic
 *     (OpenAI-compat adapters drop the field; skip those to avoid noise)
 *   - string content → convert to `[{type:"text", text, cache_control}]`
 *   - array content → attach marker on the LAST block
 *   - empty/null content → top-level `cache_control`
 *
 * The caller MUST NOT mutate past messages between turns. Altering any
 * text inside a cached prefix invalidates the hash and the whole chain
 * misses the cache. See AGENTS.md § "Prompt Caching Must Not Break".
 *
 * @module services/model-registry/prompt-caching
 */

export type CacheMarker = { type: 'ephemeral'; ttl?: '1h' };

export interface CacheableMessage {
  role: string;
  content?: unknown;
  cache_control?: CacheMarker;
  [key: string]: unknown;
}

/**
 * Max number of `cache_control` breakpoints Anthropic honors per request.
 * Exceeding this returns an API error (API-level; not risk-silent).
 */
const MAX_BREAKPOINTS = 4;

/**
 * Attach a cache-control marker to a single message in-place.
 * Never called on a message the caller still owns — the outer
 * function deep-clones first.
 */
function attachMarker(
  message: CacheableMessage,
  marker: CacheMarker,
  nativeAnthropic: boolean,
): void {
  // Tool messages: Anthropic supports cache_control at message level;
  // OpenAI's tool-message shape does not, so skip to avoid serializing
  // a field the downstream adapter will reject.
  if (message.role === 'tool') {
    if (nativeAnthropic) message.cache_control = marker;
    return;
  }

  // Empty / null content — mark at the top level
  if (message.content == null || message.content === '') {
    message.cache_control = marker;
    return;
  }

  // String content — promote to block array so we can attach the marker
  if (typeof message.content === 'string') {
    message.content = [{ type: 'text', text: message.content, cache_control: marker }];
    return;
  }

  // Array content — attach to the LAST block (Anthropic caches up to
  // and including that block)
  if (Array.isArray(message.content) && message.content.length > 0) {
    const last = message.content[message.content.length - 1];
    if (last && typeof last === 'object') {
      (last as Record<string, unknown>).cache_control = marker;
    }
  }
}

/**
 * Apply Anthropic prompt-cache breakpoints to an outbound message array.
 *
 * @param messages        Outbound message list. Not mutated — returned copy is mutated.
 * @param ttl             Anthropic cache TTL. '5m' is default (free); '1h' bills separately.
 * @param nativeAnthropic True when sending directly via @anthropic-ai/sdk;
 *                        false for OpenAI-compatible proxies that strip the field.
 * @returns A deep-cloned copy with up to 4 cache_control markers attached.
 */
export function applyAnthropicCacheControl(
  messages: CacheableMessage[],
  ttl: '5m' | '1h' = '5m',
  nativeAnthropic: boolean = true,
): CacheableMessage[] {
  // Deep-clone so callers keep their array pristine (caching invariants
  // require that past messages don't get mutated between turns).
  const out: CacheableMessage[] = structuredClone(messages);
  if (out.length === 0) return out;

  const marker: CacheMarker = ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
  let used = 0;

  // Breakpoint 1: system prompt if present (stable across the whole session)
  if (out[0]?.role === 'system') {
    attachMarker(out[0], marker, nativeAnthropic);
    used += 1;
  }

  // Remaining breakpoints: the last (MAX_BREAKPOINTS - used) non-system messages.
  // Last-3 pattern means previous-turn tail stays warm as this-turn's middle.
  const nonSystemIndices: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.role !== 'system') nonSystemIndices.push(i);
  }

  const remaining = Math.max(0, MAX_BREAKPOINTS - used);
  const toMark = nonSystemIndices.slice(-remaining);
  for (const idx of toMark) {
    attachMarker(out[idx]!, marker, nativeAnthropic);
  }

  return out;
}

/**
 * Parse Anthropic's `usage` block from a response and return hit-rate
 * telemetry suitable for logging / surfacing in UsageService.
 *
 * Input cache fields are optional (older API versions omit them).
 */
export interface CacheUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  cacheHitRatio: number;
}

export function readCacheUsage(usage: Record<string, unknown> | undefined): CacheUsage {
  const input = Number(usage?.input_tokens ?? 0);
  const output = Number(usage?.output_tokens ?? 0);
  const read = Number(usage?.cache_read_input_tokens ?? 0);
  const create = Number(usage?.cache_creation_input_tokens ?? 0);
  const denom = input + read + create;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: read,
    cacheCreationInputTokens: create,
    cacheHitRatio: denom > 0 ? read / denom : 0,
  };
}
