/**
 * =============================================================================
 * AGENTS API ROUTES
 * =============================================================================
 *
 * REST API endpoints for agent tasks and PRD management.
 *
 * Endpoints:
 * ----------
 * POST   /agents/ba/process  → Trigger BA Agent processing
 * GET    /agents/tasks       → List agent tasks
 * GET    /agents/tasks/:id   → Get task details
 * POST   /agents/tasks/:id/approve → Approve a task result
 *
 * PRD Endpoints:
 * --------------
 * GET    /prds              → List PRDs for tenant
 * GET    /prds/:id          → Get PRD details
 * GET    /prds/:id/download → Download PRD as Markdown file
 * POST   /prds/:id/approve  → Approve PRD for ticket creation
 * POST   /prds/:id/reject   → Reject PRD
 * POST   /prds/:id/tickets  → Create Jira tickets from PRD
 *
 * Clarification Endpoints:
 * ------------------------
 * GET    /clarifications           → List pending clarifications
 * POST   /clarifications/:id/respond → Respond to clarification
 *
 * @module routes/agents
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';
import { JobType } from '../services/queue/processors.js';
import { JobType as QueueJobType } from '../services/queue/queue.service.js';
import { requireAdmin, requireMember } from '../middleware/rbac.middleware.js';

const logger = createChildLogger({ route: 'agents' });

/**
 * Schema for triggering BA Agent processing.
 */
const ProcessTranscriptSchema = z.object({
  meetingId: z.string().min(1).describe('Meeting ID to process'),
  options: z.object({
    additionalContext: z.string().optional(),
    temperature: z.number().min(0).max(1).optional(),
  }).optional(),
});

/**
 * Schema for listing tasks.
 */
