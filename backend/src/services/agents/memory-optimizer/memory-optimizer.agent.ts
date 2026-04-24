// mvp/src/services/agents/memory-optimizer/memory-optimizer.agent.ts

import { AgentLoop } from '../../agent-runtime/agent-loop.js';
import type {
  AgentRunResult,
  AgentTool,
  ModelClient,
} from '../../agent-runtime/types.js';
import type { MemoryService } from '../../memory/memory.service.js';
import type { ModelRegistryService } from '../../model-registry/model-registry.service.js';
import { createMemoryOptimizerTools } from './tools.js';
import { MEMORY_OPTIMIZER_SYSTEM_PROMPT } from './prompts.js';

const OUTCOME_ANALYSIS_PROMPT = `You are an institutional learning analyst for Workforce0 consulting firm.

Your job is to analyze agent task outcomes and extract reusable methodology patterns.

Steps:
1. Use read_outcome_batch to fetch recent outcomes
2. Group outcomes by agent type and result (approved vs rejected)
3. Identify patterns: what do approved outputs have in common? What do rejected outputs lack?
4. For strong patterns (clear evidence across 3+ outcomes), use extract_skill_candidate to create a candidate
5. For existing candidates, use update_skill_confidence to adjust based on new evidence

Rules:
- Extract GENERAL methodology patterns, not domain-specific content
- No company names, no specific tech stacks, no tenant-specific details
- Patterns should be actionable (e.g., "Always include rollback steps in migration PRDs")
- Only create candidates when you have strong evidence (3+ confirming outcomes)`;

/**
 * MemoryOptimizerAgent — Memory Optimizer Agent (Agent Loop pattern)
 *
 * Runs nightly per tenant to consolidate and improve per-tenant learning.
 * Promotes high-signal warm memories to long-term (Qdrant placeholder),
 * extracts recurring patterns, prunes outdated or contradictory entries,
 * and generates a comprehensive tenant profile.
 *
 * Uses Claude Haiku as primary model (no reviewer).
 */
export class MemoryOptimizerAgent {
  readonly agentType = 'memory_optimizer' as const;
  readonly tools: AgentTool[];

  constructor(
    private modelClient: ModelClient,
    private prisma: any,
    private memoryService: MemoryService,
    private modelRegistry?: ModelRegistryService,
    private redis?: any,
  ) {
    this.tools = createMemoryOptimizerTools({ prisma, memoryService, redis });
  }

  /**
   * Resolve model config from the registry, falling back to defaults if unavailable.
   */
  private async resolveModelConfig(tenantId: string) {
    let model: { provider: string; modelId: string } = {
      provider: 'anthropic',
      modelId: 'claude-haiku-4-5-20251001',
    };
    if (this.modelRegistry) {
      try {
        const resolved = await this.modelRegistry.resolveModel(tenantId, 'memory_optimizer');
        model = { provider: resolved.provider, modelId: resolved.modelId };
      } catch {
        // Use default — tenant may not have config yet
      }
    }
    return model;
  }

  /**
   * Optimize tenant memory: scan, extract patterns, prune, consolidate, and profile.
   *
   * The agent will:
   * 1. Scan warm memories for high-signal promotion candidates
   * 2. Extract recurring patterns from memories
   * 3. Prune outdated or contradictory entries
   * 4. Consolidate and promote high-value memories
   * 5. Generate a comprehensive tenant profile
   *
   * @param tenantId - Tenant to optimize memories for
   */
  async optimizeTenant(tenantId: string): Promise<{
    success: boolean;
    memoriesScanned: number;
    memoriesPromoted: number;
    memoriesPruned: number;
    patternsExtracted: number;
    tenantProfile?: Record<string, unknown>;
    confidence: number;
  }> {
    const model = await this.resolveModelConfig(tenantId);
    const loop = new AgentLoop(
      {
        agentType: this.agentType,
        systemPrompt: MEMORY_OPTIMIZER_SYSTEM_PROMPT,
        tools: this.tools,
        maxSteps: 10,
        confidenceThreshold: 0.7,
        model,
      },
      this.modelClient,
    );

    const task = [
      'Optimize tenant memory by consolidating, extracting patterns, and pruning.',
      '',
      'Follow the process defined in your instructions:',
      '1. Scan warm memories for high-signal entries (frequently accessed or high confidence)',
      '2. Extract recurring patterns from the scanned memories',
      '3. Prune outdated memories (not accessed in 60+ days)',
      '4. Consolidate related memories and promote high-value entries',
      '5. Generate a comprehensive tenant profile summarizing all learnings',
      '',
      'Be thorough. Preserve valuable patterns and remove noise.',
    ].join('\n');

    const result: AgentRunResult = await loop.run(task, {
      tenantId,
      engagementId: 'system',
      agentType: this.agentType,
      traceId: `memory-optimizer-${tenantId}-${Date.now()}`,
      memory: {},
    });

    // Extract metrics from the agent run steps
    let memoriesScanned = 0;
    let memoriesPromoted = 0;
    let memoriesPruned = 0;
    let patternsExtracted = 0;
    let tenantProfile: Record<string, unknown> | undefined;

    for (const step of result.steps) {
      if (!step.toolResult?.success || !step.toolResult.data) continue;
      const data = step.toolResult.data as Record<string, unknown>;

      switch (step.toolName) {
        case 'scan_warm_memories':
          memoriesScanned = (data.count as number) ?? 0;
          break;
        case 'extract_patterns':
          patternsExtracted = (data.totalAnalyzed as number) ?? 0;
          break;
        case 'prune_outdated':
          memoriesPruned = (data.pruned as number) ?? 0;
          break;
        case 'consolidate_memories':
          memoriesPromoted = (data.consolidated as number) ?? 0;
          break;
        case 'generate_tenant_profile':
          tenantProfile = (data.profile as Record<string, unknown>) ?? undefined;
          break;
      }
    }

    return {
      success: result.success,
      memoriesScanned,
      memoriesPromoted,
      memoriesPruned,
      patternsExtracted,
      tenantProfile,
      confidence: result.confidence,
    };
  }

  /**
   * Analyze recent agent outcomes to extract reusable methodology patterns,
   * create skill candidates, and promote/demote existing candidates.
   */
  async analyzeOutcomes(): Promise<{
    patternsFound: number;
    candidatesCreated: string[];
    candidatesPromoted: string[];
    candidatesDemoted: string[];
  }> {
    const model = await this.resolveModelConfig('system');
    const loop = new AgentLoop(
      {
        agentType: this.agentType,
        systemPrompt: OUTCOME_ANALYSIS_PROMPT,
        tools: this.tools,
        maxSteps: 15,
        confidenceThreshold: 0.7,
        model,
      },
      this.modelClient,
    );

    const result: AgentRunResult = await loop.run(
      'Analyze recent agent outcomes to identify patterns. For approved outputs, extract what made them successful. For rejected outputs, identify what went wrong. Create skill candidates for patterns with strong evidence.',
      {
        tenantId: 'system',
        engagementId: 'system',
        agentType: this.agentType,
        traceId: `outcome-analysis-${Date.now()}`,
        memory: {},
      },
    );

    // Parse result (best effort)
    const output = (result.output ?? {}) as Partial<{
      patternsFound: number;
      candidatesCreated: string[];
      candidatesPromoted: string[];
      candidatesDemoted: string[];
    }>;
    return {
      patternsFound: output.patternsFound ?? 0,
      candidatesCreated: output.candidatesCreated ?? [],
      candidatesPromoted: output.candidatesPromoted ?? [],
      candidatesDemoted: output.candidatesDemoted ?? [],
    };
  }
}
