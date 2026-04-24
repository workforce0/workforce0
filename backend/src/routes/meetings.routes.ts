/**
 * =============================================================================
 * MEETINGS API ROUTES
 * =============================================================================
 *
 * REST API endpoints for meeting management.
 *
 * Endpoints:
 * ----------
 * POST   /meetings          → Schedule a meeting bot
 * GET    /meetings          → List meetings for tenant
 * GET    /meetings/:id      → Get meeting details
 * DELETE /meetings/:id      → Cancel scheduled meeting
 * GET    /meetings/:id/transcript → Get meeting transcript
 *
 * Authentication:
 * ---------------
 * All endpoints require API key authentication.
 * Tenant ID is extracted from the API key.
 *
 * Rate Limits:
 * ------------
 * - POST /meetings: 10 req/min (bot deployment is expensive)
 * - GET endpoints: 100 req/min
 *
 * Response Format:
 * ----------------
 * All responses follow the standard format:
 * ```json
 * {
 *   "success": true,
 *   "data": { ... },
 *   "meta": { "timestamp": "...", "requestId": "..." }
 * }
 * ```
 *
 * @module routes/meetings
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'meetings' });


/**
 * Request body schema for scheduling a meeting.
 */
const ScheduleMeetingSchema = z.object({
  meetingUrl: z.string().url().describe('Meeting URL (Google Meet, Zoom, or Teams)'),
  title: z.string().optional().describe('Optional meeting title'),
  scheduledStart: z.string().datetime().optional().describe('Optional scheduled start time'),
  botName: z.string().optional().describe('Optional custom bot name'),
});

/**
 * Query params schema for listing meetings.
 */
