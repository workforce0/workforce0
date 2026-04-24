/**
 * =============================================================================
 * LIVE MEETING CAPTURE
 * =============================================================================
 *
 * Step 4 of the end-to-end loop. Lets the user run Workforce0 alongside
 * any meeting they join (Zoom / Meet / Teams / in-person) by capturing
 * browser mic or tab audio and streaming it here for transcription.
 *
 * Scope (MVP):
 *   - Session lifecycle: start → stream (elsewhere) → end
 *   - Session metadata persisted in Redis with 4-hour TTL
 *   - On end, creates a Meeting row with the accumulated transcript and
 *     enqueues a BA_AGENT_PROCESS job — same downstream path as upload/
 *     paste, so everything post-transcript (BA → Architect → Dev) Just
 *     Works.
 *
 * Deliberately skipped (ship in a follow-up):
 *   - Real Gemini Live streaming transcription (stub generator here;
 *     production implementation would pipe audio chunks to Gemini Live
 *     and collect partial results)
 *   - Browser extension / tab-audio capture. The web UI can use
 *     navigator.mediaDevices.getUserMedia for mic-only MVP.
 *
 * @module services/meeting/live-capture
 */

import crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import type { QueueService, BAAgentProcessJobData } from '../queue/queue.service.js';
import { JobType } from '../queue/queue.service.js';
import { createChildLogger } from '../../lib/logger.js';

const SESSION_PREFIX = 'live-capture:session:';
const CHUNK_PREFIX = 'live-capture:chunks:';
const SESSION_TTL = 60 * 60 * 4; // 4 hours

export interface LiveCaptureSession {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  startedAt: string;
  status: 'streaming' | 'ended';
}

export interface LiveTranscriptChunk {
  text: string;
  speaker?: string;
  at: string;
}

/** N6 final: optional ticket-first primary writer. When present, end()
 *  creates a Ticket + reverse-mirror AgentTask via
 *  TicketService.createAsNewWork instead of passing taskId='' to BA,
 *  which closes out the last fallback into TaskRepository.createTask. */
export interface LiveCaptureTicketService {
  createAsNewWork(input: {
    tenantId: string;
    roleSlug: string;
    title: string;
    description?: string;
    meetingId?: string | null;
    payload?: Record<string, unknown>;
    agentTaskInput?: Record<string, unknown>;
  }): Promise<{ ticket: { id: string }; agentTaskId: string }>;
}

