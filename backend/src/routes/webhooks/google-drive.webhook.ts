/**
 * =============================================================================
 * GOOGLE DRIVE WEBHOOK HANDLER
 * =============================================================================
 *
 * Handles Google Drive push notifications (changes.watch) for detecting new
 * Google Meet recordings. When a user's Drive changes, Google sends a POST
 * notification here. We look up the user's OAuth tokens, query for new Meet
 * recordings, push them into the configured storage driver, and queue
 * transcription.
 *
 * Endpoints:
 * ----------
 * POST /google-drive            → Handle Drive push notifications from Google
 * POST /google-drive/subscribe  → Set up a Drive changes.watch channel for a user
 *
 * Google Drive Push Notification Flow:
 * ------------------------------------
 * 1. User connects Google account (OAuth) and subscribes to Drive changes
 * 2. Google sends POST to /webhooks/google-drive with channel headers
 * 3. We look up the OAuth token by driveChannelId
 * 4. Call Drive changes.list to find new Meet recording files
 * 5. Download each recording, push to storage, create Meeting, queue transcription
 *
 * @module routes/webhooks/google-drive-webhook
 */

import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { createChildLogger } from '../../lib/logger.js';
import { config } from '../../config/index.js';
import { JobType } from '../../services/queue/processors.js';

const logger = createChildLogger({ module: 'google-drive-webhook' });

/**
 * MIME types that indicate a Google Meet recording.
 */
const MEET_RECORDING_MIME_TYPES = new Set([
  'video/mp4',
]);

/**
 * Folder name where Google Meet stores recordings.
 */
const MEET_RECORDINGS_FOLDER = 'Meet Recordings';

/**
 * Convert a readable stream to a Buffer.
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Register Google Drive webhook routes.
 *
 * @param fastify - Fastify instance (scoped under /webhooks prefix)
 */