const ListMeetingsQuerySchema = z.object({
  status: z.enum(['scheduled', 'joining', 'in_progress', 'transcribing', 'processing', 'completed', 'cancelled', 'failed']).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

/**
 * Register meeting routes.
 *
 * @param fastify - Fastify instance
 */
export async function meetingRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Schedule a meeting bot.
   *
   * POST /meetings
   *
   * @example
   * ```bash
   * curl -X POST /api/meetings \
   *   -H "Authorization: Bearer <api_key>" \
   *   -H "Content-Type: application/json" \
   *   -d '{"meetingUrl": "https://meet.google.com/abc-defg-hij"}'
   * ```
   */
  fastify.post(
    '/',
    {
      schema: {
        description: 'Schedule a meeting bot to join and transcribe a meeting',
        tags: ['Meetings'],
        body: {
          type: 'object',
          required: ['meetingUrl'],
          properties: {
            meetingUrl: { type: 'string', format: 'uri' },
            title: { type: 'string' },
            scheduledStart: { type: 'string', format: 'date-time' },
            botName: { type: 'string' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  meetingId: { type: 'string' },
                  botId: { type: 'string' },
                  status: { type: 'string' },
                  estimatedJoinTime: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      // Bot scheduling via Recall.ai has been removed.
      // Use upload, Google Meet native, or Twilio voice dial-in instead.
      return reply.status(410).send({
        success: false,
        error: {
          code: 'FEATURE_REMOVED',
          message: 'Bot scheduling has been removed. Use Upload Recording, Google Meet integration, or Voice Dial-In instead.',
        },
      });
    }
  );

  /**
   * List meetings for tenant.
   *
   * GET /meetings
   *
   * @example
   * ```bash
   * curl /api/meetings?status=completed&limit=10 \
   *   -H "Authorization: Bearer <api_key>"
   * ```
   */
  fastify.get(
    '/',
    {
      schema: {
        description: 'List meetings for the authenticated tenant',
        tags: ['Meetings'],
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['scheduled', 'joining', 'in_progress', 'transcribing', 'processing', 'completed', 'cancelled', 'failed'] },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array' },
              meta: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  limit: { type: 'integer' },
                  offset: { type: 'integer' },
                  integrationRequired: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const projectId = (request as FastifyRequest & { projectId: string | null }).projectId;
      const query = ListMeetingsQuerySchema.parse(request.query);

      logger.debug('Listing meetings', { tenantId, projectId, ...query });

      const meetingService = fastify.services.meetingService;

      const meetings = await meetingService.getMeetingsForTenant(tenantId, {
        projectId,
        status: query.status,
        take: query.limit,
        skip: query.offset,
      });

      return reply.send({
        success: true,
        data: meetings,
        meta: {
          limit: query.limit,
          offset: query.offset,
        },
      });
    }
  );

  /**
   * Get meeting details.
   *
   * GET /meetings/:id
   */
  fastify.get(
    '/:id',
    {
      schema: {
        description: 'Get meeting details by ID',
        tags: ['Meetings'],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;

      logger.debug('Getting meeting', { meetingId: id });

      const meetingService = fastify.services.meetingService;
      const meeting = await meetingService.getMeeting(id);

      if (!meeting || meeting.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Meeting not found' },
        });
      }

      return reply.send({
        success: true,
        data: meeting,
      });
    }
  );

  /**
   * Cancel a scheduled meeting.
   *
   * DELETE /meetings/:id
   */
  fastify.delete(
    '/:id',
    {
      schema: {
        description: 'Cancel a scheduled meeting bot',
        tags: ['Meetings'],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;

      logger.info('Cancelling meeting', { meetingId: id });

      // Verify meeting belongs to tenant before cancelling
      const meetingRepository = fastify.services.meetingRepository;
      const meeting = await meetingRepository.findById(id);
      if (!meeting || meeting.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Meeting not found' },
        });
      }

      // Update meeting status to cancelled
      await fastify.services.prisma.meeting.update({
        where: { id },
        data: { status: 'cancelled' },
      });

      return reply.send({
        success: true,
        message: 'Meeting cancelled successfully',
      });
    }
  );

  /**
   * Get meeting transcript.
   *
   * GET /meetings/:id/transcript
   */
  fastify.get(
    '/:id/transcript',
    {
      schema: {
        description: 'Get transcript for a completed meeting',
        tags: ['Meetings'],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;

      logger.debug('Getting transcript', { meetingId: id });

      const meetingRepository = fastify.services.meetingRepository;
      const meeting = await meetingRepository.findByIdWithTranscript(id);

      if (!meeting || meeting.tenantId !== tenantId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Meeting not found' },
        });
      }

      if (!meeting.transcript) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Transcript not found' },
        });
      }

      return reply.send({
        success: true,
        data: meeting.transcript,
      });
    }
  );

  /**
   * Get meeting insights (AI-generated summary, decisions, action items).
   *
   * GET /meetings/:id/insights
   */
  fastify.get(
    '/:id/insights',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;

      const prisma = fastify.services.prisma;
      const meeting = await prisma.meeting.findFirst({
        where: { id, tenantId },
      });

      if (!meeting) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Meeting not found' },
        });
      }

      const insights = await prisma.meetingInsights.findUnique({
        where: { meetingId: id },
      });

      if (!insights) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Insights not yet generated for this meeting' },
        });
      }

      return reply.send({
        success: true,
        data: insights,
      });
    }
  );

  // ─── Voice Dial-In ──────────────────────────────────────────────────────

  const VoiceJoinSchema = z.object({
    dialInNumber: z.string().min(1),
    accessCode: z.string().optional(),
    mode: z.enum(['silent', 'active']).default('silent'),
  });

  /**
   * Dial AI into a call via Twilio.
   *
   * POST /meetings/:id/voice-join
   */
  fastify.post(
    '/:id/voice-join',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;

      if (!fastify.services.twilioVoiceService) {
        return reply.status(503).send({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Voice dial-in is not configured. Twilio credentials required.',
          },
        });
      }

      const body = VoiceJoinSchema.parse(request.body);

      const meeting = await fastify.services.prisma.meeting.findFirst({
        where: { id, tenantId },
      });

      if (!meeting) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Meeting not found' },
        });
      }

      // Update meeting for voice dial-in
      await fastify.services.prisma.meeting.update({
        where: { id },
        data: {
          source: 'voice_dialin',
          status: 'joining',
          metadata: {
            ...(meeting.metadata as Record<string, unknown> || {}),
            voiceMode: body.mode,
            dialInNumber: body.dialInNumber,
          },
        },
      });

      try {
        const callSid = await fastify.services.twilioVoiceService.dialIntoMeeting(
          id,
          body.dialInNumber,
          body.accessCode,
        );

        logger.info('Voice dial-in initiated', { meetingId: id, callSid });

        return reply.status(201).send({
          success: true,
          data: {
            meetingId: id,
            callSid,
            status: 'joining',
            mode: body.mode,
          },
        });
      } catch (err) {
        await fastify.services.prisma.meeting.update({
          where: { id },
          data: { status: 'failed' },
        });
        throw err;
      }
    }
  );

  /**
   * Remove AI from a call.
   *
   * POST /meetings/:id/voice-leave
   */
  fastify.post(
    '/:id/voice-leave',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
      const { id } = request.params;

      const meeting = await fastify.services.prisma.meeting.findFirst({
        where: { id, tenantId },
      });

      if (!meeting) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Meeting not found' },
        });
      }

      if (fastify.services.twilioVoiceService) {
        const callSid = (meeting.metadata as Record<string, unknown>)?.callSid as string;
        if (callSid) {
          await fastify.services.twilioVoiceService.hangup(callSid);
        }
      }

      await fastify.services.prisma.meeting.update({
        where: { id },
        data: { status: 'completed', endTime: new Date() },
      });

      logger.info('Voice dial-in ended', { meetingId: id });

      return reply.send({
        success: true,
        data: { meetingId: id, status: 'completed' },
      });
    }
  );
}
