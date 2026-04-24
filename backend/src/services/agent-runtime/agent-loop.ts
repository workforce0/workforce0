// mvp/src/services/agent-runtime/agent-loop.ts

import { logger } from '../../lib/logger.js';
import type {
  AgentConfig,
  AgentContext,
  AgentRunResult,
  AgentStep,
  ModelClient,
  ToolCallResult,
  ToolResult,
} from './types.js';
import type { SkillsService } from '../skills/skills.service.js';
import type { MemoryManager } from '../memory/memory-provider.js';

const log = logger.child({ service: 'AgentLoop' });

export interface AgentLoopOptions {
  /** Optional skills service for `/slug`-style skill invocation at task start. */
  skillsService?: SkillsService;
  /** Optional memory manager for pre-task context recall. */
  memoryManager?: MemoryManager;
  /** Session id for memory prefetch + trajectory keys. Defaults to context.traceId. */
  sessionId?: string;
}

/**
 * AgentLoop implements the core agent execution model:
 * receive task -> think -> pick tool(s) -> execute -> observe -> repeat.
 *
 * This is the foundational abstraction every agent in the system uses.
 * It handles tool dispatch (including parallel tool calls), error recovery,
 * token tracking, and max-step safety to prevent runaway loops.
 *
 * Hermes III integration (M5): optional skillsService + memoryManager let
 * the loop invoke /slug skills and inject fenced memory context as
 * USER-message prepends. Both are opt-in — when not provided, behavior is
 * exactly as before.
 */
export class AgentLoop {
  private readonly config: AgentConfig;
  private readonly modelClient: ModelClient;
  private readonly options: AgentLoopOptions;

  constructor(
    config: AgentConfig,
    modelClient: ModelClient,
    options: AgentLoopOptions = {},
  ) {
    this.config = config;
    this.modelClient = modelClient;
    this.options = options;
  }