const ListTasksQuerySchema = z.object({
  status: z.enum(['pending', 'processing', 'awaiting_clarification', 'awaiting_approval', 'approved', 'rejected', 'completed', 'failed']).optional(),
  agentType: z.enum(['ba_agent', 'dev_agent', 'qa_agent', 'sales_agent', 'marketing_agent']).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

/**
 * Schema for listing PRDs.
 */
const ListPRDsQuerySchema = z.object({
  status: z.enum(['draft', 'review', 'pending_approval', 'approved', 'rejected', 'needs_clarification']).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

/**
 * Schema for creating Jira tickets.
 */
const CreateTicketsSchema = z.object({
  projectKey: z.string().min(1).max(10).regex(/^[A-Z][A-Z0-9]*$/, 'Project key must be uppercase alphanumeric'),
  epicKey: z.string().optional(),
});

/**
 * Schema for clarification response.
 */
const ClarificationResponseSchema = z.object({
  answer: z.string().min(1).describe('Answer to the clarification question'),
  selectedOptionIndex: z.number().optional().describe('Index of selected option if applicable'),
});

/**
 * Register agent routes.
 *
 * @param fastify - Fastify instance
 */
export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  // =========================================================================
  // TASK ENDPOINTS
  // =========================================================================

  /**
   * Trigger BA Agent to process a meeting transcript.
   *
   * POST /agents/ba/process
   *
   * This creates a task and queues it for processing.
   * The actual PRD generation happens asynchronously.
   */
  fastify.post(
    '/ba/process',
    {
      preHandler: [requireMember],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        description: 'Trigger BA Agent to process a meeting transcript',
        tags: ['Agents'],
        body: {
          type: 'object',
          required: ['meetingId'],
          properties: {
            meetingId: { type: 'string', minLength: 1 },
            options: {
              type: 'object',
              properties: {
                additionalContext: { type: 'string' },
                temperature: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const body = ProcessTranscriptSchema.parse(request.body);

      logger.info('Triggering BA Agent processing', {
        tenantId,
        meetingId: body.meetingId,
      });

      const { meetingRepository, taskRepository, queueService } = fastify.services;

      // Get the transcript and verify tenant ownership
      const meeting = await meetingRepository.findByIdWithTranscript(body.meetingId);
      if (!meeting?.transcript) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Transcript not found for meeting' },
        });
      }
      if (meeting.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Meeting not found' },
        });
      }

      // N6 final: ticket-first primary write. The Ticket row drives
      // visibility (/dashboard, /library, chief_of_staff); the
      // reverse-mirror AgentTask stays alive for legacy readers
      // (BAAgentService's state machine, outcome observer).
      const created = await fastify.services.ticketService.createAsNewWork({
        tenantId,
        roleSlug: 'ba_agent',
        title: meeting.title || `Meeting ${body.meetingId}`,
        meetingId: body.meetingId,
        agentTaskInput: {
          type: 'meeting_transcript',
          meetingId: body.meetingId,
          transcriptId: (meeting.transcript as unknown as { id: string }).id,
          options: body.options,
        },
        payload: {
          type: 'meeting_transcript',
          meetingId: body.meetingId,
          transcriptId: (meeting.transcript as unknown as { id: string }).id,
        },
      });
      const task = { id: created.agentTaskId };

      // Dispatch to queue - DON'T AWAIT the processing
      // The queue worker will handle the heavy lifting
      await queueService.addJob(JobType.BA_AGENT_PROCESS, {
        taskId: task.id,
        tenantId,
        meetingId: body.meetingId,
        transcript: (meeting.transcript as unknown as { fullText: string }).fullText,
      });

      logger.info('BA Agent job dispatched to queue', {
        taskId: task.id,
        meetingId: body.meetingId,
      });

      // Return 202 Accepted IMMEDIATELY
      // Client polls /agents/tasks/:id for status
      return reply.status(202).send({
        success: true,
        data: {
          taskId: task.id,
          status: 'queued',
          statusUrl: `/api/agents/tasks/${task.id}`,
        },
        message: 'Processing started. Poll the statusUrl for updates.',
      });
    }
  );

  /**
   * List agent tasks.
   *
   * GET /agents/tasks
   */
  fastify.get(
    '/tasks',
    {
      schema: {
        description: 'List agent tasks for the tenant',
        tags: ['Agents'],
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            agentType: { type: 'string', enum: ['ba_agent', 'dev_agent', 'qa_agent', 'sales_agent', 'marketing_agent'] },
            limit: { type: 'integer', default: 20 },
            offset: { type: 'integer', default: 0 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const query = ListTasksQuerySchema.parse(request.query);

      logger.debug('Listing tasks', { tenantId, ...query });

      const taskRepository = fastify.services.taskRepository;
      const tasks = await taskRepository.findTasks({
        tenantId,
        status: query.status as any,
        agentType: query.agentType as any,
        take: query.limit,
        skip: query.offset,
      });

      return reply.send({
        success: true,
        data: tasks,
      });
    }
  );

  /**
   * Get task details.
   *
   * GET /agents/tasks/:id
   */
  fastify.get(
    '/tasks/:id',
    {
      schema: {
        tags: ['Agents'],
      } as any,
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;

      const taskRepository = fastify.services.taskRepository;
      const task = await taskRepository.findByIdWithClarifications(id);

      if (!task || task.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
      }

      return reply.send({
        success: true,
        data: task,
      });
    }
  );

  // =========================================================================
  // PRD ENDPOINTS
  // =========================================================================

  /**
   * List PRDs for tenant.
   *
   * GET /prds
   */
  fastify.get(
    '/prds',
    {
      schema: {
        description: 'List PRDs for the tenant',
        tags: ['PRDs'],
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['draft', 'review', 'approved', 'rejected'] },
            limit: { type: 'integer', default: 20 },
            offset: { type: 'integer', default: 0 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const query = ListPRDsQuerySchema.parse(request.query);

      const prdRepository = fastify.services.prdRepository;
      const prds = await prdRepository.findByTenant(tenantId, query.status, {
        take: query.limit,
        skip: query.offset,
      });

      return reply.send({
        success: true,
        data: prds,
      });
    }
  );

  /**
   * Get PRD details with tickets.
   *
   * GET /prds/:id
   */
  fastify.get(
    '/prds/:id',
    {
      schema: {
        tags: ['PRDs'],
      } as any,
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;

      const prdRepository = fastify.services.prdRepository;
      const prd = await prdRepository.findByIdWithTickets(id);

      if (!prd || prd.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'PRD not found' },
        });
      }

      return reply.send({
        success: true,
        data: prd,
      });
    }
  );

  /**
   * Approve a PRD.
   *
   * POST /prds/:id/approve
   */
  fastify.post(
    '/prds/:id/approve',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['PRDs'],
      } as any,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params as { id: string };

      logger.info('Approving PRD', { prdId: id });

      const prdRepository = fastify.services.prdRepository;

      // Verify PRD exists and belongs to tenant
      const existing = await prdRepository.findById(id);
      if (!existing || existing.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'PRD not found' },
        });
      }

      // Status guard: only allow approval from draft or pending_approval
      if (existing.status !== 'draft' && existing.status !== 'pending_approval') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATUS', message: `Cannot approve PRD with status '${existing.status}'. Must be 'draft' or 'pending_approval'.` },
        });
      }

      const prd = await prdRepository.updateStatus(id, 'approved');

      // Auto-trigger: advance engagement to 'build' phase and queue Dev Agent
      const { engagementService, queueService, taskRepository } = fastify.services;
      try {
        // Find the engagement linked to this PRD's meeting
        // PRD has meetingId directly — use that
        const prdRecord = await fastify.services.prisma.pRD.findUnique({
          where: { id },
          select: { meetingId: true },
        });

        let engagementId: string | null = null;

        if (prdRecord?.meetingId) {
          const engagement = await fastify.services.prisma.engagement.findFirst({
            where: { tenantId, meetingId: prdRecord.meetingId, status: 'active' },
            orderBy: { createdAt: 'desc' },
          });

          if (engagement) {
            engagementId = engagement.id;
            // Advance from 'approve' to 'build'
            await engagementService.advancePhase(tenantId, engagement.id, {
              confidence: 1.0,
              targetPhase: 'build' as any,
              output: { prdId: id, approvedAt: new Date().toISOString() },
            });
            logger.info('Engagement advanced to build phase', { engagementId: engagement.id, prdId: id });
          }
        }

        // Queue Dev Agent directly ONLY when there's no engagement. When an
        // engagement exists, `engagementService.advancePhase` above already
        // auto-dispatches for the 'build' phase, so queuing here would
        // spawn a duplicate job.
        if (!engagementId) {
          // N6 final: ticket-first primary write (see MEETING_PROCESS + the
          // other briefs-POST path in this file).
          const created = await fastify.services.ticketService.createAsNewWork({
            tenantId,
            roleSlug: 'dev_agent',
            title: `Implement PRD ${id}`,
            agentTaskInput: { type: 'prd_implementation', prdId: id },
            payload: { type: 'prd_implementation', prdId: id },
          });
          const devTask = { id: created.agentTaskId };

          await queueService.addJob(QueueJobType.DEV_AGENT_PROCESS, {
            prdId: id,
            engagementId: '',
            tenantId,
            taskId: devTask.id,
            ticketId: created.ticket.id,
          });

          logger.info('Dev Agent queued directly (no engagement)', {
            prdId: id,
            taskId: devTask.id,
            ticketId: created.ticket.id,
          });
        } else {
          logger.info('Dev Agent dispatch delegated to engagement.advancePhase', { prdId: id, engagementId });
        }

        // Active initiation: if a conversation thread exists for this
        // engagement/PRD, drop a BA handoff note so the thread reflects
        // the state change without forcing a human to poke the bot.
        // Graceful no-op when there's no thread — we don't spawn new
        // ones, we just reuse what's already live.
        await postApprovalHandoff(
          {
            orchestrator: fastify.services.conversationOrchestratorService,
            prisma: fastify.services.prisma,
          },
          { tenantId, prdId: id, engagementId },
        );
      } catch (err) {
        // Non-fatal: PRD is still approved even if agent dispatch fails
        logger.error('Failed to trigger Dev Agent after PRD approval', {
          prdId: id,
          error: (err as Error).message,
          stack: (err as Error).stack,
        });
      }

      // Audit log: PRD approved
      fastify.services.auditService.log({
        tenantId,
        userId: (request as any).userId,
        action: 'prd.approve',
        resource: 'prd',
        resourceId: id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send({
        success: true,
        data: prd,
        message: 'PRD approved. Dev Agent has been automatically dispatched.',
      });
    }
  );

  /**
   * Get AI Council details for a PRD.
   *
   * GET /prds/:id/council
   *
   * Returns model votes, critique summary, and cost breakdown
   * from the AI Council session that generated this PRD.
   */
  fastify.get(
    '/prds/:id/council',
    {
      schema: { tags: ['PRDs'] } as any,
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;

      // Find the task that generated this PRD
      const task = await fastify.services.prisma.agentTask.findFirst({
        where: {
          tenantId,
          agentType: 'ba_agent',
          output: { path: ['prdId'], equals: id },
        },
        select: { id: true, output: true, confidence: true, completedAt: true, createdAt: true },
      });

      if (!task) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Council data not found for this PRD' },
        });
      }

      const output = task.output as Record<string, unknown> | null;
      const council = (output?.council as Record<string, unknown>) || null;

      return reply.send({
        success: true,
        data: {
          taskId: task.id,
          confidence: task.confidence,
          councilDecision: output?.councilDecision || null,
          iterations: output?.iterations || 0,
          council: council ? {
            votes: council.votes || [],
            critique: council.critique || null,
            consensusReached: council.consensusReached ?? false,
            outstandingIssues: council.outstandingIssues || [],
            clarificationQuestions: council.clarificationQuestions || [],
            estimatedCost: council.estimatedCost || null,
            timing: council.timing || null,
          } : null,
          completedAt: task.completedAt,
          startedAt: task.createdAt,
        },
      });
    }
  );

  /**
   * Download a PRD as a formatted Markdown document.
   *
   * GET /prds/:id/download
   */
  fastify.get(
    '/prds/:id/download',
    {
      schema: { tags: ['PRDs'] } as any,
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;

      const prdRepository = fastify.services.prdRepository;
      const prd = await prdRepository.findByIdWithTickets(id);

      if (!prd || prd.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'PRD not found' },
        });
      }

      // Cast JSON fields to known types
      const requirements = (prd.requirements as Array<{
        id: string; title: string; description: string; priority: string;
        type: string; acceptanceCriteria: string[];
      }>) || [];
      const risks = (prd.risks as Array<{ description: string; impact: string; mitigation?: string }>) || [];
      const objectives = (prd.objectives as string[]) || [];
      const acceptanceCriteria = (prd.acceptanceCriteria as string[]) || [];
      const outOfScope = (prd.outOfScope as string[]) || [];
      const assumptions = (prd.assumptions as string[]) || [];

      const confidencePct = Math.round(prd.confidence * 100);
      const createdAt = new Date(prd.createdAt).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });

      // Build requirements section — split by type
      const userStories = requirements.filter(r => r.type === 'functional');
      const funcReqs = requirements.filter(r => r.type !== 'functional');

      const userStoriesSection = userStories.length > 0
        ? userStories.map((req, i) => {
            const idx = String(i + 1).padStart(3, '0');
            const criteria = req.acceptanceCriteria.length > 0
              ? `\n**Acceptance Criteria:**\n${req.acceptanceCriteria.map(c => `- ${c}`).join('\n')}`
              : '';
            return `### US-${idx}: ${req.title}\n**Priority:** ${req.priority}\n**Description:** ${req.description}${criteria}`;
          }).join('\n\n')
        : '_No user stories defined._';

      const funcReqsTable = funcReqs.length > 0
        ? `| ID | Title | Priority | Description |\n|---|---|---|---|\n${funcReqs.map(r =>
            `| ${r.id} | ${r.title} | ${r.priority} | ${r.description} |`
          ).join('\n')}`
        : '_No additional functional requirements defined._';

      const acSection = acceptanceCriteria.length > 0
        ? acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
        : '_No acceptance criteria specified._';

      const outOfScopeSection = outOfScope.length > 0
        ? outOfScope.map(item => `- ${item}`).join('\n')
        : '_Not specified._';

      const assumptionsSection = assumptions.length > 0
        ? assumptions.map(item => `- ${item}`).join('\n')
        : '_No assumptions documented._';

      const risksTable = risks.length > 0
        ? `| Risk | Impact | Mitigation |\n|---|---|---|\n${risks.map(r =>
            `| ${r.description} | ${r.impact} | ${r.mitigation || '—'} |`
          ).join('\n')}`
        : '_No risks identified._';

      const objectivesSection = objectives.length > 0
        ? objectives.map(obj => `- ${obj}`).join('\n')
        : '_No objectives specified._';

      const markdown = `# ${prd.title}

**Status:** ${prd.status}
**Confidence:** ${confidencePct}%
**Created:** ${createdAt}${prd.timeline ? `\n**Timeline:** ${prd.timeline}` : ''}

---

## Summary

${prd.summary}

## Objectives

${objectivesSection}

## User Stories

${userStoriesSection}

## Functional Requirements

${funcReqsTable}

## Acceptance Criteria

${acSection}

## Out of Scope

${outOfScopeSection}

## Assumptions

${assumptionsSection}

## Risks

${risksTable}

---

*Generated by Workforce0 AI from meeting transcript.*
*Confidence: ${confidencePct}%*
`;

      const safeTitle = prd.title.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
      const filename = `PRD - ${safeTitle}.md`;

      return reply
        .header('Content-Type', 'text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(markdown);
    }
  );

  /**
   * Reject a PRD.
   *
   * POST /prds/:id/reject
   */
  fastify.post(
    '/prds/:id/reject',
    {
      preHandler: [requireAdmin],
      schema: {
        description: 'Reject a PRD',
        tags: ['PRDs'],
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params as { id: string };
      const { reason } = (request.body as { reason?: string }) || {};

      logger.info('Rejecting PRD', { prdId: id, reason });

      const prdRepository = fastify.services.prdRepository;

      // Verify PRD exists and belongs to tenant
      const existing = await prdRepository.findById(id);
      if (!existing || existing.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'PRD not found' },
        });
      }

      // Status guard: only allow rejection from draft or pending_approval
      if (existing.status !== 'draft' && existing.status !== 'pending_approval') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATUS', message: `Cannot reject PRD with status '${existing.status}'. Must be 'draft' or 'pending_approval'.` },
        });
      }

      const prd = await prdRepository.updateStatus(id, 'rejected');

      // Audit log: PRD rejected
      fastify.services.auditService.log({
        tenantId,
        userId: (request as any).userId,
        action: 'prd.reject',
        resource: 'prd',
        resourceId: id,
        after: { reason },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send({
        success: true,
        data: prd,
        message: 'PRD rejected.',
      });
    }
  );

  /**
   * Fan out an approval-request notification for a PRD to all approvers
   * on their preferred channel (Slack, email, WhatsApp, Teams, SMS).
   *
   * Idempotent — reuses the same action token if already generated so
   * retries don't invalidate previously-sent links.
   *
   * POST /prds/:id/notify-approvers
   */
  fastify.post(
    '/prds/:id/notify-approvers',
    {
      preHandler: [requireAdmin],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params as { id: string };

      const existing = await fastify.services.prdRepository.findById(id);
      if (!existing || existing.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'PRD not found' },
        });
      }

      const result = await fastify.services.approvalFanoutService.notify(id);

      fastify.services.auditService.log({
        tenantId,
        userId: (request as any).userId,
        action: 'prd.notify_approvers',
        resource: 'prd',
        resourceId: id,
        after: { notified: result.notified, skipped: result.skipped },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send({ success: true, data: result });
    },
  );

  /**
   * Create Jira tickets from PRD.
   *
   * POST /prds/:id/tickets
   */
  fastify.post(
    '/prds/:id/tickets',
    {
      preHandler: [requireAdmin],
      schema: {
        description: 'Create Jira tickets from PRD requirements',
        tags: ['PRDs'],
        body: {
          type: 'object',
          required: ['projectKey'],
          properties: {
            projectKey: { type: 'string' },
            epicKey: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params as { id: string };
      const body = CreateTicketsSchema.parse(request.body);

      logger.info('Creating Jira tickets from PRD', { prdId: id, projectKey: body.projectKey });

      const prdRepository = fastify.services.prdRepository;
      const baAgentService = fastify.services.baAgentService;

      // Get PRD and verify tenant ownership
      const prd = await prdRepository.findByIdWithTickets(id);
      if (!prd || prd.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'PRD not found' },
        });
      }

      // Check if approved
      if (prd.status !== 'approved') {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'PRD must be approved before creating tickets' },
        });
      }

      // Create tickets
      const result = await baAgentService.createJiraTickets(id, body.projectKey, { epicKey: body.epicKey });

      // Audit log: Jira tickets created from PRD
      fastify.services.auditService.log({
        tenantId,
        userId: (request as any).userId,
        action: 'prd.tickets.create',
        resource: 'prd',
        resourceId: id,
        after: { projectKey: body.projectKey, created: result.created.length, failed: result.failed.length },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send({
        success: true,
        data: {
          created: result.created,
          failed: result.failed,
        },
        message: `Created ${result.created.length} tickets, ${result.failed.length} failed`,
      });
    }
  );

  // =========================================================================
  // CLARIFICATION ENDPOINTS
  // =========================================================================

  /**
   * List pending clarifications.
   *
   * GET /clarifications
   */
  fastify.get(
    '/clarifications',
    {
      schema: {
        tags: ['Clarifications'],
      } as any,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;

      const taskRepository = fastify.services.taskRepository;
      const tasks = await taskRepository.findTasks({
        tenantId,
        status: 'awaiting_clarification',
      });

      return reply.send({
        success: true,
        data: tasks,
      });
    }
  );

  /**
   * Respond to a clarification request.
   *
   * POST /clarifications/:id/respond
   */
  fastify.post(
    '/clarifications/:id/respond',
    {
      schema: {
        description: 'Respond to a clarification request',
        tags: ['Clarifications'],
        body: {
          type: 'object',
          required: ['answer'],
          properties: {
            answer: { type: 'string' },
            selectedOptionIndex: { type: 'integer' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { answer: string; selectedOptionIndex?: number } }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;
      const body = ClarificationResponseSchema.parse(request.body);

      logger.info('Responding to clarification', { clarificationId: id, tenantId });

      const baAgentService = fastify.services.baAgentService;

      // Verify tenant ownership via the parent task OR the parent ticket
      // (N6b made taskId nullable; newer chief_of_staff clarifications
      // only carry ticketId). Whichever is present must belong to this
      // tenant or we 404.
      const clarification = await fastify.services.prisma.clarificationRequest.findUnique({
        where: { id },
        include: {
          task: { select: { tenantId: true } },
          ticket: { select: { tenantId: true } },
        },
      });
      const owningTenantId = clarification?.task?.tenantId ?? clarification?.ticket?.tenantId ?? null;
      if (!clarification || owningTenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Clarification not found' },
        });
      }

      try {
        const userId = (request as any).userId as string | undefined;
        const result = await baAgentService.handleClarificationResponse(id, body.answer, userId);

        return reply.send({
          success: true,
          data: result,
          message: 'Clarification response processed',
        });
      } catch (err) {
        logger.error('Clarification response failed', { clarificationId: id, error: (err as Error).message });
        return reply.status(500).send({
          success: false,
          error: { code: 'PROCESSING_ERROR', message: 'Failed to process clarification response' },
        });
      }
    }
  );
}

