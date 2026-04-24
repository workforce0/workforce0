/**
 * =============================================================================
 * TWILIO ROUTES
 * =============================================================================
 *
 * Routes for Twilio Voice API integration:
 * - TwiML webhook for call connection
 * - Status callback for call state changes
 * - WebSocket endpoint for Media Streams
 *
 * @module routes/twilio
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import WebSocket, { WebSocketServer } from 'ws';
import twilio from 'twilio';
import { createChildLogger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { TwilioVoiceService } from '../services/voice/twilio-voice.service.js';
import { TwilioMediaHandler } from '../services/voice/twilio-media-handler.js';

const logger = createChildLogger({ module: 'TwilioRoutes' });

/**
 * Entry wrapping a media handler with creation timestamp for stale cleanup.
 */
interface MediaHandlerEntry {
  handler: TwilioMediaHandler;
  createdAt: number; // Date.now() timestamp
}

/**
 * Active media handlers by meeting ID.
 */
const mediaHandlers = new Map<string, MediaHandlerEntry>();

/**
 * WebSocket rate limiting: maximum concurrent media stream sessions.
 */
const MAX_CONCURRENT_SESSIONS = 20;
let activeConnections = 0;

/** Stale handler threshold: 2 hours in milliseconds */
const STALE_HANDLER_THRESHOLD_MS = 2 * 60 * 60 * 1000;
/** Stale handler cleanup interval: 5 minutes in milliseconds */
const STALE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
/** Reference to the stale cleanup interval timer for shutdown */
let staleCleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Route dependencies.
 */
export interface TwilioDependencies {
  twilioVoiceService: TwilioVoiceService;
  openaiApiKey: string;
  meetingRepository?: {
    findById: (id: string) => Promise<{
      id: string;
      tenantId: string;
      title: string;
      metadata?: Record<string, unknown>;
    } | null>;
    findByExternalId: (externalId: string) => Promise<{
      id: string;
      tenantId: string;
      title: string;
      metadata?: Record<string, unknown>;
    } | null>;
    update: (id: string, data: Record<string, unknown>) => Promise<void>;
  };
  /** Queue service for dispatching BA Agent jobs after Twilio calls */
  queueService?: {
    addJob: (type: string, data: Record<string, unknown>) => Promise<unknown>;
  };
  /** Engagement service for creating engagements from completed calls */
  engagementService?: {
    create: (tenantId: string, input: { title: string; meetingId?: string }) => Promise<{ id: string }>;
  };
}

/**
 * Register Twilio routes.
 */
export async function twilioRoutes(
  fastify: FastifyInstance,
  deps: TwilioDependencies
): Promise<void> {
  const { twilioVoiceService } = deps;

  // ============================================================================
  // POST /api/voice/dial-in - Initiate dial-in to a meeting
  // ============================================================================
  fastify.post<{
    Body: {
      meetingId: string;
      dialInNumber: string;
      pin?: string;
    };
  }>(
    '/dial-in',
    {
      schema: {
        body: {
          type: 'object',
          required: ['meetingId', 'dialInNumber'],
          properties: {
            meetingId: { type: 'string', minLength: 1, maxLength: 255 },
            dialInNumber: { type: 'string', pattern: '^\\+[1-9]\\d{6,14}$' },
            pin: { type: 'string', pattern: '^[0-9wW#*]{0,20}$' },
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
                  callSid: { type: 'string' },
                  meetingId: { type: 'string' },
                  status: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantId = (request as any).tenantId as string;
      const { meetingId, dialInNumber, pin } = request.body;

      logger.info('Dial-in request received', { meetingId, dialInNumber });

      if (!twilioVoiceService.isAvailable()) {
        return reply.status(503).send({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Twilio service not configured',
          },
        });
      }

      // Verify meeting ownership
      if (deps.meetingRepository) {
        const meeting = await deps.meetingRepository.findById(meetingId);
        if (!meeting || meeting.tenantId !== tenantId) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Meeting not found' },
          });
        }
      }

      try {
        const callSid = await twilioVoiceService.dialIntoMeeting(
          meetingId,
          dialInNumber,
          pin
        );

        return reply.send({
          success: true,
          data: {
            callSid,
            meetingId,
            status: 'initiated',
          },
        });
      } catch (error) {
        logger.error('Failed to initiate dial-in', {
          meetingId,
          error: (error as Error).message,
        });

        return reply.status(500).send({
          success: false,
          error: {
            code: 'DIAL_IN_FAILED',
            message: (error as Error).message,
          },
        });
      }
    }
  );

  // ============================================================================
  // POST /api/voice/hangup - End a call
  // ============================================================================
  fastify.post<{
    Body: {
      meetingId?: string;
      callSid?: string;
    };
  }>(
    '/hangup',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            meetingId: { type: 'string' },
            callSid: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { meetingId, callSid } = request.body;

      if (!meetingId && !callSid) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Either meetingId or callSid required',
          },
        });
      }

      try {
        if (callSid) {
          await twilioVoiceService.hangup(callSid);
        } else if (meetingId) {
          await twilioVoiceService.hangupByMeeting(meetingId);
        }

        return reply.send({
          success: true,
          data: { message: 'Call ended' },
        });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: {
            code: 'HANGUP_FAILED',
            message: (error as Error).message,
          },
        });
      }
    }
  );

  // ============================================================================
  // GET /api/voice/calls - List active calls
  // ============================================================================
  fastify.get('/calls', async (request, reply) => {
    const calls = twilioVoiceService.getActiveCalls();
    return reply.send({
      success: true,
      data: calls.map((call) => ({
        callSid: call.callSid,
        meetingId: call.meetingId,
        status: call.status,
        startedAt: call.startedAt.toISOString(),
      })),
    });
  });

  logger.info('Twilio API routes registered');
}