export async function registerGoogleDriveWebhook(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /webhooks/google-drive
   *
   * Receives push notifications from Google Drive's changes.watch API.
   *
   * Google sends these headers:
   * - X-Goog-Channel-ID: The channel ID we registered
   * - X-Goog-Resource-ID: The resource being watched
   * - X-Goog-Resource-State: 'sync' (initial) or 'change' (actual change)
   *
   * We must return 200 quickly; actual processing is async via queue.
   */
  fastify.post('/google-drive', {
    schema: {
      description: 'Google Drive push notification webhook',
      tags: ['webhooks'],
      response: {
        200: {
          type: 'object',
          properties: {
            received: { type: 'boolean' },
          },
        },
      },
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const channelId = request.headers['x-goog-channel-id'] as string | undefined;
      const resourceId = request.headers['x-goog-resource-id'] as string | undefined;
      const resourceState = request.headers['x-goog-resource-state'] as string | undefined;

      logger.info('Received Google Drive push notification', {
        channelId,
        resourceId,
        resourceState,
      });

      // Sync notifications are sent when the channel is first created — acknowledge only
      if (resourceState === 'sync') {
        logger.debug('Sync notification received, acknowledging');
        return reply.status(200).send({ received: true });
      }

      // Only process 'change' notifications
      if (resourceState !== 'change') {
        logger.debug('Ignoring non-change notification', { resourceState });
        return reply.status(200).send({ received: true });
      }

      if (!channelId) {
        logger.warn('Missing X-Goog-Channel-ID header');
        return reply.status(200).send({ received: true });
      }

      // Process async — respond 200 immediately, then handle in background
      // Use setImmediate to release the request handler while still processing
      setImmediate(() => {
        processGoogleDriveChange(fastify, channelId, resourceId).catch((error) => {
          logger.error('Failed to process Google Drive change notification', {
            channelId,
            resourceId,
            error: (error as Error).message,
          });
        });
      });

      return reply.status(200).send({ received: true });
    },
  });

  /**
   * POST /webhooks/google-drive/subscribe
   *
   * Set up a Google Drive changes.watch channel for a user.
   * This is typically called from the authenticated API layer, but registered
   * here under the webhook prefix for organizational clarity.
   *
   * Requires: tenantId and userId in request body.
   */
  fastify.post('/google-drive/subscribe', {
    schema: {
      description: 'Subscribe to Google Drive changes for a user',
      tags: ['webhooks'],
      body: {
        type: 'object',
        required: ['tenantId', 'userId'],
        properties: {
          tenantId: { type: 'string' },
          userId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                channelId: { type: 'string' },
                resourceId: { type: 'string' },
                expiration: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: async (
      request: FastifyRequest<{ Body: { tenantId: string; userId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, userId } = request.body;

      const googleOAuth = fastify.services.googleOAuthService;
      if (!googleOAuth) {
        return reply.status(503).send({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Google integration not configured.' },
        });
      }

      // Get user's OAuth tokens
      const tokens = await googleOAuth.getTokens(tenantId, userId);
      if (!tokens) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NOT_CONNECTED', message: 'User has not connected their Google account.' },
        });
      }

      try {
        // Create an OAuth2 client with the user's tokens
        const oauth2Client = new google.auth.OAuth2(
          config.GOOGLE_CLIENT_ID,
          config.GOOGLE_CLIENT_SECRET,
          config.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });

        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        // Get the current start page token (for changes.list starting point)
        const startTokenRes = await drive.changes.getStartPageToken();
        const startPageToken = startTokenRes.data.startPageToken;

        if (!startPageToken) {
          throw new Error('Failed to obtain Drive start page token');
        }

        // Build the webhook URL
        const webhookBaseUrl = config.WEBHOOK_BASE_URL || config.PUBLIC_URL;
        if (!webhookBaseUrl) {
          return reply.status(503).send({
            success: false,
            error: {
              code: 'CONFIG_MISSING',
              message: 'WEBHOOK_BASE_URL or PUBLIC_URL must be configured for Drive webhooks.',
            },
          });
        }

        const channelId = randomUUID();
        const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days from now

        // Register the changes.watch channel with Google
        const watchRes = await drive.changes.watch({
          pageToken: startPageToken,
          requestBody: {
            id: channelId,
            type: 'web_hook',
            address: `${webhookBaseUrl}/webhooks/google-drive`,
            expiration: String(expiration),
          },
        });

        // Store the channel ID and expiry on the OAuth token record
        await fastify.services.prisma.googleOAuthToken.update({
          where: { tenantId_userId: { tenantId, userId } },
          data: {
            driveChannelId: channelId,
            channelExpiry: new Date(expiration),
          },
        });

        // Also store the startPageToken in Redis for changes.list calls
        await fastify.services.redis.set(
          `drive_page_token:${channelId}`,
          startPageToken,
          'EX',
          8 * 24 * 60 * 60 // 8 days (slightly longer than channel lifetime)
        );

        logger.info('Google Drive watch channel created', {
          tenantId,
          userId,
          channelId,
          resourceId: watchRes.data.resourceId,
          expiration: new Date(expiration).toISOString(),
        });

        return reply.status(200).send({
          success: true,
          data: {
            channelId,
            resourceId: watchRes.data.resourceId || '',
            expiration: new Date(expiration).toISOString(),
          },
        });
      } catch (error) {
        logger.error('Failed to create Drive watch channel', {
          tenantId,
          userId,
          error: (error as Error).message,
        });

        return reply.status(500).send({
          success: false,
          error: { code: 'WATCH_FAILED', message: 'Failed to subscribe to Drive changes.' },
        });
      }
    },
  });

  /**
   * GET /webhooks/google-drive/health
   *
   * Health check for the Google Drive webhook endpoint.
   */
  fastify.get('/google-drive/health', {
    schema: {
      description: 'Google Drive webhook health check',
      tags: ['webhooks'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      return reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    },
  });

  logger.info('Google Drive webhook routes registered');
}

/**
 * Process a Google Drive change notification asynchronously.
 *
 * Steps:
 * 1. Look up the OAuth token by driveChannelId
 * 2. Retrieve the page token from Redis
 * 3. Call Drive changes.list to find new/modified files
 * 4. Filter for Google Meet recordings
 * 5. For each recording: download -> upload to S3 -> create Meeting -> queue transcription
 */
async function processGoogleDriveChange(
  fastify: FastifyInstance,
  channelId: string,
  resourceId: string | undefined,
): Promise<void> {
  const { prisma, redis, googleOAuthService, queueService } = fastify.services;

  // Look up the OAuth token by driveChannelId
  const tokenRecord = await prisma.googleOAuthToken.findFirst({
    where: { driveChannelId: channelId },
  });

  if (!tokenRecord) {
    logger.warn('No OAuth token found for Drive channel', { channelId });
    return;
  }

  const { tenantId, userId } = tokenRecord;

  // Get decrypted tokens via the OAuth service
  if (!googleOAuthService) {
    logger.error('GoogleOAuthService not available');
    return;
  }

  let tokens = await googleOAuthService.getTokens(tenantId, userId);
  if (!tokens) {
    logger.warn('No decrypted tokens found for user', { tenantId, userId });
    return;
  }

  // Refresh access token if it's expired or about to expire (within 5 min)
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (tokens.expiresAt < fiveMinutesFromNow) {
    logger.debug('Access token expired or expiring soon, refreshing', { tenantId, userId });
    const newAccessToken = await googleOAuthService.refreshAccessToken(tenantId, userId);
    if (!newAccessToken) {
      logger.error('Failed to refresh access token', { tenantId, userId });
      return;
    }
    tokens = (await googleOAuthService.getTokens(tenantId, userId))!;
  }

  // Create an OAuth2 client with the user's tokens
  const oauth2Client = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Get the stored page token from Redis
  const pageTokenKey = `drive_page_token:${channelId}`;
  let pageToken = await redis.get(pageTokenKey);

  if (!pageToken) {
    logger.warn('No page token found in Redis, fetching new start token', { channelId });
    const startTokenRes = await drive.changes.getStartPageToken();
    pageToken = startTokenRes.data.startPageToken || null;
    if (!pageToken) {
      logger.error('Failed to obtain Drive start page token');
      return;
    }
  }

  // Fetch changes from Google Drive
  let nextPageToken: string | null = pageToken;
  const meetRecordings: Array<{
    fileId: string;
    name: string;
    mimeType: string;
    size: string;
  }> = [];

  while (nextPageToken) {
    const currentPageToken: string = nextPageToken;
    const changesRes = await drive.changes.list({
      pageToken: currentPageToken,
      fields: 'nextPageToken,newStartPageToken,changes(fileId,file(id,name,mimeType,size,parents,trashed))',
      includeRemoved: false,
      pageSize: 100,
    });

    const changes = changesRes.data.changes || [];

    for (const change of changes) {
      const file = change.file;
      if (!file || !file.id || file.trashed) continue;

      // Check if this is a Meet recording by MIME type or parent folder name
      const isMeetMimeType = file.mimeType && MEET_RECORDING_MIME_TYPES.has(file.mimeType);
      const isInMeetFolder = file.name?.includes(MEET_RECORDINGS_FOLDER);

      if (isMeetMimeType || isInMeetFolder) {
        meetRecordings.push({
          fileId: file.id,
          name: file.name || 'Untitled Meeting Recording',
          mimeType: file.mimeType || 'video/mp4',
          size: file.size || '0',
        });
      }
    }

    // Update page token for next iteration or final storage
    if (changesRes.data.newStartPageToken) {
      // Store the new start page token for next notification
      await redis.set(pageTokenKey, changesRes.data.newStartPageToken, 'EX', 8 * 24 * 60 * 60);
      nextPageToken = null;
    } else {
      nextPageToken = changesRes.data.nextPageToken || null;
    }
  }

  if (meetRecordings.length === 0) {
    logger.debug('No new Meet recordings found in Drive changes', { channelId, tenantId });
    return;
  }

  logger.info('Found new Meet recordings in Drive', {
    tenantId,
    userId,
    count: meetRecordings.length,
    files: meetRecordings.map((f) => f.name),
  });

  // Process each recording
  for (const recording of meetRecordings) {
    try {
      await processRecording(fastify, drive, tenantId, userId, recording);
    } catch (error) {
      logger.error('Failed to process Meet recording', {
        tenantId,
        fileId: recording.fileId,
        fileName: recording.name,
        error: (error as Error).message,
      });
      // Continue with other recordings
    }
  }
}

/**
 * Process a single Google Meet recording:
 * 1. Download from Google Drive
 * 2. Upload to S3
 * 3. Create a Meeting record
 * 4. Queue transcription job
 */
async function processRecording(
  fastify: FastifyInstance,
  drive: ReturnType<typeof google.drive>,
  tenantId: string,
  userId: string,
  recording: { fileId: string; name: string; mimeType: string; size: string },
): Promise<void> {
  const { prisma, storageService, queueService } = fastify.services;

  // Check if we already processed this file (idempotency)
  const existingMeeting = await prisma.meeting.findFirst({
    where: {
      tenantId,
      source: 'google_meet',
      metadata: {
        path: ['driveFileId'],
        equals: recording.fileId,
      },
    },
  });

  if (existingMeeting) {
    logger.debug('Recording already processed, skipping', {
      fileId: recording.fileId,
      meetingId: existingMeeting.id,
    });
    return;
  }

  // Create Meeting record in 'uploading' state
  const meeting = await prisma.meeting.create({
    data: {
      tenantId,
      title: recording.name.replace(/\.[^.]+$/, ''),
      status: 'uploading',
      source: 'google_meet',
      meetingUrl: `https://drive.google.com/file/d/${recording.fileId}`,
      startTime: new Date(),
      participants: [],
      uploadedBy: userId,
      metadata: {
        driveFileId: recording.fileId,
        originalMimeType: recording.mimeType,
        originalSize: recording.size,
      },
    },
  });

  logger.info('Created Meeting record for Drive recording', {
    meetingId: meeting.id,
    fileId: recording.fileId,
  });

  if (!storageService.isEnabled()) {
    logger.error('Storage service not available, cannot ingest recording', {
      meetingId: meeting.id,
    });
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: 'failed' },
    });
    return;
  }

  // Download the file from Google Drive
  logger.debug('Downloading recording from Google Drive', {
    fileId: recording.fileId,
    size: recording.size,
  });

  const downloadRes = await drive.files.get(
    { fileId: recording.fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  const fileBuffer = await streamToBuffer(downloadRes.data as unknown as Readable);

  // Push to the configured storage driver via its presigned URL
  const { uploadUrl, storageKey } = await storageService.generatePresignedUploadUrl(
    meeting.id,
    'video/mp4',
    fileBuffer.length
  );

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(fileBuffer.length),
    },
    body: fileBuffer,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Storage upload failed with status ${uploadResponse.status}`);
  }

  // Update meeting with storage key and transition to transcribing
  await prisma.meeting.update({
    where: { id: meeting.id },
    data: {
      audioUrl: storageKey,
      status: 'transcribing',
    },
  });

  logger.info('Recording uploaded, queuing transcription', {
    meetingId: meeting.id,
    storageKey,
  });

  // Queue transcription job
  if (queueService) {
    await queueService.addJob(JobType.MEETING_TRANSCRIBE, {
      meetingId: meeting.id,
      tenantId,
      storageKey,
      source: 'google_meet',
    });
  } else {
    logger.warn('Queue service not available, transcription not queued', {
      meetingId: meeting.id,
    });
  }
}

export default registerGoogleDriveWebhook;
