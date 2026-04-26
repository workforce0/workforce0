/**
 * =============================================================================
 * VOICE MEDIA STREAM (Twilio MS WebSocket → VoiceProvider)
 * =============================================================================
 *
 * GET (WS) /media-stream/inbound/:callSid
 *
 * Twilio Media Streams opens this WS once `<Connect><Stream>` is returned by
 * `/webhooks/twilio/voice/inbound`. We resolve the tenant + voice provider,
 * call `provider.startSession`, and bridge audio. On transcript completion
 * we write a Meeting row and enqueue MEETING_PROCESS so the existing BA
 * Agent → PRD pipeline picks it up.
 *
 * Codebase WS pattern: this module exports a `setupVoiceMediaStreamWebSocket`
 * factory that returns a `noServer` WebSocketServer, registered with the
 * shared dispatcher in `backend/src/index.ts` (same shape as
 * `setupTwilioMediaStreamWebSocket`). We don't use `@fastify/websocket`
 * because it isn't a dependency of this codebase.
 *
 * @module routes/voice-media-stream.routes
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { createChildLogger } from '../lib/logger.js';
import { INTAKE_SYSTEM_PROMPT } from '../services/voice-provider/intake-system-prompt.js';
import type {
  VoiceProvider,
  TranscriptDoc,
} from '../services/voice-provider/voice-provider.types.js';

const logger = createChildLogger({ service: 'VoiceMediaStream' });

/**
 * Path prefix this dispatcher handles. The shared WS dispatcher matches by
 * `pathname.startsWith(prefix)`, so this must be more specific than the
 * existing `/media-stream/` prefix used by `setupTwilioMediaStreamWebSocket`.
 * Insert this prefix into `wsRoutes` BEFORE `/media-stream/` so it matches first.
 */
export const VOICE_MEDIA_STREAM_PREFIX = '/media-stream/inbound/';

export interface VoiceMediaStreamDeps {
  voiceProviderRouter: {
    resolveProvider(tenantId: string): Promise<VoiceProvider | null>;
  };
  tenantResolver: {
    resolveTenantByCallSid(callSid: string): Promise<string>;
  };
  meetingService: {
    createFromVoiceTranscript(input: {
      tenantId: string;
      callId: string;
      callerNumber: string;
      transcript: TranscriptDoc;
    }): Promise<{ id: string }>;
  };
  queueService: {
    addJob(name: string, payload: unknown): Promise<string>;
  };
}

/**
 * Build a `noServer` WebSocketServer for inbound voice intake media streams.
 * The shared dispatcher in `backend/src/index.ts` calls `wss.handleUpgrade`
 * for any URL whose pathname starts with `/media-stream/inbound/`.
 */
export function setupVoiceMediaStreamWebSocket(
  deps: VoiceMediaStreamDeps,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    void handleConnection(ws, request, deps).catch((err) => {
      logger.error(
        { err: (err as Error).message, stack: (err as Error).stack },
        'Voice media stream connection failed',
      );
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    });
  });

  logger.info('Voice intake media-stream WebSocket server ready');
  return wss;
}

async function handleConnection(
  ws: WebSocket,
  request: IncomingMessage,
  deps: VoiceMediaStreamDeps,
): Promise<void> {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  // Match `/media-stream/inbound/<callSid>` — anything after the prefix.
  const match = url.pathname.match(/^\/media-stream\/inbound\/(.+)$/);
  if (!match) {
    logger.warn({ pathname: url.pathname }, 'Voice WS rejected — bad path');
    ws.close();
    return;
  }
  const callSid = decodeURIComponent(match[1]);

  const tenantId = await deps.tenantResolver.resolveTenantByCallSid(callSid);
  logger.info({ callSid, tenantId }, 'Voice media stream opened');

  const provider = await deps.voiceProviderRouter.resolveProvider(tenantId);
  if (!provider) {
    logger.warn({ callSid, tenantId }, 'No voice provider available — closing');
    ws.close();
    return;
  }

  const handle = await provider.startSession({
    callId: callSid,
    tenantId,
    callerNumber: '',
    audioInWs: ws,
    systemPrompt: INTAKE_SYSTEM_PROMPT,
  });

  handle.onTranscriptComplete(async (transcript) => {
    if (!transcript.text || transcript.turns.length === 0) {
      logger.warn({ callSid }, 'Empty transcript — not enqueueing MEETING_PROCESS');
      return;
    }
    try {
      const meeting = await deps.meetingService.createFromVoiceTranscript({
        tenantId,
        callId: callSid,
        callerNumber: '',
        transcript,
      });
      await deps.queueService.addJob('meeting_process', {
        meetingId: meeting.id,
        tenantId,
      });
      logger.info(
        { callSid, meetingId: meeting.id },
        'Voice intake → MEETING_PROCESS enqueued',
      );
    } catch (err) {
      logger.error(
        { callSid, err: (err as Error).message },
        'Failed to persist voice transcript',
      );
    }
  });

  handle.onError((err) => {
    logger.error({ callSid, err: err.message }, 'Voice session error');
  });

  ws.on('close', () => {
    void handle.stop().catch((err) => {
      logger.warn(
        { callSid, err: (err as Error).message },
        'Error stopping voice session on WS close',
      );
    });
  });
}
