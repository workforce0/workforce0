/**
 * =============================================================================
 * UPLOAD ROUTES
 * =============================================================================
 *
 * Endpoints for manual meeting recording upload via presigned URLs.
 * Works with either storage driver (local or S3) — the concrete URL the
 * browser PUTs to is produced by `storageService.generatePresignedUploadUrl`.
 *
 * Endpoints:
 * ----------
 * POST /meetings/upload/presign          → Get presigned upload URL
 * POST /meetings/:id/upload/complete     → Confirm upload, start transcription
 *
 * @module routes/upload
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';
import { JobType } from '../services/queue/processors.js';

const logger = createChildLogger({ route: 'upload' });

const PresignSchema = z.object({
  fileName: z.string().min(1),
  fileSize: z.number().positive().max(200 * 1024 * 1024),
  contentType: z.enum([
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm',
    'audio/mp4', 'audio/x-m4a', 'video/mp4', 'video/webm',
  ]),
  title: z.string().optional(),
  meetingDate: z.string().datetime().optional(),
});

const UploadCompleteSchema = z.object({
  title: z.string().optional(),
  participants: z.array(z.string()).optional(),
});

export async function uploadRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /meetings/upload/presign
   *
   * Creates a Meeting record and returns a presigned upload URL the
   * browser can PUT the file to. Works with both drivers (local + S3).
   */
  fastify.post(
    '/meetings/upload/presign',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).tenantId as string;
      const userId = (request as any).userId as string;

      const storageService = fastify.services.storageService;
      if (!storageService.isEnabled()) {
        return reply.status(503).send({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'File upload is not configured.',
          },
        });
      }

      const body = PresignSchema.parse(request.body);

      // Create Meeting record in 'uploading' state
      const meeting = await fastify.services.prisma.meeting.create({
        data: {
          tenantId,
          title: body.title || body.fileName.replace(/\.[^.]+$/, ''),
          status: 'uploading',
          source: 'upload',
          meetingUrl: '',
          startTime: body.meetingDate ? new Date(body.meetingDate) : new Date(),
          participants: [],
          uploadedBy: userId,
        },
      });

      // Generate presigned upload URL
      const { uploadUrl, storageKey } = await storageService.generatePresignedUploadUrl(
        meeting.id,
        body.contentType,
        body.fileSize
      );

      // Store storage key on meeting for later retrieval
      await fastify.services.prisma.meeting.update({
        where: { id: meeting.id },
        data: { audioUrl: storageKey },
      });

      logger.info('Presigned upload URL generated', { meetingId: meeting.id, storageKey });

      return reply.status(201).send({
        success: true,
        data: {
          meetingId: meeting.id,
          uploadUrl,
          storageKey,
          expiresIn: 300,
        },
      });
    }
  );

  /**
   * POST /meetings/upload/transcript
   *
   * Direct transcript text upload — no audio file needed.
   * Creates Meeting + Transcript records, then queues BA processing.
   */
  fastify.post(
    '/meetings/upload/transcript',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).tenantId as string;
      const userId = (request as any).userId as string;

      const schema = z.object({
        title: z.string().min(1, 'Title is required'),
        transcript: z.string().min(10, 'Transcript must be at least 10 characters'),
        participants: z.array(z.string()).optional(),
        meetingDate: z.string().datetime().optional(),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message || 'Invalid input' },
        });
      }

      const { title, transcript, participants, meetingDate } = parsed.data;

      // Create Meeting record
      const meeting = await fastify.services.prisma.meeting.create({
        data: {
          tenantId,
          title,
          status: 'completed',
          source: 'upload',
          meetingUrl: '',
          startTime: meetingDate ? new Date(meetingDate) : new Date(),
          participants: participants || [],
          uploadedBy: userId,
        },
      });

      // Create Transcript record directly (no transcription needed)
      const wordCount = transcript.split(/\s+/).filter(Boolean).length;
      await fastify.services.prisma.transcript.create({
        data: {
          meetingId: meeting.id,
          fullText: transcript,
          segments: [],
          duration: 0,
          wordCount,
          speakers: participants || [],
        },
      });

      // Queue BA Agent processing
      if (fastify.services.queueService) {
        await fastify.services.queueService.addJob(JobType.MEETING_PROCESS, {
          meetingId: meeting.id,
          tenantId,
        });
      }

      logger.info('Transcript uploaded directly', { meetingId: meeting.id, wordCount });

      return reply.status(201).send({
        success: true,
        data: { meetingId: meeting.id, status: 'completed', wordCount },
      });
    }
  );

  /**
   * POST /meetings/:id/upload/complete
   *
   * Called after the browser finishes uploading. Verifies the file
   * landed on the configured storage driver, then queues transcription.
   */
  fastify.post(
    '/meetings/:id/upload/complete',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as any).tenantId as string;
      const { id } = request.params;

      const meeting = await fastify.services.prisma.meeting.findFirst({
        where: { id, tenantId },
      });

      if (!meeting) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Meeting not found.' },
        });
      }

      if (!meeting.audioUrl) {
        return reply.status(400).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'No upload URL found for this meeting.' },
        });
      }

      // Optionally update title and participants
      const body = UploadCompleteSchema.safeParse(request.body);
      if (body.success && (body.data.title || body.data.participants)) {
        await fastify.services.prisma.meeting.update({
          where: { id },
          data: {
            ...(body.data.title ? { title: body.data.title } : {}),
            ...(body.data.participants ? { participants: body.data.participants } : {}),
          },
        });
      }

      // Verify file actually made it to storage
      const storageService = fastify.services.storageService;
      if (storageService.isEnabled()) {
        const exists = await storageService.objectExists(meeting.audioUrl);
        if (!exists) {
          return reply.status(400).send({
            success: false,
            error: { code: 'UPLOAD_NOT_FOUND', message: 'Audio file not found. Upload may have failed.' },
          });
        }
      }

      // Transition to transcribing and queue the job
      await fastify.services.prisma.meeting.update({
        where: { id },
        data: { status: 'transcribing' },
      });

      if (fastify.services.queueService) {
        await fastify.services.queueService.addJob(JobType.MEETING_TRANSCRIBE, {
          meetingId: id,
          tenantId,
          storageKey: meeting.audioUrl,
          source: 'upload',
        });
      }

      logger.info('Upload confirmed, transcription queued', { meetingId: id });

      return reply.send({
        success: true,
        data: { meetingId: id, status: 'transcribing' },
      });
    }
  );
}