/**
 * Verify Twilio webhook signature.
 * Uses Twilio's validateRequest() to verify the X-Twilio-Signature header.
 */
function verifyTwilioWebhook(request: FastifyRequest, reply: FastifyReply): boolean {
  const authToken = config.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // In production, missing auth token means we cannot verify signatures -- reject.
    if (config.NODE_ENV === 'production') {
      logger.error('Twilio auth token not configured - rejecting webhook in production');
      reply.status(500).send({ error: 'Twilio signature verification not configured' });
      return false;
    }
    // In development/test, warn loudly but allow to proceed for local testing.
    logger.error('Twilio auth token not configured - signature verification skipped (non-production only)');
    return true;
  }

  const twilioSignature = request.headers['x-twilio-signature'] as string;
  if (!twilioSignature) {
    logger.warn('Twilio webhook missing X-Twilio-Signature header');
    reply.status(401).send({ error: 'Missing Twilio signature' });
    return false;
  }

  // Reconstruct the full URL Twilio used to generate the signature
  const protocol = request.headers['x-forwarded-proto'] || 'http';
  const host = request.headers['host'] || 'localhost';
  const url = `${protocol}://${host}${request.url}`;

  const params = (request.body as Record<string, any>) || {};
  const isValid = twilio.validateRequest(authToken, twilioSignature, url, params);

  if (!isValid) {
    logger.warn('Invalid Twilio webhook signature', { url });
    reply.status(401).send({ error: 'Invalid Twilio signature' });
    return false;
  }

  return true;
}

/**
 * Register Twilio webhook routes (signature verification via X-Twilio-Signature).
 */