/** Cap for the "most recently active thread" fallback. Beyond this the
 *  thread probably isn't the right place for a fresh approval note. */
const RECENT_THREAD_STALENESS_MS = 48 * 60 * 60 * 1000;

export type ApprovalHandoffReason = 'no_thread' | 'stale' | 'blocked' | 'error';

export interface ApprovalHandoffResult {
  posted: boolean;
  threadId?: string;
  /** Why we didn't post (when posted=false). */
  reason?: ApprovalHandoffReason;
  /** Whether we backfilled engagementId on a previously un-scoped thread. */
  boundEngagementId?: boolean;
}

export interface ApprovalHandoffDeps {
  orchestrator: FastifyInstance['services']['conversationOrchestratorService'] | null;
  prisma: FastifyInstance['services']['prisma'];
}

/**
 * Drops a BA "PRD approved — @dev take it" note into a conversation thread
 * the moment a PRD is approved. We deliberately do NOT spawn new channels:
 * the handoff only fires when a human has already engaged with the bot
 * somewhere recent, so the notification lands in a place the approver is
 * watching.
 *
 * Thread discovery, in priority order:
 *   1. Explicit match — `purpose='engagement:<engagementId>'`,
 *      `purpose='prd:<prdId>'`, or `engagementId=<engagementId>`.
 *   2. Recent-activity fallback — the tenant's most recently active thread,
 *      if it had activity within the last 48h. On a hit, we stamp
 *      `engagementId` on the thread so the next approval finds it via the
 *      precise match instead of the fuzzy fallback.
 *
 * When nothing qualifies, returns `{ posted: false, reason: 'no_thread' }`
 * and does nothing — the caller logs and moves on. Guardrails, retries,
 * and formatting are all the orchestrator's problem.
 */
