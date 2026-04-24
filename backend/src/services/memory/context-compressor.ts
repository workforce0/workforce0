/**
 * =============================================================================
 * CONTEXT COMPRESSOR
 * =============================================================================
 *
 * Ported (algorithm only) from NousResearch/hermes-agent
 * `agent/context_compressor.py` + `agent/manual_compression_feedback.py`.
 *
 * Long engagements (many meetings, many turns) blow past Anthropic's
 * context window. Before that happens, fold the oldest N turns into a
 * compact LLM summary and swap those turns for the summary — keeping the
 * system prompt stable (prompt-cache intact — see AGENTS.md) while
 * trimming the tail that's no longer driving the live decision.
 *
 * Current scope (v1): token-count heuristics + plug-in summarizer. The
 * full `onPreCompress` hook into MemoryProvider + trajectory recording
 * is wired in the agent-loop integration that follows.
 *
 * @module services/memory/context-compressor
 */

import { createChildLogger } from '../../lib/logger.js';

export interface Message {
  role: string;
  content: unknown;
}

export interface CompressionResult {
  messages: Message[];
  tokensSaved: number;
  summaryText: string;
}

export interface SummarizerFn {
  (messages: Message[]): Promise<string>;
}

export interface CompressionOptions {
  /** Absolute token ceiling before we must compress. */
  ceilingTokens: number;
  /** Target tokens to bring the conversation down to after compressing. */
  targetTokens: number;
  /** How many most-recent turns to always preserve (cache-warmth tail). */
  preserveTail: number;
}

/** Cheap, provider-agnostic token estimator (4 chars ≈ 1 token). */
export function estimateTokens(msgs: Message[]): number {
  let total = 0;
  for (const m of msgs) {
    const s =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .map((b) =>
                typeof b === 'object' && b != null && 'text' in b
                  ? String((b as { text: string }).text ?? '')
                  : '',
              )
              .join(' ')
          : JSON.stringify(m.content ?? '');
    total += Math.ceil(s.length / 4);
  }
  return total;
}

/**
 * Compress conversation history if it's over ceiling. No-op otherwise.
 * Preserves the system message (index 0 if present) and the trailing
 * `preserveTail` non-system turns. Everything in the middle is sent to
 * the summarizer and replaced with a single assistant message labeled
 * as a compressed summary.
 */
export async function compressIfNeeded(
  messages: Message[],
  summarize: SummarizerFn,
  opts: CompressionOptions,
): Promise<CompressionResult> {
  const logger = createChildLogger({ service: 'ContextCompressor' });
  const before = estimateTokens(messages);

  if (before <= opts.ceilingTokens) {
    return { messages, tokensSaved: 0, summaryText: '' };
  }

  // Partition: [optional system] + [middle to compress] + [preserved tail]
  const systemHead: Message[] = messages[0]?.role === 'system' ? [messages[0]] : [];
  const rest = systemHead.length ? messages.slice(1) : messages;

  if (rest.length <= opts.preserveTail) {
    // Nothing to compress — caller has only the tail
    return { messages, tokensSaved: 0, summaryText: '' };
  }

  const tail = rest.slice(-opts.preserveTail);
  const middle = rest.slice(0, rest.length - opts.preserveTail);

  const summaryText = await summarize(middle);
  const summaryMsg: Message = {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: `[COMPRESSED: The following condenses ${middle.length} earlier turns of this conversation for context. The full history is still persisted in the session log.]\n\n${summaryText}`,
      },
    ],
  };

  const compressed = [...systemHead, summaryMsg, ...tail];
  const after = estimateTokens(compressed);
  const saved = before - after;

  logger.info('Context compressed', {
    before,
    after,
    saved,
    turnsCompressed: middle.length,
  });

  return {
    messages: compressed,
    tokensSaved: saved,
    summaryText,
  };
}
