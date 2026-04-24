// mvp/src/services/agents/supervisor/tools.ts

import type { AgentTool, AgentContext, ToolResult } from '../../agent-runtime/types.js';
import type { EngagementService } from '../../engagement/engagement.service.js';
import type { QueueService } from '../../queue/queue.service.js';
import { JobType } from '../../queue/queue.service.js';

export interface SupervisorToolDeps {
  engagementService: EngagementService;
  queueService: QueueService;
}

/**
 * Creates the 5 MCP tools available to the Supervisor Agent:
 *
 * 1. create_engagement  — Create a new engagement from a completed meeting
 * 2. advance_engagement — Move an engagement to its next phase
 * 3. list_engagements   — List active engagements for a tenant
 * 4. pause_engagement   — Pause an engagement (e.g. low confidence)
 * 5. dispatch_agent     — Dispatch a specialized agent for a phase (stub)
 */
export function createSupervisorTools(deps: SupervisorToolDeps): AgentTool[] {
  const { engagementService, queueService } = deps;

  const createEngagement: AgentTool = {
    name: 'create_engagement',
    description:
      'Create a new engagement from a completed meeting. Starts in the "listen" phase.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title for the engagement' },
        meetingId: { type: 'string', description: 'ID of the source meeting' },
        metadata: {
          type: 'object',
          description: 'Optional metadata about the engagement',
        },
      },
      required: ['title', 'meetingId'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const engagement = await engagementService.create(context.tenantId, {
          title: input.title as string,
          meetingId: input.meetingId as string,
          metadata: (input.metadata as Record<string, unknown>) ?? undefined,
        });

        return {
          success: true,
          data: {
            engagementId: engagement.id,
            phase: engagement.phase,
            status: engagement.status,
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

  const advanceEngagement: AgentTool = {
    name: 'advance_engagement',
    description:
      'Advance an engagement to its next phase. Validates transitions and enforces confidence gating.',
    inputSchema: {
      type: 'object',
      properties: {
        engagementId: {
          type: 'string',
          description: 'ID of the engagement to advance',
        },
        confidence: {
          type: 'number',
          description: 'Confidence score (0-1) for this phase transition',
        },
        targetPhase: {
          type: 'string',
          description: 'Optional specific target phase (validated against transitions)',
        },
        output: {
          type: 'object',
          description: 'Phase output data to store',
        },
      },
      required: ['engagementId'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const updated = await engagementService.advancePhase(
          context.tenantId,
          input.engagementId as string,
          {
            confidence: input.confidence as number | undefined,
            targetPhase: input.targetPhase as any,
            output: input.output as Record<string, unknown> | undefined,
          },
        );

        return {
          success: true,
          data: {
            engagementId: updated.id,
            phase: updated.phase,
            status: updated.status,
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

  const listEngagements: AgentTool = {
    name: 'list_engagements',
    description:
      'List engagements for a tenant, optionally filtered by status (active, paused, completed, failed).',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'paused', 'completed', 'failed'],
          description: 'Filter by engagement status',
        },
      },
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const engagements = await engagementService.listByTenant(
          context.tenantId,
          input.status as any,
        );

        return {
          success: true,
          data: {
            count: engagements.length,
            engagements: engagements.map((e: any) => ({
              id: e.id,
              title: e.title,
              phase: e.phase,
              status: e.status,
              confidence: e.confidence,
              agentType: e.agentType,
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

  const pauseEngagement: AgentTool = {
    name: 'pause_engagement',
    description:
      'Pause an active engagement, optionally providing a reason.',
    inputSchema: {
      type: 'object',
      properties: {
        engagementId: {
          type: 'string',
          description: 'ID of the engagement to pause',
        },
        reason: {
          type: 'string',
          description: 'Reason for pausing',
        },
      },
      required: ['engagementId'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const paused = await engagementService.pause(
          context.tenantId,
          input.engagementId as string,
          input.reason as string | undefined,
        );

        return {
          success: true,
          data: {
            engagementId: paused.id,
            status: paused.status,
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

  const dispatchAgent: AgentTool = {
    name: 'dispatch_agent',
    description:
      'Dispatch a specialized agent to work on a specific engagement phase via BullMQ job queue.',
    inputSchema: {
      type: 'object',
      properties: {
        engagementId: {
          type: 'string',
          description: 'ID of the engagement',
        },
        agentType: {
          type: 'string',
          description:
            'Type of agent to dispatch (meeting_brain, ba_agent, dev_agent, qa_agent, memory_optimizer)',
        },
        task: {
          type: 'string',
          description: 'Task description for the dispatched agent',
        },
        meetingId: {
          type: 'string',
          description: 'Meeting ID (required for ba_agent dispatch)',
        },
        transcript: {
          type: 'string',
          description: 'Meeting transcript text (required for ba_agent dispatch)',
        },
        taskId: {
          type: 'string',
          description: 'Agent task ID (required for ba_agent dispatch)',
        },
      },
      required: ['engagementId', 'agentType', 'task'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const agentType = input.agentType as string;
        const engagementId = input.engagementId as string;

        if (agentType === 'ba_agent') {
          const jobId = await queueService.addJob(JobType.BA_AGENT_PROCESS, {
            taskId: (input.taskId as string) || `task-${engagementId}`,
            tenantId: context.tenantId,
            meetingId: (input.meetingId as string) || '',
            transcript: (input.transcript as string) || '',
          });

          return {
            success: true,
            data: {
              dispatched: true,
              engagementId,
              agentType,
              jobId,
              queue: JobType.BA_AGENT_PROCESS,
              message: 'BA agent dispatched via BullMQ',
            },
          };
        }

        // Route to dedicated job queues by agent type
        const taskId = (input.taskId as string) || `task-${engagementId}`;
        const tenantId = context.tenantId;
        let jobId: unknown;
        let queue: string;

        if (agentType === 'dev_agent') {
          queue = JobType.DEV_AGENT_PROCESS;
          jobId = await queueService.addJob(JobType.DEV_AGENT_PROCESS, {
            prdId: (input.prdId as string) || '',
            engagementId,
            tenantId,
            taskId,
          });
        } else if (agentType === 'qa_agent') {
          queue = JobType.QA_AGENT_PROCESS;
          jobId = await queueService.addJob(JobType.QA_AGENT_PROCESS, {
            prdId: (input.prdId as string) || '',
            prNumber: (input.prNumber as number) || 0,
            engagementId,
            tenantId,
            taskId,
          });
        } else if (agentType === 'memory_optimizer') {
          queue = JobType.MEMORY_OPTIMIZER;
          jobId = await queueService.addJob(JobType.MEMORY_OPTIMIZER, {
            tenantId,
            trigger: 'engagement_complete' as const,
            engagementId,
          });
        } else {
          // Fallback for unknown agent types: send notification
          queue = JobType.NOTIFICATION;
          jobId = await queueService.addJob(JobType.NOTIFICATION, {
            type: 'gchat',
            tenantId,
            payload: {
              type: 'info',
              title: `Agent Dispatched: ${agentType}`,
              message: `Agent ${agentType} dispatched for engagement ${engagementId}. Task: ${input.task}`,
              metadata: { engagementId, agentType },
            },
          });
        }

        return {
          success: true,
          data: {
            dispatched: true,
            engagementId,
            agentType,
            jobId,
            queue,
            message: `Agent ${agentType} dispatched via BullMQ`,
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
    createEngagement,
    advanceEngagement,
    listEngagements,
    pauseEngagement,
    dispatchAgent,
  ];
}