export async function postApprovalHandoff(
  deps: ApprovalHandoffDeps,
  input: { tenantId: string; prdId: string; engagementId: string | null },
): Promise<ApprovalHandoffResult> {
  const { orchestrator, prisma } = deps;
  if (!orchestrator) return { posted: false, reason: 'no_thread' };

  const exactOr: Record<string, unknown>[] = [];
  if (input.engagementId) {
    exactOr.push({ purpose: `engagement:${input.engagementId}` });
    exactOr.push({ engagementId: input.engagementId });
  }
  exactOr.push({ purpose: `prd:${input.prdId}` });

  let thread = await (prisma as any).conversationThread.findFirst({
    where: { tenantId: input.tenantId, OR: exactOr },
    orderBy: { lastActivityAt: 'desc' },
    select: { id: true, channel: true, engagementId: true },
  });
  let usedFallback = false;

  if (!thread) {
    const cutoff = new Date(Date.now() - RECENT_THREAD_STALENESS_MS);
    thread = await (prisma as any).conversationThread.findFirst({
      where: { tenantId: input.tenantId, lastActivityAt: { gt: cutoff } },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true, channel: true, engagementId: true },
    });
    usedFallback = !!thread;
    if (!thread) {
      logger.debug('No conversation thread found for PRD approval — skipping handoff', {
        prdId: input.prdId,
        engagementId: input.engagementId,
      });
      return { posted: false, reason: 'no_thread' };
    }
  }

  let boundEngagementId = false;
  try {
    const result = await orchestrator.initiate({
      tenantId: input.tenantId,
      threadId: thread.id,
      channel: thread.channel as 'slack' | 'whatsapp' | 'sms' | 'telegram' | 'teams',
      agent: 'ba',
      text: `PRD approved and handed off to @dev. Kicking off implementation now.`,
    });
    if (result.blocked) {
      logger.info('BA approval handoff blocked by orchestrator guardrail', {
        prdId: input.prdId,
        threadId: thread.id,
        reason: result.blocked,
      });
      return { posted: false, threadId: thread.id, reason: 'blocked' };
    }

    // Backfill: if we found this thread via the recent-activity fallback,
    // stamp engagementId on it so the next approval for this engagement
    // skips the fallback and lands via the exact-match path.
    if (usedFallback && input.engagementId && !thread.engagementId) {
      try {
        await (prisma as any).conversationThread.update({
          where: { id: thread.id },
          data: { engagementId: input.engagementId },
        });
        boundEngagementId = true;
      } catch (err) {
        logger.warn('Failed to bind engagementId on fallback thread — non-fatal', {
          prdId: input.prdId,
          threadId: thread.id,
          error: (err as Error).message,
        });
      }
    }

    logger.info('BA approval handoff posted to thread', {
      prdId: input.prdId,
      threadId: thread.id,
      turnId: result.turnId,
      handoffs: result.handoffs,
      usedFallback,
      boundEngagementId,
    });
    return { posted: true, threadId: thread.id, boundEngagementId };
  } catch (err) {
    logger.warn('BA approval handoff failed — non-fatal', {
      prdId: input.prdId,
      error: (err as Error).message,
    });
    return { posted: false, threadId: thread.id, reason: 'error' };
  }
}
