// mvp/src/services/agents/ba/tools.ts

import type { AgentTool, AgentContext, ToolResult } from '../../agent-runtime/types.js';
import type { CommunicationRouter } from '../../communication/router.js';
import type { MemoryService } from '../../memory/memory.service.js';
import { sanitizeForAI } from '../../../lib/sanitize.js';

export interface BAToolDeps {
  prisma: any;
  commsRouter: CommunicationRouter;
  memoryService: MemoryService;
}

/**
 * Creates the 5 tools available to the Business Analyst Agent:
 *
 * 1. read_transcript      — Read a meeting transcript from the database
 * 2. recall_tenant_context — Retrieve tenant memories (preferences, conventions)
 * 3. create_prd            — Create a PRD document in the database
 * 4. ask_clarification     — Ask a team member a clarifying question
 * 5. check_existing_backlog — Check for duplicate/related PRDs
 */
export function createBATools(deps: BAToolDeps): AgentTool[] {
  const { prisma, commsRouter, memoryService } = deps;

  // ---- 1. read_transcript ----

  const readTranscript: AgentTool = {
    name: 'read_transcript',
    description:
      'Read the full meeting transcript including speakers, segments, and full text. ' +
      'The meetingId is taken from context.memory.meetingId.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (
      _input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const meetingId = context.memory.meetingId as string;
        if (!meetingId) {
          return { success: false, error: 'No meetingId found in context.memory' };
        }

        const transcript = await prisma.transcript.findUnique({
          where: { meetingId },
          include: {
            meeting: {
              select: {
                id: true,
                title: true,
                participants: true,
                startTime: true,
                endTime: true,
                metadata: true,
              },
            },
          },
        });

        if (!transcript) {
          return { success: false, error: `No transcript found for meeting ${meetingId}` };
        }

        return {
          success: true,
          data: {
            meetingTitle: transcript.meeting.title,
            participants: transcript.meeting.participants,
            startTime: transcript.meeting.startTime,
            endTime: transcript.meeting.endTime,
            // Sanitize user-generated transcript content before it enters the agent loop
            fullText: sanitizeForAI(transcript.fullText),
            segments: transcript.segments,
            speakers: transcript.speakers,
            wordCount: transcript.wordCount,
            duration: transcript.duration,
            meetingMetadata: transcript.meeting.metadata,
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

  // ---- 2. recall_tenant_context ----

  const recallTenantContext: AgentTool = {
    name: 'recall_tenant_context',
    description:
      'Retrieve tenant memories including preferences, conventions, patterns, and past decisions. ' +
      'Use this to apply tenant-specific conventions to the PRD.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['preference', 'convention', 'pattern', 'decision', 'feedback'],
          },
          description:
            'Optional list of memory categories to filter. Defaults to all categories.',
        },
      },
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const categories = input.categories as string[] | undefined;

        const memories = await memoryService.getContext(context.tenantId, {
          categories: categories as any,
        });

        return {
          success: true,
          data: {
            count: memories.length,
            memories: memories.map((m) => ({
              category: m.category,
              key: m.key,
              value: m.value,
              confidence: m.confidence,
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

  // ---- 3. create_prd ----

  const createPrd: AgentTool = {
    name: 'create_prd',
    description:
      'Create a Product Requirements Document in the database. ' +
      'Uses meetingId and taskId from context.memory.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'PRD title' },
        summary: { type: 'string', description: 'Executive summary' },
        objectives: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of objectives',
        },
        requirements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
              acceptanceCriteria: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          description: 'Array of requirements with priorities and acceptance criteria',
        },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'High-level acceptance criteria for the entire PRD',
        },
        outOfScope: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicitly out-of-scope items',
        },
        assumptions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Assumptions made during analysis',
        },
        risks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              impact: { type: 'string', enum: ['low', 'medium', 'high'] },
              mitigation: { type: 'string' },
            },
          },
          description: 'Identified risks with impact and mitigation',
        },
        confidence: {
          type: 'number',
          description: 'Confidence score for this PRD (0.0 to 1.0)',
        },
      },
      required: ['title', 'summary', 'requirements'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const meetingId = context.memory.meetingId as string;
        const taskId = context.memory.taskId as string;

        if (!meetingId) {
          return { success: false, error: 'No meetingId found in context.memory' };
        }
        if (!taskId) {
          return { success: false, error: 'No taskId found in context.memory' };
        }

        const prd = await prisma.pRD.create({
          data: {
            taskId,
            meetingId,
            tenantId: context.tenantId,
            title: input.title as string,
            summary: input.summary as string,
            objectives: (input.objectives as string[]) ?? [],
            requirements: (input.requirements as unknown[]) ?? [],
            acceptanceCriteria: (input.acceptanceCriteria as string[]) ?? [],
            outOfScope: (input.outOfScope as string[]) ?? [],
            assumptions: (input.assumptions as string[]) ?? [],
            risks: (input.risks as unknown[]) ?? [],
            confidence: (input.confidence as number) ?? 0,
            status: 'draft',
            version: 1,
          },
        });

        return {
          success: true,
          data: {
            prdId: prd.id,
            title: prd.title,
            status: prd.status,
            confidence: prd.confidence,
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

  // ---- 4. ask_clarification ----

  const askClarification: AgentTool = {
    name: 'ask_clarification',
    description:
      'Ask a team member a clarifying question via the communication router. ' +
      'Route to the correct role: pm, cto, founder, designer, etc. ' +
      'Uses taskId from context.memory.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The clarification question' },
        questionContext: {
          type: 'string',
          description: 'Context explaining why this question matters',
        },
        routeTo: {
          type: 'string',
          enum: ['pm', 'cto', 'founder', 'tech_lead', 'product_lead', 'designer', 'stakeholder'],
          description: 'Role to route the question to',
        },
        urgency: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Urgency level of the question',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Suggested answer options (if applicable)',
        },
      },
      required: ['question', 'questionContext', 'routeTo'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const taskId = context.memory.taskId as string;
        if (!taskId) {
          return { success: false, error: 'No taskId found in context.memory' };
        }

        // Create clarification record in database
        const clarification = await prisma.clarificationRequest.create({
          data: {
            taskId,
            question: input.question as string,
            context: input.questionContext as string,
            routeTo: input.routeTo as string,
            urgency: (input.urgency as string) ?? 'medium',
            options: (input.options as string[]) ?? null,
            status: 'pending',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
          },
        });

        // Send via communication router
        const sendResult = await commsRouter.send({
          tenantId: context.tenantId,
          engagementId: context.engagementId,
          recipientRole: input.routeTo as string,
          messageType: 'clarification',
          content: `Clarification needed:\n\n${input.question}\n\nContext: ${input.questionContext}`,
          metadata: {
            clarificationId: clarification.id,
            taskId,
            options: input.options,
          },
          urgency: (input.urgency as 'low' | 'medium' | 'high') ?? 'medium',
        });

        return {
          success: true,
          data: {
            clarificationId: clarification.id,
            routedTo: input.routeTo,
            messageSent: sendResult.success,
            channel: sendResult.channel,
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

  // ---- 5. check_existing_backlog ----

  const checkExistingBacklog: AgentTool = {
    name: 'check_existing_backlog',
    description:
      'Check for duplicate or related PRDs in the tenant backlog. ' +
      'Search by keyword in title or summary to avoid creating redundant PRDs.',
    inputSchema: {
      type: 'object',
      properties: {
        searchTerms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords to search for in existing PRD titles and summaries',
        },
        limit: {
          type: 'number',
          description: 'Max number of results to return (default: 10)',
        },
      },
      required: ['searchTerms'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const searchTerms = input.searchTerms as string[];
        const limit = (input.limit as number) ?? 10;

        // Search PRDs by tenant, matching any search term in title or summary
        const orConditions = searchTerms.flatMap((term) => [
          { title: { contains: term, mode: 'insensitive' as const } },
          { summary: { contains: term, mode: 'insensitive' as const } },
        ]);

        const existingPrds = await prisma.pRD.findMany({
          where: {
            tenantId: context.tenantId,
            OR: orConditions,
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            title: true,
            summary: true,
            status: true,
            confidence: true,
            version: true,
            createdAt: true,
          },
        });

        return {
          success: true,
          data: {
            count: existingPrds.length,
            prds: existingPrds.map((p: any) => ({
              id: p.id,
              title: p.title,
              summary: p.summary.substring(0, 200),
              status: p.status,
              confidence: p.confidence,
              version: p.version,
              createdAt: p.createdAt,
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

  return [
    readTranscript,
    recallTenantContext,
    createPrd,
    askClarification,
    checkExistingBacklog,
  ];
}
