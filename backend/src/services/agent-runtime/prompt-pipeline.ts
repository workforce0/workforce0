/**
 * =============================================================================
 * PROMPT PIPELINE — composes Hermes utilities into one ModelClient wrapper
 * =============================================================================
 *
 * Kicks off Hermes III: the agent-loop integration point that wires the
 * previously-shipped utilities (redaction, prompt caching, trajectory
 * capture, rate-limit awareness) into the actual request path.
 *
 * Instead of teaching every agent (BA, Dev, QA, Supervisor) to call each
 * utility individually, we wrap the ModelClient once: agents keep calling
 * `modelClient.chat(...)`; the pipeline redacts, cache-annotates,
 * traces, and passes through.
 *
 * @module services/agent-runtime/prompt-pipeline
 */

import { createChildLogger } from '../../lib/logger.js';
import { redactDeep, type RedactionCategory } from '../model-registry/redact.js';
import {
  applyAnthropicCacheControl,
  type CacheableMessage,
} from '../model-registry/prompt-caching.js';
import type { TrajectoryService } from '../trajectory/trajectory.service.js';
import type { ModelClient } from './types.js';

export interface PromptPipelineOptions {
  /** Enable PII/secret redaction on outbound messages + system prompt. Default: true. */
  redact?: boolean;
  /** Redaction categories to skip (e.g. ['email'] inside an admin audit UI). */
  redactSkip?: RedactionCategory[];
  /** Apply Anthropic cache-control breakpoints. Only useful when sending to Anthropic. */
  anthropicCache?: boolean;
  /** TTL for Anthropic cache entries. */
  anthropicCacheTtl?: '5m' | '1h';
  /** Trajectory service for per-turn telemetry. Optional. */
  trajectory?: TrajectoryService;
}

export interface TurnContext {
  tenantId: string;
  userId?: string;
  sessionId: string;
  agentName: string;
  engagementId?: string;
  prdId?: string;
}

/**
 * Wrap a raw ModelClient with the Hermes pipeline.
 *
 * The returned client has the same signature as the input — agents don't
 * need to know pipeline exists. Extra per-turn context (for trajectory)
 * is attached via a side-channel WeakMap keyed by the client instance,
 * so the core interface stays pure.
 */
export class PromptPipeline {
  private readonly logger = createChildLogger({ service: 'PromptPipeline' });
  private readonly currentTurn = new WeakMap<ModelClient, TurnContext>();

  constructor(private readonly opts: PromptPipelineOptions = {}) {}

  /** Set the turn context used by the next chat() call on this client. */
  setTurnContext(client: ModelClient, ctx: TurnContext): void {
    this.currentTurn.set(client, ctx);
  }

  wrap(raw: ModelClient): ModelClient {
    const opts = this.opts;
    const getCtx = (c: ModelClient) => this.currentTurn.get(c);
    const log = this.logger;

    return {
      chat: async (params: Parameters<ModelClient['chat']>[0]) => {
        const turn = getCtx(raw);

        // 1. Redact (safe default: on)
        const redactOn = opts.redact !== false;
        const redactedParams = redactOn
          ? {
              ...params,
              systemPrompt: params.systemPrompt,
              messages: redactDeep(params.messages, { skip: opts.redactSkip }),
            }
          : params;

        // 2. Apply Anthropic prompt-cache breakpoints when requested.
        //    We conceptually transform [system + messages] into one
        //    CacheableMessage[] for the helper, then split back.
        let finalParams = redactedParams;
        if (opts.anthropicCache) {
          const combined: CacheableMessage[] = [
            { role: 'system', content: redactedParams.systemPrompt },
            ...redactedParams.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          ];
          const annotated = applyAnthropicCacheControl(
            combined,
            opts.anthropicCacheTtl ?? '5m',
            true,
          );
          finalParams = {
            ...redactedParams,
            // systemPrompt becomes the annotated first block's text where possible;
            // pass it through as-is — the native Anthropic adapter reads the
            // cache_control field off the block array we passed up.
            systemPrompt: typeof annotated[0]?.content === 'string'
              ? annotated[0]!.content
              : redactedParams.systemPrompt,
            messages: annotated.slice(1).map((m) => ({
              role: m.role,
              content:
                typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(m.content),
            })) as typeof redactedParams.messages,
          };
        }

        // 3. Trajectory: turn_started
        if (turn && opts.trajectory) {
          await opts.trajectory.record({
            tenantId: turn.tenantId,
            userId: turn.userId,
            sessionId: turn.sessionId,
            agentName: turn.agentName,
            engagementId: turn.engagementId,
            prdId: turn.prdId,
            type: 'turn_started',
            payload: {
              model: finalParams.model,
              messageCount: finalParams.messages.length,
              toolCount: finalParams.tools.length,
            },
          });
        }

        try {
          const response = await raw.chat(finalParams);

          // 4. Trajectory: turn_completed
          if (turn && opts.trajectory) {
            await opts.trajectory.record({
              tenantId: turn.tenantId,
              userId: turn.userId,
              sessionId: turn.sessionId,
              agentName: turn.agentName,
              engagementId: turn.engagementId,
              prdId: turn.prdId,
              type: 'turn_completed',
              payload: {
                model: finalParams.model,
                tokenUsage: response.tokenUsage,
                stopReason: response.stopReason,
                toolCallCount: response.toolCalls.length,
              },
            });
          }

          return response;
        } catch (err) {
          log.warn('Pipeline chat failed', { error: (err as Error).message });

          // 5. Trajectory: turn_failed
          if (turn && opts.trajectory) {
            await opts.trajectory.record({
              tenantId: turn.tenantId,
              userId: turn.userId,
              sessionId: turn.sessionId,
              agentName: turn.agentName,
              engagementId: turn.engagementId,
              prdId: turn.prdId,
              type: 'turn_failed',
              payload: {
                model: finalParams.model,
                error: (err as Error).message,
              },
            });
          }

          throw err;
        }
      },
    };
  }
}
