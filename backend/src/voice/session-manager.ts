/**
 * =============================================================================
 * VOICE SESSION MANAGER
 * =============================================================================
 *
 * Manages active voice sessions across all meetings.
 * This is a singleton that coordinates:
 * - Starting voice sessions when meetings begin
 * - Routing real-time transcripts to Gemini Live
 * - Routing Gemini audio responses back via Twilio
 * - Stopping sessions when meetings end
 *
 * @module voice/session-manager
 */

import { EventEmitter } from 'events';
import { createChildLogger } from '../lib/logger.js';
import { MeetingVoiceSession, MeetingSessionSummary } from './meeting-session.js';

const logger = createChildLogger({ module: 'VoiceSessionManager' });

/**
 * Events emitted by the session manager.
 */
export interface VoiceSessionManagerEvents {
  /** Session started for a meeting */
  sessionStarted: (meetingId: string, sessionId: string) => void;
  /** Session ended for a meeting */
  sessionEnded: (meetingId: string, summary: MeetingSessionSummary) => void;
  /** Error in a session */
  sessionError: (meetingId: string, error: Error) => void;
}

/**
 * Configuration for the session manager.
 */
export interface VoiceSessionManagerConfig {
  geminiApiKey: string;
  /** Whether the AI should actively participate (ask questions) */
  activeParticipation?: boolean;
}

/**
 * Active session tracking.
 */
interface ActiveSession {
  session: MeetingVoiceSession;
  botId: string;
  startedAt: Date;
}

/**
 * Manages voice sessions for all active meetings.
 *
 * @example
 * ```typescript
 * const manager = new VoiceSessionManager({
 *   geminiApiKey: process.env.GEMINI_API_KEY,
 *   // Audio output handled by Twilio
 * });
 *
 * // Start session when meeting begins recording
 * await manager.startSession('meeting-123', 'bot-456');
 *
 * // Route real-time transcript to session
 * manager.handleTranscriptChunk('meeting-123', { speaker: 'John', text: 'hello' });
 *
 * // End session when meeting ends
 * const summary = await manager.endSession('meeting-123');
 * ```
 */
export class VoiceSessionManager extends EventEmitter {
  private readonly config: VoiceSessionManagerConfig;
  private readonly sessions: Map<string, ActiveSession> = new Map();

  constructor(config: VoiceSessionManagerConfig) {
    super();
    this.config = config;

    logger.info('VoiceSessionManager initialized', {
      activeParticipation: config.activeParticipation ?? true,
    });
  }

