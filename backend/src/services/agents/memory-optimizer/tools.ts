// mvp/src/services/agents/memory-optimizer/tools.ts

import type { AgentTool, AgentContext, ToolResult } from '../../agent-runtime/types.js';
import type { MemoryService } from '../../memory/memory.service.js';
import { logger } from '../../../lib/logger.js';
import { SkillLoader } from '../skills/loader.js';

const log = logger.child({ service: 'MemoryOptimizerTools' });

/**
 * Returns the maximum keyword overlap ratio between newContent and any of the
 * existingContents strings. A ratio of 1.0 means every keyword in newContent
 * also appears in the compared text.
 */
function calculateKeywordOverlap(newContent: string, existingContents: string[]): number {
  const extractKeywords = (text: string): Set<string> => {
    return new Set(
      text.toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3),
    );
  };

  const newKeywords = extractKeywords(newContent);
  if (newKeywords.size === 0) return 0;

  let maxOverlap = 0;
  for (const existing of existingContents) {
    const existingKeywords = extractKeywords(existing);
    const shared = [...newKeywords].filter(w => existingKeywords.has(w)).length;
    const overlap = shared / newKeywords.size;
    maxOverlap = Math.max(maxOverlap, overlap);
  }
  return maxOverlap;
}

export interface MemoryOptimizerToolDeps {
  prisma: any;
  memoryService: MemoryService;
  redis?: any;  // for learned skills cache invalidation
}

/**
 * Creates the 5 tools available to the Memory Optimizer Agent:
 *
 * 1. scan_warm_memories    — Query high-signal warm memories for promotion candidates
 * 2. extract_patterns      — Analyze memories to find recurring patterns
 * 3. prune_outdated        — Find and remove stale or contradicted memories
 * 4. generate_tenant_profile — Create a summary of tenant preferences and dynamics
 * 5. consolidate_memories  — Merge related memories and promote to long-term tier
 */