  /**
   * Run the agent loop for a given task.
   *
   * @param task - The user/system task to execute
   * @param context - Tenant, engagement, and trace context
   * @returns The agent run result with steps, confidence, and token usage
   */
  async run(task: string, context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();
    const steps: AgentStep[] = [];
    const totalTokens = { input: 0, output: 0 };
    const sessionId = this.options.sessionId ?? context.traceId;

    // Hermes III M5: skills + memory injected as prefixed user messages,
    // NOT as system-prompt mutations (keeps Anthropic prompt cache warm —
    // see AGENTS.md § Prompt Caching Must Not Break).
    const prefixMessages: Array<{ role: string; content: string }> = [];
    let effectiveTask = task;

    if (this.options.skillsService) {
      const skillMatch = /^\/([a-z0-9-]+)(?:\s+(.+))?$/is.exec(task.trim());
      if (skillMatch) {
        const [, slug, remainder] = skillMatch;
        const invocation = await this.options.skillsService.invoke(
          context.tenantId,
          slug!.toLowerCase(),
          { userInstruction: remainder?.trim() || undefined },
        );
        if (invocation) {
          prefixMessages.push({
            role: 'user',
            content: invocation.activationMessage,
          });
          effectiveTask = remainder?.trim() || `Follow the ${invocation.skill.name} skill above.`;
          log.info(
            { agentType: this.config.agentType, skill: slug, traceId: context.traceId },
            'Skill invoked at task start',
          );
        }
      }
    }

    if (this.options.memoryManager && this.options.memoryManager.providerCount() > 0) {
      try {
        const recall = await this.options.memoryManager.prefetchAll(effectiveTask, sessionId);
        const block = this.options.memoryManager.buildContextBlock(recall);
        if (block) {
          prefixMessages.push({ role: 'user', content: block });
          log.debug(
            { agentType: this.config.agentType, traceId: context.traceId },
            'Memory context prefetched',
          );
        }
      } catch (err) {
        log.warn(
          {
            agentType: this.config.agentType,
            error: err instanceof Error ? err.message : String(err),
          },
          'Memory prefetch failed (swallowed)',
        );
      }
    }

    const messages: Array<{ role: string; content: string }> = [
      ...prefixMessages,
      { role: 'user', content: effectiveTask },
    ];

    const toolDefs = this.config.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    log.info(
      { agentType: this.config.agentType, traceId: context.traceId, task },
      'Agent loop started',
    );

    for (let stepNumber = 1; stepNumber <= this.config.maxSteps; stepNumber++) {
      const response = await this.modelClient.chat({
        model: this.config.model.modelId,
        systemPrompt: this.config.systemPrompt,
        messages,
        tools: toolDefs,
      });

      totalTokens.input += response.tokenUsage.input;
      totalTokens.output += response.tokenUsage.output;

      // If no tool calls or end_turn, finalize and return success
      if (response.toolCalls.length === 0 || response.stopReason === 'end_turn') {
        const step: AgentStep = {
          stepNumber,
          thought: response.content,
          toolName: null,
          toolInput: null,
          toolResult: null,
          toolCalls: [],
          timestamp: new Date(),
          tokenUsage: { ...response.tokenUsage },
        };
        steps.push(step);

        const confidence = this.extractConfidence(response.content);
        const durationMs = Date.now() - startTime;

        log.info(
          {
            agentType: this.config.agentType,
            traceId: context.traceId,
            steps: steps.length,
            confidence,
            durationMs,
          },
          'Agent loop completed successfully',
        );

        return {
          success: true,
          output: response.content,
          confidence,
          steps,
          totalTokens,
          durationMs,
        };
      }

      // Execute ALL tool calls in parallel
      const toolResults = await Promise.all(
        response.toolCalls.map(async (tc) => {
          const result = await this.executeTool(tc.name, tc.input, context);
          return { toolName: tc.name, toolInput: tc.input, toolResult: result } as ToolCallResult;
        }),
      );

      // Build step record — backward-compatible (first tool in legacy fields)
      const firstCall = toolResults[0];
      const step: AgentStep = {
        stepNumber,
        thought: response.content,
        toolName: firstCall.toolName,
        toolInput: firstCall.toolInput,
        toolResult: firstCall.toolResult,
        toolCalls: toolResults,
        timestamp: new Date(),
        tokenUsage: { ...response.tokenUsage },
      };

      steps.push(step);

      log.debug(
        {
          agentType: this.config.agentType,
          traceId: context.traceId,
          stepNumber,
          toolCount: toolResults.length,
          tools: toolResults.map((r) => ({ name: r.toolName, success: r.toolResult.success })),
        },
        'Agent step completed',
      );

      // Add assistant message and ALL tool results to conversation
      messages.push({ role: 'assistant', content: response.content });

      const toolResultsSummary = toolResults
        .map((r) =>
          r.toolResult.success
            ? `Tool "${r.toolName}" result: ${JSON.stringify(r.toolResult.data)}`
            : `Tool "${r.toolName}" error: ${r.toolResult.error}`,
        )
        .join('\n\n');

      messages.push({ role: 'user', content: toolResultsSummary });
    }

    // maxSteps reached — return partial / failed result
    const durationMs = Date.now() - startTime;

    log.warn(
      {
        agentType: this.config.agentType,
        traceId: context.traceId,
        maxSteps: this.config.maxSteps,
        durationMs,
      },
      'Agent loop reached max steps without completing',
    );

    return {
      success: false,
      output: steps[steps.length - 1]?.thought ?? null,
      confidence: 0,
      steps,
      totalTokens,
      durationMs,
    };
  }

  /**
   * Execute a tool by name, handling unknown tools and execution errors gracefully.
   */
  private async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const tool = this.config.tools.find((t) => t.name === toolName);

    if (!tool) {
      log.warn({ toolName }, 'Unknown tool called');
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
      };
    }

    try {
      return await tool.execute(input, context);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ toolName, error: errorMessage }, 'Tool execution failed');
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Extract confidence score from the model's response text.
   * Looks for patterns like "Confidence: 0.92".
   * Defaults to 0.5 if no confidence is found.
   */
  private extractConfidence(content: string): number {
    const match = content.match(/Confidence:\s*([\d.]+)/i);
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value >= 0 && value <= 1) {
        return value;
      }
    }
    return 0.5;
  }
}