export async function twilioWebhookRoutes(
  fastify: FastifyInstance,
  deps: TwilioDependencies
): Promise<void> {
  const { twilioVoiceService } = deps;

  // ============================================================================
  // POST /webhooks/twilio/voice - TwiML webhook when call connects
  // ============================================================================
  fastify.post<{
    Querystring: { meetingId?: string };
  }>(
    '/voice',
    {
      config: {
        rawBody: true,
      } as any,
    },
    async (request, reply) => {
      // Verify Twilio signature
      if (!verifyTwilioWebhook(request, reply)) return;

      const meetingId = request.query.meetingId || 'unknown';

      logger.info('Twilio voice webhook received', { meetingId });

      // Generate TwiML to connect to our media stream
      const twiml = twilioVoiceService.generateConnectTwiML(meetingId);

      reply.type('text/xml');
      return reply.send(twiml);
    }
  );

  // ============================================================================
  // POST /webhooks/twilio/status - Call status callback
  // ============================================================================
  fastify.post<{
    Querystring: { meetingId?: string };
    Body: {
      CallSid: string;
      CallStatus: string;
      CallDuration?: string;
      ErrorCode?: string;
      ErrorMessage?: string;
    };
  }>('/status', async (request, reply) => {
    // Verify Twilio signature
    if (!verifyTwilioWebhook(request, reply)) return;

    const { CallSid, CallStatus, ErrorCode, ErrorMessage } = request.body;
    const meetingId = request.query.meetingId;

    logger.info('Twilio status callback', {
      callSid: CallSid,
      status: CallStatus,
      meetingId,
      errorCode: ErrorCode,
    });

    // Update call status in our service
    twilioVoiceService.updateCallStatus(
      CallSid,
      CallStatus as 'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer' | 'canceled'
    );

    // Persist captured data and clean up media handler if call ended
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
      const entry = mediaHandlers.get(meetingId || '');
      if (entry) {
        // Extract captured data before cleanup destroys the handler state
        const capturedData = entry.handler.getCapturedData();
        const hasData = capturedData.requirements.length > 0 ||
          capturedData.decisions.length > 0 ||
          capturedData.actionItems.length > 0 ||
          capturedData.flags.length > 0;

        // Persist voice-captured data to meeting metadata
        if (hasData && meetingId && deps.meetingRepository) {
          try {
            logger.info('Persisting voice-captured data to meeting', {
              meetingId,
              requirements: capturedData.requirements.length,
              decisions: capturedData.decisions.length,
              actionItems: capturedData.actionItems.length,
              flags: capturedData.flags.length,
            });

            // Merge captured data into meeting metadata JSON field
            await deps.meetingRepository.update(meetingId, {
              metadata: {
                voiceCapturedData: {
                  requirements: capturedData.requirements,
                  decisions: capturedData.decisions,
                  actionItems: capturedData.actionItems,
                  flags: capturedData.flags,
                  capturedAt: new Date().toISOString(),
                  callSid: CallSid,
                },
              },
            });

            logger.info('Voice-captured data persisted', { meetingId });

            // Create engagement + queue BA Agent for the completed call
            if (CallStatus === 'completed' && deps.engagementService && deps.queueService) {
              try {
                const meeting = await deps.meetingRepository.findById(meetingId);
                if (meeting) {
                  const engagement = await deps.engagementService.create(meeting.tenantId, {
                    title: meeting.title || `Voice call ${meetingId}`,
                    meetingId,
                  });
                  logger.info('Engagement created from Twilio call', {
                    engagementId: engagement.id,
                    meetingId,
                  });

                  // Queue MEETING_PROCESS so BA Agent picks up transcript + voice data
                  await deps.queueService.addJob('meeting_process', {
                    meetingId,
                    tenantId: meeting.tenantId,
                  });
                  logger.info('BA Agent job queued for Twilio call', { meetingId });
                }
              } catch (engErr) {
                logger.error('Failed to create engagement/queue BA Agent after Twilio call', {
                  meetingId,
                  error: (engErr as Error).message,
                });
              }
            }
          } catch (err) {
            logger.error('Failed to persist voice-captured data', {
              meetingId,
              error: (err as Error).message,
            });
          }
        }

        entry.handler.cleanup();
        mediaHandlers.delete(meetingId || '');
        logger.info('Media handler cleaned up', { meetingId });
      }
    }

    return reply.status(204).send();
  });

  logger.info('Twilio webhook routes registered');
}

/**
 * Set up WebSocket server for Twilio Media Streams.
 *
 * Returns a `noServer` WebSocketServer that should be registered with the
 * shared WebSocket dispatcher.  The dispatcher will call `handleUpgrade`
 * and emit `connection` events; this function wires up the connection
 * handler and stale-cleanup timer.
 *
 * @param deps - Route dependencies (no longer needs the HTTP server)
 */
