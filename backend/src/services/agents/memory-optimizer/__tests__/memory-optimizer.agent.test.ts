// mvp/src/services/agents/memory-optimizer/__tests__/memory-optimizer.agent.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryOptimizerAgent } from '../memory-optimizer.agent.js';
import { createMemoryOptimizerTools } from '../tools.js';
import { MEMORY_OPTIMIZER_SYSTEM_PROMPT } from '../prompts.js';
import type { ModelClient } from '../../../agent-runtime/types.js';
import type { MemoryService } from '../../../memory/memory.service.js';
import type { ModelRegistryService } from '../../../model-registry/model-registry.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockPrisma() {
  return {
    tenantMemory: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function makeMockMemoryService(): MemoryService {
  return {
    remember: vi.fn().mockResolvedValue(undefined),
    recall: vi.fn().mockResolvedValue(null),
    getContext: vi.fn().mockResolvedValue([]),
    forget: vi.fn().mockResolvedValue(undefined),
  } as unknown as MemoryService;
}

/**
 * Build a ModelClient mock that responds to each tool call in sequence,
 * then emits end_turn with a confidence score.
 */
function makeMockModelClient(toolSequence: string[]): ModelClient {
  let callIndex = 0;

  return {
    chat: vi.fn().mockImplementation(async () => {
      if (callIndex < toolSequence.length) {
        const toolName = toolSequence[callIndex];
        callIndex++;

        // Build appropriate input per tool
        let input: Record<string, unknown> = {};
        if (toolName === 'extract_patterns' || toolName === 'consolidate_memories') {
          input = { memoryIds: ['mem-1', 'mem-2'] };
        }

        return {
          content: `Calling ${toolName}`,
          toolCalls: [{ name: toolName, input }],
          tokenUsage: { input: 100, output: 50 },
          stopReason: 'tool_use',
        };
      }

      // Final response — no more tool calls
      return {
        content: 'Optimization complete. Confidence: 0.88',
        toolCalls: [],
        tokenUsage: { input: 80, output: 40 },
        stopReason: 'end_turn',
      };
    }),
  };
}

function makeMockModelRegistry(overrides?: {
  provider?: string;
  modelId?: string;
  shouldThrow?: boolean;
}): ModelRegistryService {
  const resolveModel = overrides?.shouldThrow
    ? vi.fn().mockRejectedValue(new Error('No config'))
    : vi.fn().mockResolvedValue({
        provider: overrides?.provider ?? 'anthropic',
        modelId: overrides?.modelId ?? 'claude-haiku-4-5-20251001',
        confidenceThreshold: 0.7,
        maxSteps: 10,
      });

  return { resolveModel } as unknown as ModelRegistryService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryOptimizerAgent', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let memoryService: MemoryService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    memoryService = makeMockMemoryService();
  });

  // ---- Identity ----

  describe('identity', () => {
    it('has agentType "memory_optimizer"', () => {
      const agent = new MemoryOptimizerAgent(
        makeMockModelClient([]),
        prisma,
        memoryService,
      );
      expect(agent.agentType).toBe('memory_optimizer');
    });

    it('exposes exactly 8 tools with correct names', () => {
      const agent = new MemoryOptimizerAgent(
        makeMockModelClient([]),
        prisma,
        memoryService,
      );
      expect(agent.tools).toHaveLength(8);

      const toolNames = agent.tools.map((t) => t.name);
      expect(toolNames).toEqual([
        'scan_warm_memories',
        'extract_patterns',
        'prune_outdated',
        'generate_tenant_profile',
        'consolidate_memories',
        'read_outcome_batch',
        'extract_skill_candidate',
        'update_skill_confidence',
      ]);
    });
  });

  // ---- System prompt ----

  describe('system prompt', () => {
    it('contains key instructions', () => {
      expect(MEMORY_OPTIMIZER_SYSTEM_PROMPT).toContain('Memory Optimizer');
      expect(MEMORY_OPTIMIZER_SYSTEM_PROMPT).toContain('scan_warm_memories');
      expect(MEMORY_OPTIMIZER_SYSTEM_PROMPT).toContain('extract_patterns');
      expect(MEMORY_OPTIMIZER_SYSTEM_PROMPT).toContain('prune_outdated');
      expect(MEMORY_OPTIMIZER_SYSTEM_PROMPT).toContain('consolidate_memories');
      expect(MEMORY_OPTIMIZER_SYSTEM_PROMPT).toContain('generate_tenant_profile');
      expect(MEMORY_OPTIMIZER_SYSTEM_PROMPT).toContain('Confidence:');
    });
  });

  // ---- Optimize flow ----

  describe('optimizeTenant', () => {
    it('runs the full scan → extract → prune → consolidate → profile flow', async () => {
      const toolSequence = [
        'scan_warm_memories',
        'extract_patterns',
        'prune_outdated',
        'consolidate_memories',
        'generate_tenant_profile',
      ];

      // Set up prisma mocks to return meaningful data for each tool call
      const mockMemories = [
        {
          id: 'mem-1',
          category: 'preference',
          key: 'code_style',
          value: { indent: 'tabs' },
          confidence: 0.8,
          accessCount: 5,
          lastAccessed: new Date(),
          createdAt: new Date(),
        },
        {
          id: 'mem-2',
          category: 'convention',
          key: 'naming',
          value: { style: 'camelCase' },
          confidence: 0.9,
          accessCount: 10,
          lastAccessed: new Date(),
          createdAt: new Date(),
        },
      ];

      const staleMemories = [
        {
          id: 'mem-old-1',
          category: 'feedback',
          key: 'old_feedback',
          confidence: 0.3,
          accessCount: 0,
          lastAccessed: new Date('2024-01-01'),
        },
      ];

      // scan_warm_memories → returns mockMemories
      // extract_patterns → returns mockMemories (filtered by IDs)
      // prune_outdated → returns staleMemories
      // consolidate_memories → returns mockMemories (filtered by IDs)
      // generate_tenant_profile → uses memoryService.getContext
      let findManyCallCount = 0;
      prisma.tenantMemory.findMany.mockImplementation(async (args: any) => {
        findManyCallCount++;
        const where = args?.where ?? {};

        // Call 1: scan_warm_memories (has OR condition)
        if (where.OR) {
          return mockMemories;
        }
        // Call with lastAccessed: prune_outdated
        if (where.lastAccessed) {
          return staleMemories;
        }
        // Call with id.in: extract_patterns or consolidate_memories
        if (where.id?.in) {
          return mockMemories;
        }
        return [];
      });

      (memoryService.getContext as any).mockResolvedValue([
        { key: 'code_style', category: 'preference', value: { indent: 'tabs' }, source: 'meeting', confidence: 0.8 },
        { key: 'naming', category: 'convention', value: { style: 'camelCase' }, source: 'meeting', confidence: 0.9 },
      ]);

      const client = makeMockModelClient(toolSequence);
      const agent = new MemoryOptimizerAgent(client, prisma, memoryService);

      const result = await agent.optimizeTenant('tenant-123');

      expect(result.success).toBe(true);
      expect(result.memoriesScanned).toBe(2);
      expect(result.patternsExtracted).toBe(2);
      expect(result.memoriesPruned).toBe(1);
      expect(result.memoriesPromoted).toBe(2);
      expect(result.tenantProfile).toBeDefined();
      expect(result.confidence).toBeCloseTo(0.88, 1);

      // Verify the model client was called 6 times (5 tool calls + 1 final)
      expect(client.chat).toHaveBeenCalledTimes(6);
    });

    it('returns zero metrics when no memories exist', async () => {
      const toolSequence = [
        'scan_warm_memories',
        'extract_patterns',
        'prune_outdated',
        'consolidate_memories',
        'generate_tenant_profile',
      ];

      prisma.tenantMemory.findMany.mockResolvedValue([]);
      (memoryService.getContext as any).mockResolvedValue([]);

      // extract_patterns and consolidate_memories will fail due to empty results
      const client = makeMockModelClient(toolSequence);
      const agent = new MemoryOptimizerAgent(client, prisma, memoryService);

      const result = await agent.optimizeTenant('tenant-empty');

      expect(result.success).toBe(true);
      expect(result.memoriesScanned).toBe(0);
      expect(result.memoriesPruned).toBe(0);
    });
  });

  // ---- Model registry ----

  describe('model registry', () => {
    it('resolves model via registry with correct agent type', async () => {
      const registry = makeMockModelRegistry({
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5-20251001',
      });

      const client = makeMockModelClient([]);
      const agent = new MemoryOptimizerAgent(client, prisma, memoryService, registry);

      await agent.optimizeTenant('tenant-reg');

      expect(registry.resolveModel).toHaveBeenCalledWith('tenant-reg', 'memory_optimizer');
    });

    it('falls back to default model when registry throws', async () => {
      const registry = makeMockModelRegistry({ shouldThrow: true });

      const client = makeMockModelClient([]);
      const agent = new MemoryOptimizerAgent(client, prisma, memoryService, registry);

      const result = await agent.optimizeTenant('tenant-fallback');

      // Should still succeed using default model
      expect(result.success).toBe(true);
      expect(registry.resolveModel).toHaveBeenCalled();
      // The client should have been called with the default model
      expect(client.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
        }),
      );
    });

    it('uses default model when no registry is provided', async () => {
      const client = makeMockModelClient([]);
      const agent = new MemoryOptimizerAgent(client, prisma, memoryService);

      await agent.optimizeTenant('tenant-no-reg');

      expect(client.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
        }),
      );
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    it('handles prisma errors in tools gracefully', async () => {
      prisma.tenantMemory.findMany.mockRejectedValue(new Error('DB connection lost'));

      const tools = createMemoryOptimizerTools({ prisma, memoryService });
      const scanTool = tools.find((t) => t.name === 'scan_warm_memories')!;

      const result = await scanTool.execute({}, {
        tenantId: 'tenant-err',
        engagementId: 'system',
        agentType: 'memory_optimizer',
        traceId: 'test-trace',
        memory: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB connection lost');
    });

    it('handles empty memoryIds in extract_patterns', async () => {
      const tools = createMemoryOptimizerTools({ prisma, memoryService });
      const extractTool = tools.find((t) => t.name === 'extract_patterns')!;

      const result = await extractTool.execute({ memoryIds: [] }, {
        tenantId: 'tenant-err',
        engagementId: 'system',
        agentType: 'memory_optimizer',
        traceId: 'test-trace',
        memory: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No memoryIds provided');
    });

    it('handles empty memoryIds in consolidate_memories', async () => {
      const tools = createMemoryOptimizerTools({ prisma, memoryService });
      const consolidateTool = tools.find((t) => t.name === 'consolidate_memories')!;

      const result = await consolidateTool.execute({ memoryIds: [] }, {
        tenantId: 'tenant-err',
        engagementId: 'system',
        agentType: 'memory_optimizer',
        traceId: 'test-trace',
        memory: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No memoryIds provided');
    });

    it('consolidate_memories fails when no matching memories found', async () => {
      prisma.tenantMemory.findMany.mockResolvedValue([]);

      const tools = createMemoryOptimizerTools({ prisma, memoryService });
      const consolidateTool = tools.find((t) => t.name === 'consolidate_memories')!;

      const result = await consolidateTool.execute({ memoryIds: ['nonexistent'] }, {
        tenantId: 'tenant-err',
        engagementId: 'system',
        agentType: 'memory_optimizer',
        traceId: 'test-trace',
        memory: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No matching memories found');
    });
  });

  // ---- Individual tool behavior ----

  describe('tools', () => {
    const ctx = {
      tenantId: 'tenant-tools',
      engagementId: 'system',
      agentType: 'memory_optimizer',
      traceId: 'test-trace',
      memory: {},
    };

    it('scan_warm_memories queries with correct filter', async () => {
      const mockMems = [
        { id: 'a', category: 'preference', key: 'k1', value: 'v1', confidence: 0.8, accessCount: 5, lastAccessed: new Date(), createdAt: new Date() },
      ];
      prisma.tenantMemory.findMany.mockResolvedValue(mockMems);

      const tools = createMemoryOptimizerTools({ prisma, memoryService });
      const scan = tools.find((t) => t.name === 'scan_warm_memories')!;
      const result = await scan.execute({}, ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).count).toBe(1);
      expect(prisma.tenantMemory.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-tools',
          OR: [
            { accessCount: { gte: 3 } },
            { confidence: { gte: 0.7 } },
          ],
        },
        orderBy: { accessCount: 'desc' },
        take: 50,
      });
    });

    it('prune_outdated supports dry run', async () => {
      const stale = [
        { id: 'old-1', category: 'feedback', key: 'k', confidence: 0.2, accessCount: 0, lastAccessed: new Date('2024-01-01') },
      ];
      prisma.tenantMemory.findMany.mockResolvedValue(stale);

      const tools = createMemoryOptimizerTools({ prisma, memoryService });
      const prune = tools.find((t) => t.name === 'prune_outdated')!;
      const result = await prune.execute({ dryRun: true }, ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).pruned).toBe(1);
      expect((result.data as any).dryRun).toBe(true);
      // Should NOT have called deleteMany in dry run mode
      expect(prisma.tenantMemory.deleteMany).not.toHaveBeenCalled();
    });

    it('prune_outdated deletes when not dry run', async () => {
      const stale = [
        { id: 'old-1', category: 'feedback', key: 'k', confidence: 0.2, accessCount: 0, lastAccessed: new Date('2024-01-01') },
      ];
      prisma.tenantMemory.findMany.mockResolvedValue(stale);

      const tools = createMemoryOptimizerTools({ prisma, memoryService });
      const prune = tools.find((t) => t.name === 'prune_outdated')!;
      const result = await prune.execute({}, ctx);

      expect(result.success).toBe(true);
      expect(prisma.tenantMemory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old-1'] } },
      });
    });

    it('generate_tenant_profile returns null profile when no memories exist', async () => {
      (memoryService.getContext as any).mockResolvedValue([]);

      const tools = createMemoryOptimizerTools({ prisma, memoryService });
      const profile = tools.find((t) => t.name === 'generate_tenant_profile')!;
      const result = await profile.execute({}, ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).profile).toBeNull();
    });

    it('consolidate_memories promotes via memoryService and logs promotion', async () => {
      const mems = [
        { id: 'mem-1', category: 'preference', key: 'k1', value: { x: 1 }, source: 'manual' },
        { id: 'mem-2', category: 'convention', key: 'k2', value: { y: 2 }, source: 'meeting' },
      ];
      prisma.tenantMemory.findMany.mockResolvedValue(mems);

      const tools = createMemoryOptimizerTools({ prisma, memoryService });
      const consolidate = tools.find((t) => t.name === 'consolidate_memories')!;
      const result = await consolidate.execute({ memoryIds: ['mem-1', 'mem-2'] }, ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).consolidated).toBe(2);
      expect((result.data as any).targetConfidence).toBe(0.95);
      // Implementation promotes via memoryService.remember(), not prisma.updateMany()
      expect(memoryService.remember).toHaveBeenCalledTimes(2);
      expect(memoryService.remember).toHaveBeenCalledWith('tenant-tools', expect.objectContaining({
        category: 'preference',
        key: 'k1',
        confidence: 0.95,
      }));
    });

    it('consolidate_memories respects custom targetConfidence', async () => {
      const mems = [{ id: 'mem-1', category: 'preference', key: 'k1', value: { x: 1 }, source: 'manual' }];
      prisma.tenantMemory.findMany.mockResolvedValue(mems);

      const tools = createMemoryOptimizerTools({ prisma, memoryService });
      const consolidate = tools.find((t) => t.name === 'consolidate_memories')!;
      const result = await consolidate.execute(
        { memoryIds: ['mem-1'], targetConfidence: 0.85 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as any).targetConfidence).toBe(0.85);
      expect(memoryService.remember).toHaveBeenCalledWith('tenant-tools', expect.objectContaining({
        confidence: 0.85,
      }));
    });
  });
});
