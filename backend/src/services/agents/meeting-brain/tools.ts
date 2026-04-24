// mvp/src/services/agents/meeting-brain/tools.ts

import type { AgentTool, AgentContext, ToolResult } from '../../agent-runtime/types.js';
import type { MemoryService } from '../../memory/memory.service.js';

export interface MeetingBrainToolDeps {
  prisma: any;
  memoryService: MemoryService;
}

/**
 * Creates the 5 tools available to the Meeting Brain Agent:
 *
 * 1. analyze_transcript       — Analyze raw transcript text, identify speakers, extract key quotes and topics
 * 2. identify_participants    — Extract participant names, infer roles from conversation context
 * 3. extract_decisions        — Identify decisions made during the meeting
 * 4. extract_action_items     — Identify action items with assignees and deadlines
 * 5. create_meeting_summary   — Generate structured summary with all sections
 */
export function createMeetingBrainTools(deps: MeetingBrainToolDeps): AgentTool[] {
  const { prisma, memoryService } = deps;

  // ---- 1. analyze_transcript ----

  const analyzeTranscript: AgentTool = {
    name: 'analyze_transcript',
    description:
      'Analyze raw transcript text to identify speakers, extract key quotes, and determine main topics. ' +
      'The meetingId is taken from context.memory.meetingId. If transcript text is provided as input, it is used directly.',
    inputSchema: {
      type: 'object',
      properties: {
        transcript: {
          type: 'string',
          description: 'Raw transcript text to analyze. If omitted, reads from database using meetingId.',
        },
      },
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        let fullText = input.transcript as string | undefined;
        let speakers: string[] = [];
        let segments: unknown[] = [];
        let meetingTitle = '';

        if (!fullText) {
          const meetingId = context.memory.meetingId as string;
          if (!meetingId) {
            return { success: false, error: 'No meetingId in context.memory and no transcript text provided' };
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
                },
              },
            },
          });

          if (!transcript) {
            return { success: false, error: `No transcript found for meeting ${meetingId}` };
          }

          fullText = transcript.fullText;
          speakers = transcript.speakers ?? [];
          segments = transcript.segments ?? [];
          meetingTitle = transcript.meeting.title ?? '';
        } else {
          // Parse speakers from raw transcript text (lines like "Speaker: ...")
          const speakerPattern = /^([A-Za-z][A-Za-z\s.'-]+?):\s/gm;
          const foundSpeakers = new Set<string>();
          let match: RegExpExecArray | null;
          while ((match = speakerPattern.exec(fullText)) !== null) {
            foundSpeakers.add(match[1].trim());
          }
          speakers = Array.from(foundSpeakers);
        }

        // Extract basic topic indicators (words that appear frequently)
        const words = (fullText || '').toLowerCase().split(/\s+/);
        const wordCount = words.length;

        return {
          success: true,
          data: {
            meetingTitle,
            speakers,
            segmentCount: segments.length,
            wordCount,
            fullText,
            segments,
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

  // ---- 2. identify_participants ----

  const identifyParticipants: AgentTool = {
    name: 'identify_participants',
    description:
      'Extract participant names and infer their roles from conversation context. ' +
      'Takes a list of participant data extracted from the transcript analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        participants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Participant name' },
              role: { type: 'string', description: 'Inferred role (e.g., PM, Engineer, Designer)' },
              confidence: {
                type: 'number',
                description: 'Confidence in the role inference (0.0 to 1.0)',
              },
              keyStatements: {
                type: 'array',
                items: { type: 'string' },
                description: 'Key statements made by this participant',
              },
            },
          },
          description: 'List of identified participants with inferred roles',
        },
      },
      required: ['participants'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const participants = input.participants as Array<{
          name: string;
          role?: string;
          confidence?: number;
          keyStatements?: string[];
        }>;

        if (!participants || participants.length === 0) {
          return { success: false, error: 'No participants provided' };
        }

        // Enrich with any known tenant context
        let knownRoles: Record<string, string> = {};
        try {
          const memories = await memoryService.getContext(context.tenantId, {
            categories: ['convention'] as any,
          });
          const rolesMemory = memories.find((m) => m.key === 'team_roles');
          if (rolesMemory?.value) {
            knownRoles = rolesMemory.value as Record<string, string>;
          }
        } catch {
          // Memory lookup is best-effort
        }

        const enrichedParticipants = participants.map((p) => ({
          name: p.name,
          role: knownRoles[p.name] ?? p.role ?? 'unknown',
          confidence: knownRoles[p.name] ? 1.0 : (p.confidence ?? 0.5),
          keyStatements: p.keyStatements ?? [],
          roleSource: knownRoles[p.name] ? 'tenant_memory' : 'inferred',
        }));

        return {
          success: true,
          data: {
            count: enrichedParticipants.length,
            participants: enrichedParticipants,
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

  // ---- 3. extract_decisions ----

  const extractDecisions: AgentTool = {
    name: 'extract_decisions',
    description:
      'Identify decisions made during the meeting. For each decision, capture what was decided, ' +
      'who made or drove the decision, and the surrounding context.',
    inputSchema: {
      type: 'object',
      properties: {
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'What was decided' },
              madeBy: { type: 'string', description: 'Who made or drove the decision' },
              context: {
                type: 'string',
                description: 'Surrounding context or rationale',
              },
              confidence: {
                type: 'number',
                description: 'Confidence that this is a real decision vs discussion (0.0 to 1.0)',
              },
            },
          },
          description: 'List of decisions identified in the transcript',
        },
      },
      required: ['decisions'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const decisions = input.decisions as Array<{
          description: string;
          madeBy: string;
          context: string;
          confidence?: number;
        }>;

        if (!decisions) {
          return { success: false, error: 'No decisions provided' };
        }

        // Store decisions in memory for future reference
        const meetingId = context.memory.meetingId as string;
        if (meetingId && decisions.length > 0) {
          try {
            await memoryService.remember(context.tenantId, {
              key: `meeting_decisions_${meetingId}`,
              category: 'decision' as any,
              value: decisions,
              source: 'meeting_transcript',
              confidence: Math.min(
                ...decisions.map((d) => d.confidence ?? 0.5),
              ),
            });
          } catch {
            // Memory storage is best-effort
          }
        }

        return {
          success: true,
          data: {
            count: decisions.length,
            decisions: decisions.map((d) => ({
              description: d.description,
              madeBy: d.madeBy,
              context: d.context,
              confidence: d.confidence ?? 0.5,
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

  // ---- 4. extract_action_items ----

  const extractActionItems: AgentTool = {
    name: 'extract_action_items',
    description:
      'Identify action items from the meeting. For each item, capture the task description, ' +
      'who is responsible, any deadline mentioned, and priority level.',
    inputSchema: {
      type: 'object',
      properties: {
        actionItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'What needs to be done' },
              assignee: {
                type: 'string',
                description: 'Who is responsible (use "unassigned" if not specified)',
              },
              deadline: {
                type: 'string',
                description: 'Deadline if mentioned (ISO date string or descriptive)',
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Priority level',
              },
            },
          },
          description: 'List of action items identified in the transcript',
        },
      },
      required: ['actionItems'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const actionItems = input.actionItems as Array<{
          description: string;
          assignee: string;
          deadline?: string;
          priority: string;
        }>;

        if (!actionItems) {
          return { success: false, error: 'No action items provided' };
        }

        // Store action items in memory for future reference
        const meetingId = context.memory.meetingId as string;
        if (meetingId && actionItems.length > 0) {
          try {
            await memoryService.remember(context.tenantId, {
              key: `meeting_actions_${meetingId}`,
              category: 'decision' as any,
              value: actionItems,
              source: 'meeting_transcript',
              confidence: 0.8,
            });
          } catch {
            // Memory storage is best-effort
          }
        }

        return {
          success: true,
          data: {
            count: actionItems.length,
            actionItems: actionItems.map((item) => ({
              description: item.description,
              assignee: item.assignee || 'unassigned',
              deadline: item.deadline ?? null,
              priority: item.priority || 'medium',
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

  // ---- 5. create_meeting_summary ----

  const createMeetingSummary: AgentTool = {
    name: 'create_meeting_summary',
    description:
      'Generate a structured meeting summary with sections: participants, key topics, ' +
      'decisions, action items, and follow-ups. Stores the summary in the database.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Meeting title' },
        topics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key topics discussed',
        },
        keyPoints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key points and takeaways',
        },
        participants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
            },
          },
          description: 'Meeting participants with roles',
        },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              madeBy: { type: 'string' },
              context: { type: 'string' },
            },
          },
          description: 'Decisions made during the meeting',
        },
        actionItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              assignee: { type: 'string' },
              deadline: { type: 'string' },
              priority: { type: 'string' },
            },
          },
          description: 'Action items from the meeting',
        },
        followUps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Follow-up items or next steps',
        },
        confidence: {
          type: 'number',
          description: 'Overall confidence score for the summary (0.0 to 1.0)',
        },
      },
      required: ['title', 'topics', 'keyPoints'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const meetingId = context.memory.meetingId as string;
        if (!meetingId) {
          return { success: false, error: 'No meetingId found in context.memory' };
        }

        const title = input.title as string;
        const topics = (input.topics as string[]) ?? [];
        const keyPoints = (input.keyPoints as string[]) ?? [];
        const participants = (input.participants as unknown[]) ?? [];
        const decisions = (input.decisions as unknown[]) ?? [];
        const actionItems = (input.actionItems as unknown[]) ?? [];
        const followUps = (input.followUps as string[]) ?? [];
        const confidence = (input.confidence as number) ?? 0;

        // Compose summary text from title, keyPoints, and followUps
        const summaryParts = [`# ${title}`];
        if (keyPoints.length > 0) {
          summaryParts.push('\n## Key Points');
          keyPoints.forEach((p) => summaryParts.push(`- ${p}`));
        }
        if (followUps.length > 0) {
          summaryParts.push('\n## Follow-Ups');
          followUps.forEach((f) => summaryParts.push(`- ${f}`));
        }
        const summaryText = summaryParts.join('\n');

        // Map confidence to sentiment
        const sentiment = confidence >= 0.7 ? 'positive' : confidence >= 0.4 ? 'neutral' : 'concerned';

        // Store in database using MeetingInsights model
        const stored = await prisma.meetingInsights.create({
          data: {
            meetingId,
            tenantId: context.tenantId,
            summary: summaryText,
            topics,
            actionItems,
            decisions,
            participantStats: participants,
            sentiment,
          },
        });

        return {
          success: true,
          data: {
            summaryId: stored.id,
            title,
            topicCount: topics.length,
            decisionCount: decisions.length,
            actionItemCount: actionItems.length,
            confidence,
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
    analyzeTranscript,
    identifyParticipants,
    extractDecisions,
    extractActionItems,
    createMeetingSummary,
  ];
}