export function setupTwilioMediaStreamWebSocket(
  deps: TwilioDependencies
): WebSocketServer {
  const { openaiApiKey } = deps;

  // Create WebSocket server without attaching to HTTP server
  const wss = new WebSocketServer({
    noServer: true,
  });

  // Handle connections dispatched by the shared WebSocket dispatcher
  wss.on('connection', (ws: WebSocket, request: import('http').IncomingMessage) => {
    try {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      const pathMatch = url.pathname.match(/^\/media-stream\/(.+)$/);

      if (!pathMatch) {
        logger.warn('Twilio WS connection with unexpected path', { pathname: url.pathname });
        ws.close();
        return;
      }

      const meetingId = decodeURIComponent(pathMatch[1]);

      // --- Rate limiting: reject if too many concurrent sessions ---
      if (activeConnections >= MAX_CONCURRENT_SESSIONS) {
        logger.error('WebSocket connection rejected: max concurrent sessions reached', {
          meetingId,
          activeConnections,
          max: MAX_CONCURRENT_SESSIONS,
        });
        ws.close();
        return;
      }

      // --- Auth: only accept connections for meetingIds that have an active dial-in call ---
      const activeCall = deps.twilioVoiceService.getCallByMeeting(meetingId);
      if (!activeCall) {
        logger.error('WebSocket connection rejected: no active call for meetingId', { meetingId });
        ws.close();
        return;
      }

      logger.info('Media stream WebSocket connected', { meetingId, callSid: activeCall.callSid });

      activeConnections++;

      try {
        handleMediaStreamConnection(ws, meetingId, openaiApiKey);

        // Decrement on close
        ws.on('close', () => {
          activeConnections = Math.max(0, activeConnections - 1);
          logger.debug('WebSocket closed, active connections', { activeConnections });
        });
      } catch (error) {
        activeConnections = Math.max(0, activeConnections - 1);
        logger.error('Error handling Twilio media stream connection', {
          meetingId,
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
        ws.close();
      }
    } catch (error) {
      logger.error('Error in Twilio WS connection handler', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      ws.close();
    }
  });

  // Start periodic cleanup of stale handlers (every 5 minutes)
  staleCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [meetingId, entry] of mediaHandlers) {
      const ageMs = now - entry.createdAt;
      if (ageMs > STALE_HANDLER_THRESHOLD_MS) {
        logger.warn('Removing stale media handler', {
          meetingId,
          ageMinutes: Math.round(ageMs / 60000),
        });
        entry.handler.cleanup();
        mediaHandlers.delete(meetingId);
      }
    }
  }, STALE_CLEANUP_INTERVAL_MS);

  // Ensure cleanup interval is cleared on server close
  wss.on('close', () => {
    if (staleCleanupInterval) {
      clearInterval(staleCleanupInterval);
      staleCleanupInterval = null;
    }
  });

  logger.info('Twilio Media Stream WebSocket server ready');
  return wss;
}

/**
 * Handle a new Media Stream WebSocket connection.
 */
function handleMediaStreamConnection(
  ws: WebSocket,
  meetingId: string,
  openaiApiKey: string
): void {
  logger.info('New media stream connection', { meetingId });

  try {
    // Clean up any existing handler for this meeting to prevent session overwrite
    if (mediaHandlers.has(meetingId)) {
      const oldEntry = mediaHandlers.get(meetingId)!;
      logger.warn('Overwriting existing media handler for meeting - cleaning up old handler', {
        meetingId,
        oldHandlerActive: oldEntry.handler.isActive(),
      });
      oldEntry.handler.cleanup();
      mediaHandlers.delete(meetingId);
    }

    // Create handler for this connection
    const handler = new TwilioMediaHandler(meetingId, openaiApiKey);
    mediaHandlers.set(meetingId, { handler, createdAt: Date.now() });

    // Attach the WebSocket
    handler.attachWebSocket(ws);

    // Set up event handlers
    handler.on('streamStarted', (streamSid, callSid) => {
      logger.info('Media stream started', { meetingId, streamSid, callSid });
    });

    handler.on('streamEnded', (streamSid) => {
      logger.info('Media stream ended', { meetingId, streamSid });
      mediaHandlers.delete(meetingId);
    });

    handler.on('aiResponse', (text) => {
      logger.info('AI response', { meetingId, text: text.substring(0, 100) });
    });

    handler.on('error', (error) => {
      logger.error('Media handler error', { meetingId, error: error.message });
    });

    // Handle WebSocket close - cleanup is handled by the handler internally,
    // we just need to remove from the map
    ws.on('close', () => {
      logger.info('Media stream WebSocket closed', { meetingId });
      mediaHandlers.delete(meetingId);
    });
  } catch (error) {
    logger.error('Failed to setup media stream connection', {
      meetingId,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    ws.close();
  }
}

/**
 * Get a media handler by meeting ID.
 */
export function getMediaHandler(meetingId: string): TwilioMediaHandler | undefined {
  return mediaHandlers.get(meetingId)?.handler;
}

/**
 * Send transcript to a media handler (for feeding real-time transcript to OpenAI).
 */
export function sendTranscriptToHandler(
  meetingId: string,
  speaker: string,
  text: string
): void {
  const entry = mediaHandlers.get(meetingId);
  if (entry && entry.handler.isActive()) {
    entry.handler.sendTranscript(speaker, text);
  }
}