export function createMemoryOptimizerTools(deps: MemoryOptimizerToolDeps): AgentTool[] {
  const { prisma, memoryService } = deps;
  const redis = deps.redis;

  // ---- 1. scan_warm_memories ----

  const scanWarmMemories: AgentTool = {
    name: 'scan_warm_memories',
    description:
      'Query TenantMemory for entries with high access count (>= 3) or high confidence (>= 0.7). ' +
      'Returns candidates for promotion to long-term storage, ordered by access count descending.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of candidates to return (default: 50)',
        },
      },
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const tenantId = context.tenantId;
        const limit = (input.limit as number) ?? 50;

        const memories = await prisma.tenantMemory.findMany({
          where: {
            tenantId,
            OR: [
              { accessCount: { gte: 3 } },
              { confidence: { gte: 0.7 } },
            ],
          },
          orderBy: { accessCount: 'desc' },
          take: limit,
        });

        return {
          success: true,
          data: {
            count: memories.length,
            candidates: memories.map((m: any) => ({
              id: m.id,
              category: m.category,
              key: m.key,
              value: m.value,
              confidence: m.confidence,
              accessCount: m.accessCount,
              lastAccessed: m.lastAccessed,
              createdAt: m.createdAt,
            })),
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  // ---- 2. extract_patterns ----

  const extractPatterns: AgentTool = {
    name: 'extract_patterns',
    description:
      'Analyze a set of memories to find recurring patterns such as ' +
      '"tenant prefers tabs", "founder responds fastest on Slack", etc. ' +
      'Pass memory IDs to analyze. Returns patterns grouped by category.',
    inputSchema: {
      type: 'object',
      properties: {
        memoryIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs of memories to analyze for patterns',
        },
      },
      required: ['memoryIds'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const tenantId = context.tenantId;
        const memoryIds = input.memoryIds as string[];

        if (!memoryIds || memoryIds.length === 0) {
          return { success: false, error: 'No memoryIds provided' };
        }

        const memories = await prisma.tenantMemory.findMany({
          where: {
            id: { in: memoryIds },
            tenantId,
          },
        });

        if (memories.length === 0) {
          return {
            success: true,
            data: { patterns: [], message: 'No memories found for the given IDs' },
          };
        }

        // Group memories by category for pattern analysis
        const byCategory: Record<string, any[]> = {};
        for (const mem of memories) {
          const cat = (mem as any).category as string;
          if (!byCategory[cat]) byCategory[cat] = [];
          byCategory[cat].push({
            key: (mem as any).key,
            value: (mem as any).value,
            confidence: (mem as any).confidence,
            accessCount: (mem as any).accessCount,
          });
        }

        return {
          success: true,
          data: {
            totalAnalyzed: memories.length,
            categoryCounts: Object.fromEntries(
              Object.entries(byCategory).map(([cat, mems]) => [cat, mems.length]),
            ),
            memoriesByCategory: byCategory,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  // ---- 3. prune_outdated ----

  const pruneOutdated: AgentTool = {
    name: 'prune_outdated',
    description:
      'Find memories that have not been accessed in 60+ days and remove them. ' +
      'Returns the count and details of pruned memories.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'If true, only report what would be pruned without deleting (default: false)',
        },
      },
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const tenantId = context.tenantId;
        const dryRun = (input.dryRun as boolean) ?? false;

        // Find memories not accessed in 60+ days
        const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);

        const stale = await prisma.tenantMemory.findMany({
          where: {
            tenantId,
            lastAccessed: { lt: cutoff },
          },
        });

        const staleDetails = stale.map((m: any) => ({
          id: m.id,
          category: m.category,
          key: m.key,
          confidence: m.confidence,
          accessCount: m.accessCount,
          lastAccessed: m.lastAccessed,
        }));

        if (!dryRun && stale.length > 0) {
          await prisma.tenantMemory.deleteMany({
            where: { id: { in: stale.map((m: any) => m.id) } },
          });
          log.info(
            { tenantId, pruned: stale.length },
            'Pruned outdated memories',
          );
        }

        return {
          success: true,
          data: {
            pruned: stale.length,
            dryRun,
            details: staleDetails,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  // ---- 4. generate_tenant_profile ----

  const generateTenantProfile: AgentTool = {
    name: 'generate_tenant_profile',
    description:
      'Create a comprehensive summary of tenant preferences, conventions, team dynamics, ' +
      'and workflow patterns based on all stored memories. Returns structured profile data.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (
      _input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const tenantId = context.tenantId;

        // Retrieve all memories for the tenant, ordered by confidence
        const allMemories = await memoryService.getContext(tenantId, { limit: 200 });

        if (allMemories.length === 0) {
          return {
            success: true,
            data: {
              tenantId,
              profile: null,
              message: 'No memories found for this tenant',
            },
          };
        }

        // Group by category
        const byCategory: Record<string, Array<{ key: string; value: unknown; confidence: number }>> = {};
        for (const mem of allMemories) {
          if (!byCategory[mem.category]) byCategory[mem.category] = [];
          byCategory[mem.category].push({
            key: mem.key,
            value: mem.value,
            confidence: mem.confidence,
          });
        }

        const profile = {
          tenantId,
          totalMemories: allMemories.length,
          categories: Object.fromEntries(
            Object.entries(byCategory).map(([cat, mems]) => [
              cat,
              {
                count: mems.length,
                avgConfidence:
                  mems.reduce((sum, m) => sum + m.confidence, 0) / mems.length,
                entries: mems,
              },
            ]),
          ),
          generatedAt: new Date().toISOString(),
        };

        return {
          success: true,
          data: { profile },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  // ---- 5. consolidate_memories ----

  const consolidateMemories: AgentTool = {
    name: 'consolidate_memories',
    description:
      'Merge related memories, update confidence scores, and promote high-value entries ' +
      'to long-term tier via the memory service. Pass the IDs of memories to consolidate.',
    inputSchema: {
      type: 'object',
      properties: {
        memoryIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs of memories to consolidate and promote',
        },
        targetConfidence: {
          type: 'number',
          description: 'Confidence score to assign to promoted memories (default: 0.95)',
        },
      },
      required: ['memoryIds'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const tenantId = context.tenantId;
        const memoryIds = input.memoryIds as string[];
        const targetConfidence = (input.targetConfidence as number) ?? 0.95;

        if (!memoryIds || memoryIds.length === 0) {
          return { success: false, error: 'No memoryIds provided' };
        }

        // Verify the memories belong to this tenant
        const memories = await prisma.tenantMemory.findMany({
          where: {
            id: { in: memoryIds },
            tenantId,
          },
        });

        if (memories.length === 0) {
          return {
            success: false,
            error: 'No matching memories found for this tenant',
          };
        }

        // Promote each memory to long-term tier via memoryService.
        // Stores with boosted confidence and embeds tier metadata in value.
        const promoted: string[] = [];
        for (const mem of memories) {
          const m = mem as any;
          try {
            const promotedValue = typeof m.value === 'object' && m.value !== null
              ? { ...m.value, _tier: 'long_term', _promotedAt: new Date().toISOString() }
              : { data: m.value, _tier: 'long_term', _promotedAt: new Date().toISOString() };

            await memoryService.remember(tenantId, {
              category: m.category,
              key: m.key,
              value: promotedValue,
              source: m.source ?? 'memory-optimizer',
              confidence: targetConfidence,
            });
            promoted.push(m.id);
          } catch (err) {
            log.warn(
              { tenantId, memoryId: m.id, error: err instanceof Error ? err.message : String(err) },
              'Failed to promote memory to long-term tier',
            );
          }
        }

        log.info(
          { tenantId, promoted: promoted.length, total: memories.length },
          'Promoted memories to long-term tier',
        );

        return {
          success: true,
          data: {
            consolidated: memories.length,
            promoted: promoted.length,
            targetConfidence,
            promotedIds: promoted,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  // ---- 6. read_outcome_batch ----

  const readOutcomeBatch: AgentTool = {
    name: 'read_outcome_batch',
    description: 'Read recent agent outcomes for pattern analysis. Returns outcomes grouped by agent type and result (approved/revised/rejected).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max outcomes to read (default 100)' },
      },
    },
    execute: async (input: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
      try {
        const limit = (input.limit as number) || 100;
        const outcomes = await prisma.agentOutcome.findMany({
          orderBy: { createdAt: 'desc' },
          take: limit,
        });
        return { success: true, data: { count: outcomes.length, outcomes } };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  };

  // ---- 7. extract_skill_candidate ----

  const extractSkillCandidate: AgentTool = {
    name: 'extract_skill_candidate',
    description: 'Create a new learned skill candidate from an observed pattern. The skill starts as a candidate and must be confirmed by more outcomes before promotion.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name for the pattern' },
        content: { type: 'string', description: 'The methodology pattern as markdown' },
        target: { type: 'string', description: 'Which agents this applies to: all, ba, dev, qa' },
        evidence: { type: 'string', description: 'Evidence supporting this pattern' },
      },
      required: ['name', 'content', 'target'],
    },
    execute: async (input: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
      try {
        const skill = await prisma.learnedSkill.create({
          data: {
            name: input.name as string,
            content: input.content as string,
            target: input.target as string,
            confidence: 0.3,
            sourceOutcomes: 1,
            status: 'candidate',
          },
        });
        return { success: true, data: { id: skill.id, created: true } };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  };

  // ---- 8. update_skill_confidence ----

  const updateSkillConfidence: AgentTool = {
    name: 'update_skill_confidence',
    description: 'Update confidence score for a learned skill candidate. Promotes to active (≥0.8, ≥10 outcomes) or demotes (<0.5). Invalidates cache on status change.',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string' },
        newConfidence: { type: 'number' },
        additionalOutcomes: { type: 'number' },
      },
      required: ['skillId', 'newConfidence', 'additionalOutcomes'],
    },
    execute: async (input: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
      try {
        const skill = await prisma.learnedSkill.findUnique({ where: { id: input.skillId as string } });
        if (!skill) return { success: false, error: 'Skill not found' };

        const newConfidence = input.newConfidence as number;
        const newOutcomes = skill.sourceOutcomes + (input.additionalOutcomes as number);
        let newStatus = skill.status;

        if (newConfidence >= 0.8 && newOutcomes >= 10 && skill.status === 'candidate') {
          // Check 1: Keyword overlap with foundation skills
          const loader = new SkillLoader(deps.prisma, deps.redis);
          const foundationSkills = loader.loadFoundationSkills([skill.target as any, 'all']);
          const foundationContents = foundationSkills.map(s => s.content);
          const overlap = calculateKeywordOverlap(skill.content, foundationContents);

          if (overlap > 0.6) {
            // Too much overlap — mark as redundant instead of promoting
            await prisma.learnedSkill.update({
              where: { id: skill.id },
              data: { status: 'demoted', confidence: newConfidence, sourceOutcomes: newOutcomes },
            });

            log.info('Skill promotion check', {
              skillId: skill.id,
              overlap,
              activeCount: null,
              promoted: false,
            });

            // Invalidate Redis cache
            if (redis) {
              const keys = await redis.keys('skills:learned:*');
              if (keys.length > 0) await redis.del(...keys);
            }

            return {
              success: true,
              data: { id: skill.id, newStatus: 'demoted', reason: 'redundant — overlaps with foundation skills', overlap },
            };
          }

          // Check 2: Hard cap of 5 active learned skills
          const activeCount = await prisma.learnedSkill.count({ where: { status: 'active' } });

          if (activeCount >= 5) {
            // Find the lowest-confidence active skill
            const weakest = await prisma.learnedSkill.findFirst({
              where: { status: 'active' },
              orderBy: { confidence: 'asc' },
            });

            if (weakest && newConfidence > weakest.confidence) {
              // Displace the weakest
              await prisma.learnedSkill.update({
                where: { id: weakest.id },
                data: { status: 'demoted' },
              });
            } else {
              // New skill isn't strong enough to displace any existing skill
              log.info('Skill promotion check', {
                skillId: skill.id,
                overlap,
                activeCount,
                promoted: false,
              });

              return {
                success: true,
                data: { id: skill.id, newStatus: 'candidate', reason: 'cap reached — not strong enough to displace existing skills' },
              };
            }
          }

          log.info('Skill promotion check', {
            skillId: skill.id,
            overlap,
            activeCount: await prisma.learnedSkill.count({ where: { status: 'active' } }),
            promoted: true,
          });

          newStatus = 'active';
        } else if (newConfidence < 0.5 && skill.status === 'active') {
          newStatus = 'demoted';
        }

        const updated = await prisma.learnedSkill.update({
          where: { id: skill.id },
          data: { confidence: newConfidence, sourceOutcomes: newOutcomes, status: newStatus },
        });

        // Invalidate Redis cache on status change
        if (newStatus !== skill.status && redis) {
          const keys = await redis.keys('skills:learned:*');
          if (keys.length > 0) await redis.del(...keys);
        }

        return { success: true, data: { id: updated.id, newStatus, newConfidence } };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  };

  return [
    scanWarmMemories,
    extractPatterns,
    pruneOutdated,
    generateTenantProfile,
    consolidateMemories,
    readOutcomeBatch,
    extractSkillCandidate,
    updateSkillConfidence,
  ];
}