  /**
   * Start a voice session for a meeting.
   *
   * @param meetingId - Internal meeting ID
   * @param botId - External bot/session ID
   */
  async startSession(meetingId: string, botId: string): Promise<void> {
    if (this.sessions.has(meetingId)) {
      logger.warn('Session already exists for meeting', { meetingId });
      return;
    }

    logger.info('Starting voice session', { meetingId, botId });

    try {
      const session = new MeetingVoiceSession({
        meetingId,
        geminiApiKey: this.config.geminiApiKey,
        activeParticipation: this.config.activeParticipation ?? true,
        onAudioOutput: async (audioData) => {
          // Audio output is handled by Twilio Media Stream when using voice dial-in.
          // This callback is a no-op for now; Twilio routes handle audio injection.
          logger.debug('Audio output received (no active audio sink)', {
            meetingId,
            bytes: audioData.length,
          });
        },
      });

      // Wire up session events
      session.on('ready', () => {
        logger.info('Voice session ready', { meetingId });
        this.emit('sessionStarted', meetingId, session.getId());
      });

      session.on('error', (error) => {
        logger.error('Voice session error', {
          meetingId,
          error: error.message,
        });
        this.emit('sessionError', meetingId, error);
      });

      session.on('requirementCaptured', (requirement) => {
        logger.info('Requirement captured in real-time', {
          meetingId,
          requirement: requirement.content.substring(0, 100),
        });
      });

      session.on('aiSpoke', (text) => {
        logger.debug('AI spoke in meeting', {
          meetingId,
          text: text.substring(0, 100),
        });
      });

      // Start the session
      await session.start();

      this.sessions.set(meetingId, {
        session,
        botId,
        startedAt: new Date(),
      });

      logger.info('Voice session started', {
        meetingId,
        sessionId: session.getId(),
      });

    } catch (error) {
      logger.error('Failed to start voice session', {
        meetingId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * End a voice session for a meeting.
   *
   * @param meetingId - Internal meeting ID
   * @returns Session summary or null if no session
   */
  async endSession(meetingId: string): Promise<MeetingSessionSummary | null> {
    const activeSession = this.sessions.get(meetingId);

    if (!activeSession) {
      logger.warn('No active session for meeting', { meetingId });
      return null;
    }

    logger.info('Ending voice session', { meetingId });

    try {
      const summary = await activeSession.session.end();
      this.sessions.delete(meetingId);

      logger.info('Voice session ended', {
        meetingId,
        duration: summary.duration,
        requirements: summary.requirements.length,
        actionItems: summary.actionItems.length,
      });

      this.emit('sessionEnded', meetingId, summary);
      return summary;

    } catch (error) {
      logger.error('Failed to end voice session', {
        meetingId,
        error: (error as Error).message,
      });

      // Clean up anyway
      this.sessions.delete(meetingId);
      throw error;
    }
  }

  /**
   * Handle real-time transcript chunk from webhook.
   *
   * This routes the transcript text to the Gemini Live session
   * for real-time processing.
   *
   * @param meetingId - Internal meeting ID
   * @param chunk - Transcript chunk data
   */
  handleTranscriptChunk(
    meetingId: string,
    chunk: {
      speaker?: string;
      text: string;
      startTime: number;
      endTime: number;
    }
  ): void {
    const activeSession = this.sessions.get(meetingId);

    if (!activeSession) {
      // No voice session for this meeting - just log and skip
      logger.debug('No voice session for transcript chunk', { meetingId });
      return;
    }

    // Format as text input for Gemini (since we're receiving text, not audio)
    // In a full implementation, we'd receive raw audio from Twilio WebSocket
    // and pipe it directly to Gemini's audio input
    const formattedText = chunk.speaker
      ? `${chunk.speaker}: ${chunk.text}`
      : chunk.text;

    activeSession.session.sendTextMessage(formattedText);
  }

  /**
   * Process raw audio from real-time stream.
   *
   * @param meetingId - Internal meeting ID
   * @param audioChunk - Raw PCM audio data
   */
  processAudio(meetingId: string, audioChunk: Buffer): void {
    const activeSession = this.sessions.get(meetingId);

    if (!activeSession) {
      return;
    }

    activeSession.session.processAudio(audioChunk);
  }

  /**
   * Check if a meeting has an active voice session.
   */
  hasSession(meetingId: string): boolean {
    return this.sessions.has(meetingId);
  }

  /**
   * Get session for a meeting (for debugging/monitoring).
   */
  getSession(meetingId: string): MeetingVoiceSession | null {
    return this.sessions.get(meetingId)?.session ?? null;
  }

  /**
   * Get all active session IDs.
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get session stats for a meeting.
   */
  getSessionStats(meetingId: string): {
    meetingId: string;
    sessionId: string;
    botId: string;
    startedAt: Date;
    stats: ReturnType<MeetingVoiceSession['getStats']>;
  } | null {
    const activeSession = this.sessions.get(meetingId);

    if (!activeSession) {
      return null;
    }

    return {
      meetingId,
      sessionId: activeSession.session.getId(),
      botId: activeSession.botId,
      startedAt: activeSession.startedAt,
      stats: activeSession.session.getStats(),
    };
  }

  /**
   * End all active sessions (for graceful shutdown).
   */
  async endAllSessions(): Promise<void> {
    logger.info('Ending all voice sessions', {
      count: this.sessions.size,
    });

    const meetingIds = Array.from(this.sessions.keys());

    for (const meetingId of meetingIds) {
      try {
        await this.endSession(meetingId);
      } catch (error) {
        logger.error('Failed to end session during shutdown', {
          meetingId,
          error: (error as Error).message,
        });
      }
    }

    logger.info('All voice sessions ended');
  }
}

/**
 * Type declaration for EventEmitter with our events.
 */
export interface VoiceSessionManager {
  on<K extends keyof VoiceSessionManagerEvents>(
    event: K,
    listener: VoiceSessionManagerEvents[K]
  ): this;
  emit<K extends keyof VoiceSessionManagerEvents>(
    event: K,
    ...args: Parameters<VoiceSessionManagerEvents[K]>
  ): boolean;
}