export class LiveCaptureService {
  private readonly logger = createChildLogger({ service: 'LiveCaptureService' });
  private ticketService?: LiveCaptureTicketService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly queue?: QueueService,
  ) {}

  /** N6 final: wired by the DI container after TicketService exists.
   *  When set, end() creates the BA work via ticket-first primary
   *  write and passes the reverse-mirror AgentTask id to the queue,
   *  eliminating the empty-taskId fallback into BAAgentService. */
  setTicketService(ts: LiveCaptureTicketService): void {
    this.ticketService = ts;
  }

  /** Start a session. Returns the session id client will stream to. */
  async start(input: { tenantId: string; userId: string; title: string }): Promise<LiveCaptureSession> {
    const session: LiveCaptureSession = {
      id: crypto.randomBytes(9).toString('hex'),
      tenantId: input.tenantId,
      userId: input.userId,
      title: input.title || `Live capture ${new Date().toISOString()}`,
      startedAt: new Date().toISOString(),
      status: 'streaming',
    };
    await this.redis.setex(
      `${SESSION_PREFIX}${session.id}`,
      SESSION_TTL,
      JSON.stringify(session),
    );
    this.logger.info('Live capture started', { sessionId: session.id, tenantId: input.tenantId });
    return session;
  }

  /**
   * Append a transcript chunk from the streaming pipeline. Multiple chunks
   * accumulate under the session id until end().
   *
   * (Audio-to-text happens elsewhere — this method just stores the
   * already-transcribed chunk. In production, a Gemini Live worker
   * pushes chunks here as it processes the incoming audio.)
   */
  async appendChunk(sessionId: string, chunk: LiveTranscriptChunk): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found or expired`);
    if (session.status !== 'streaming') {
      throw new Error(`Session ${sessionId} is not streaming (status=${session.status})`);
    }
    await this.redis.rpush(`${CHUNK_PREFIX}${sessionId}`, JSON.stringify(chunk));
    await this.redis.expire(`${CHUNK_PREFIX}${sessionId}`, SESSION_TTL);
  }

  async get(sessionId: string): Promise<LiveCaptureSession | null> {
    const raw = await this.redis.get(`${SESSION_PREFIX}${sessionId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LiveCaptureSession;
    } catch {
      return null;
    }
  }

  /** Current chunk count for observability. */
  async chunkCount(sessionId: string): Promise<number> {
    return this.redis.llen(`${CHUNK_PREFIX}${sessionId}`);
  }

  /**
   * Finalize the session. Concatenates chunks into a transcript, writes
   * a Meeting row, enqueues BA processing. Returns the meeting id so
   * the UI can link straight to the brief when it's ready.
   */
  async end(sessionId: string): Promise<{ meetingId: string; transcriptLength: number }> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found or expired`);

    const rawChunks = await this.redis.lrange(`${CHUNK_PREFIX}${sessionId}`, 0, -1);
    const chunks: LiveTranscriptChunk[] = rawChunks
      .map((raw) => {
        try {
          return JSON.parse(raw) as LiveTranscriptChunk;
        } catch {
          return null;
        }
      })
      .filter((c): c is LiveTranscriptChunk => Boolean(c));

    const transcript = chunks
      .map((c) => (c.speaker ? `${c.speaker}: ${c.text}` : c.text))
      .join('\n');

    const meeting = await this.prisma.meeting.create({
      data: {
        tenantId: session.tenantId,
        title: session.title,
        status: transcript.length > 0 ? 'completed' : 'failed',
        startTime: new Date(session.startedAt),
        endTime: new Date(),
        meetingUrl: `live://${session.id}`,
        metadata: { source: 'live_capture', sessionId: session.id } as any,
      },
    });

    if (transcript.length > 0) {
      await this.prisma.transcript.create({
        data: {
          meetingId: meeting.id,
          fullText: transcript,
          wordCount: transcript.split(/\s+/).length,
          duration: Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000),
          segments: chunks.map((c) => ({
            speaker: c.speaker ?? null,
            text: c.text,
            startTime: c.at,
          })) as any,
        },
      });

      // Kick off BA agent → Architect → Dev via the same queue path as uploads.
      if (this.queue) {
        // N6 final: pre-create a Ticket + reverse-mirror AgentTask so
        // the queue receives a real taskId instead of the '' sentinel
        // that forced BAAgentService to fall back to
        // taskRepository.createTask (which is deprecated).
        let taskId = '';
        let ticketId: string | undefined;
        if (this.ticketService) {
          try {
            const created = await this.ticketService.createAsNewWork({
              tenantId: session.tenantId,
              roleSlug: 'ba_agent',
              title: session.title || `Live capture ${meeting.id}`,
              meetingId: meeting.id,
              agentTaskInput: {
                type: 'meeting_transcript',
                meetingId: meeting.id,
                transcriptLength: transcript.length,
              },
              payload: { type: 'meeting_transcript', meetingId: meeting.id },
            });
            taskId = created.agentTaskId;
            ticketId = created.ticket.id;
          } catch (err) {
            this.logger.warn('ticketService.createAsNewWork failed; falling back to legacy empty-taskId', {
              sessionId,
              error: (err as Error).message,
            });
          }
        }
        const jobData: BAAgentProcessJobData = {
          taskId, // populated when ticketService is wired; '' otherwise (BA creates one — deprecated)
          ticketId,
          tenantId: session.tenantId,
          meetingId: meeting.id,
          transcript,
        };
        await this.queue.addJob(JobType.BA_AGENT_PROCESS, jobData);
      }
    }

    // Mark session ended + clean up chunks
    await this.redis.setex(
      `${SESSION_PREFIX}${sessionId}`,
      SESSION_TTL,
      JSON.stringify({ ...session, status: 'ended' }),
    );
    await this.redis.del(`${CHUNK_PREFIX}${sessionId}`);

    this.logger.info('Live capture ended', {
      sessionId,
      meetingId: meeting.id,
      transcriptLength: transcript.length,
    });
    return { meetingId: meeting.id, transcriptLength: transcript.length };
  }
}
