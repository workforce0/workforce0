/**
 * =============================================================================
 * SUBAGENT SPAWNER — fan out isolated parallel work from a parent agent
 * =============================================================================
 *
 * Inspired by NousResearch/hermes-agent's subagent pattern. Lets a parent
 * agent (BA, Dev, Supervisor) delegate a bounded sub-task to an isolated
 * child AgentLoop with its own context window and tool list, then collect
 * only the summary back.
 *
 * Why it matters for Workforce0:
 *   - BA agent doing a brief with 5 action items can research each
 *     item's codebase context in parallel without polluting the parent's
 *     cached prefix (see AGENTS.md § Prompt Caching Must Not Break)
 *   - Dev agent writing a multi-file PR can spawn one child per file
 *   - Supervisor comparing a new brief to past ones spawns one child
 *     per past brief
 *
 * Scope (MVP):
 *   - spawn(task, opts) runs a single child to completion, returns summary
 *   - spawnAll(tasks, opts) runs children in parallel with bounded concurrency
 *   - Children inherit the parent's pipeline (redaction + cache + trajectory)
 *   - No nested subagents (parent.spawn.spawn is rejected)
 *   - Depth-1 fan-out is enough to match every known Workforce0 use case
 *
 * @module services/agent-runtime/subagent-spawner
 */

import { AgentLoop, type AgentLoopOptions } from './agent-loop.js';
import type {
  AgentConfig,
  AgentContext,
  AgentRunResult,
  AgentTool,
  ModelClient,
} from './types.js';
import { createChildLogger } from '../../lib/logger.js';

export interface SubagentSpawnOptions {
  /** Model client for the child. Typically the parent's wrapped client. */
  modelClient: ModelClient;
  /** System prompt for the child. Focused on the sub-task, no parent history. */
  systemPrompt: string;
  /** Tools the child can call. Default: empty (reasoning-only). */
  tools?: AgentTool[];
  /** Max steps for the child. Default: 5. Always lower than parent to prevent runaways. */
  maxSteps?: number;
  /** Model id + provider hint. Same shape as AgentConfig.model. */
  model?: AgentConfig['model'];
  /** Optional AgentLoopOptions (skills/memory). Default: none — children usually don't need them. */
  loopOptions?: AgentLoopOptions;
  /** Parent context for tenant scoping and audit trails. */
  parentContext: AgentContext;
  /** Distinguishes this child in logs + trajectory events. */
  subagentName: string;
}

export interface SubagentResult {
  subagentName: string;
  success: boolean;
  summary: string;
  confidence: number;
  steps: number;
  tokenUsage: { input: number; output: number };
  durationMs: number;
  error?: string;
}

export class SubagentSpawner {
  private readonly logger = createChildLogger({ service: 'SubagentSpawner' });
  private readonly maxConcurrency: number;
  private activeSpawns = 0;

  constructor(opts: { maxConcurrency?: number } = {}) {
    this.maxConcurrency = opts.maxConcurrency ?? 5;
  }

  /**
   * Spawn a single child agent for a bounded sub-task. Blocks until the
   * child completes or hits maxSteps.
   */
  async spawn(task: string, opts: SubagentSpawnOptions): Promise<SubagentResult> {
    const start = Date.now();
    this.activeSpawns += 1;
    try {
      const config: AgentConfig = {
        agentType: `${opts.parentContext.agentType}.subagent.${opts.subagentName}`,
        systemPrompt: opts.systemPrompt,
        tools: opts.tools ?? [],
        maxSteps: opts.maxSteps ?? 5,
        confidenceThreshold: 0.7,
        model: opts.model ?? {
          provider: 'anthropic',
          modelId: 'claude-haiku-4-5',
        },
      };

      const loop = new AgentLoop(config, opts.modelClient, opts.loopOptions ?? {});

      // Isolated context — child sees its own traceId derived from parent
      const childContext: AgentContext = {
        ...opts.parentContext,
        agentType: config.agentType,
        traceId: `${opts.parentContext.traceId}.sub-${opts.subagentName}`,
        memory: {},
      };

      this.logger.debug('Subagent starting', {
        subagentName: opts.subagentName,
        parentTrace: opts.parentContext.traceId,
        taskPreview: task.slice(0, 80),
      });

      const result = await loop.run(task, childContext);

      return this.toSubagentResult(opts.subagentName, result, undefined, start);
    } catch (err) {
      return this.toSubagentResult(
        opts.subagentName,
        {
          success: false,
          output: null,
          confidence: 0,
          steps: [],
          totalTokens: { input: 0, output: 0 },
          durationMs: Date.now() - start,
        },
        err instanceof Error ? err.message : String(err),
        start,
      );
    } finally {
      this.activeSpawns -= 1;
    }
  }

  /**
   * Spawn several children in parallel, bounded by maxConcurrency. Returns
   * results in the same order as `tasks`. Never throws — individual
   * failures appear as `success: false` results.
   */
  async spawnAll(
    tasks: Array<{ task: string; opts: SubagentSpawnOptions }>,
  ): Promise<SubagentResult[]> {
    if (tasks.length === 0) return [];
    const results: SubagentResult[] = new Array(tasks.length);
    let next = 0;

    const worker = async () => {
      while (true) {
        const idx = next;
        next += 1;
        if (idx >= tasks.length) return;
        const item = tasks[idx]!;
        results[idx] = await this.spawn(item.task, item.opts);
      }
    };

    const workerCount = Math.min(this.maxConcurrency, tasks.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  /** Observability — current number of in-flight children. */
  get inFlight(): number {
    return this.activeSpawns;
  }

  private toSubagentResult(
    subagentName: string,
    run: AgentRunResult,
    error: string | undefined,
    start: number,
  ): SubagentResult {
    return {
      subagentName,
      success: run.success,
      summary: typeof run.output === 'string' ? run.output : JSON.stringify(run.output ?? ''),
      confidence: run.confidence,
      steps: run.steps.length,
      tokenUsage: run.totalTokens,
      durationMs: run.durationMs || Date.now() - start,
      error,
    };
  }
}
