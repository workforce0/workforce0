/**
 * =============================================================================
 * MEETING VOICE SESSION
 * =============================================================================
 *
 * Manages a voice-enabled meeting session, coordinating between:
 * - Twilio Media Stream (audio capture from meeting via dial-in)
 * - Gemini Live API (real-time AI processing)
 * - Meeting context (PRD, action items, etc.)
 *
 * Session Lifecycle:
 * ------------------
 * 1. Create session with meeting ID
 * 2. Connect to Gemini Live API
 * 3. Start receiving audio from Twilio
 * 4. Process audio, handle responses
 * 5. Collect PRD data and action items
 * 6. End session, generate final PRD
 *
 * @module voice/meeting-session
 */

import { EventEmitter } from 'events';
import { createChildLogger } from '../lib/logger.js';
import { GeminiLiveClient, SessionState } from './gemini-live.js';
import { GeminiLiveConfig, buildGeminiLiveConfig } from './config.js';

const logger = createChildLogger({ module: 'MeetingSession' });

/**
 * Events emitted by the meeting session.
 */
export interface MeetingSessionEvents {
  /** Session started and ready */
  ready: () => void;
  /** Session ended */
  ended: (summary: MeetingSessionSummary) => void;
  /** AI spoke to the meeting */
  aiSpoke: (text: string, audioData: Buffer) => void;
  /** Requirement captured */
  requirementCaptured: (requirement: CapturedRequirement) => void;
  /** Action item created */
  actionItemCreated: (item: ActionItem) => void;
  /** Ambiguity flagged for later */
  ambiguityFlagged: (ambiguity: FlaggedAmbiguity) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * Captured requirement from the meeting.
 */
export interface CapturedRequirement {
  id: string;
  content: string;
  section: 'objectives' | 'requirements' | 'acceptance_criteria' | 'out_of_scope' | 'assumptions';
  timestamp: Date;
  confidence: number;
  speakerHint?: string;
}

/**
 * Action item from the meeting.
 */
export interface ActionItem {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  dueDate?: Date;
  timestamp: Date;
}

/**
 * Ambiguity flagged for later clarification.
 */
export interface FlaggedAmbiguity {
  id: string;
  requirement: string;
  question: string;
  priority: 'high' | 'medium' | 'low';
  timestamp: Date;
}

/**
 * Summary generated at end of session.
 */
export interface MeetingSessionSummary {
  sessionId: string;
  meetingId: string;
  duration: number;
  requirements: CapturedRequirement[];
  actionItems: ActionItem[];
  ambiguities: FlaggedAmbiguity[];
  aiInteractionCount: number;
  transcriptLength: number;
}

/**
 * Session statistics for monitoring.
 */
export interface SessionStats {
  audioChunksReceived: number;
  audioChunksSent: number;
  aiResponses: number;
  toolCalls: number;
  interruptions: number;
  latencyMs: number[];
}

/**
 * Configuration for a meeting session.
 */
export interface MeetingSessionConfig {
  meetingId: string;
  geminiApiKey: string;
  voiceConfig?: Partial<GeminiLiveConfig>;
  /** Whether the AI should actively participate (ask questions) */
  activeParticipation: boolean;
  /** Callback to inject audio back into meeting */
  onAudioOutput?: (audioData: Buffer) => Promise<void>;
}

/**
 * Manages a voice-enabled meeting session.
 *
 * @example
 * ```typescript
 * const session = new MeetingVoiceSession({
 *   meetingId: 'meeting-123',
 *   geminiApiKey: process.env.GEMINI_API_KEY,
 *   activeParticipation: true,
 *   onAudioOutput: async (audio) => twilioStream.send(audio),
 * });
 *
 * await session.start();
 *
 * // Feed audio from Twilio Media Stream
 * twilioStream.on('audio', (chunk) => session.processAudio(chunk));
 *
 * // Handle events
 * session.on('requirementCaptured', (req) => prdService.addRequirement(req));
 *
 * // End session
 * const summary = await session.end();
 * ```
 */
export class MeetingVoiceSession extends EventEmitter {
  private readonly config: MeetingSessionConfig;
  private readonly geminiClient: GeminiLiveClient;
  private readonly sessionId: string;

  private startTime: Date | null = null;
  private endTime: Date | null = null;
  private isActive = false;

  // Collected data
  private requirements: CapturedRequirement[] = [];
  private actionItems: ActionItem[] = [];
  private ambiguities: FlaggedAmbiguity[] = [];
  private transcript: string[] = [];

  // Stats
  private stats: SessionStats = {
    audioChunksReceived: 0,
    audioChunksSent: 0,
    aiResponses: 0,
    toolCalls: 0,
    interruptions: 0,
    latencyMs: [],
  };

  constructor(config: MeetingSessionConfig) {
    super();

    this.config = config;
    this.sessionId = `session_${config.meetingId}_${Date.now()}`;

    // Build Gemini config
    const geminiConfig = buildGeminiLiveConfig(config.voiceConfig);

    // Modify system prompt based on participation mode
    if (!config.activeParticipation) {
      geminiConfig.systemInstruction = this.getPassiveSystemPrompt();
    }

    // Create Gemini client
    this.geminiClient = new GeminiLiveClient(config.geminiApiKey, geminiConfig);
    this.setupGeminiHandlers();

    logger.info('Meeting session created', {
      sessionId: this.sessionId,
      meetingId: config.meetingId,
      activeParticipation: config.activeParticipation,
    });
  }

  /**
   * Get session ID.
   */
  getId(): string {
    return this.sessionId;
  }

  /**
   * Check if session is active.
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Get current session statistics.
   */
  getStats(): SessionStats {
    return { ...this.stats };
  }

  /**
   * Start the meeting session.
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Session already active');
      return;
    }

    logger.info('Starting meeting session', { sessionId: this.sessionId });

    try {
      await this.geminiClient.connect();
      this.startTime = new Date();
      this.isActive = true;
      this.emit('ready');

      logger.info('Meeting session started', {
        sessionId: this.sessionId,
        geminiSessionId: this.geminiClient.getSessionId(),
      });
    } catch (error) {
      logger.error('Failed to start session', { error: (error as Error).message });
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Process incoming audio from the meeting.
   *
   * @param audioChunk - Raw PCM audio data from meeting stream
   */
  processAudio(audioChunk: Buffer): void {
    if (!this.isActive) {
      return;
    }

    this.stats.audioChunksReceived++;

    // Track latency
    const sendTime = Date.now();

    this.geminiClient.sendAudio(audioChunk);
    this.stats.audioChunksSent++;

    // Record latency when we get a response
    this.geminiClient.once('audio', () => {
      this.stats.latencyMs.push(Date.now() - sendTime);
    });
  }

  /**
   * Send a text message to the AI (for testing or commands).
   */
  sendTextMessage(text: string): void {
    if (!this.isActive) {
      return;
    }

    this.geminiClient.sendText(text);
  }

  /**
   * End the meeting session and generate summary.
   */
  async end(): Promise<MeetingSessionSummary> {
    if (!this.isActive) {
      throw new Error('Session is not active');
    }

    logger.info('Ending meeting session', { sessionId: this.sessionId });

    this.isActive = false;
    this.endTime = new Date();

    // Disconnect from Gemini
    this.geminiClient.disconnect();

    // Generate summary
    const summary: MeetingSessionSummary = {
      sessionId: this.sessionId,
      meetingId: this.config.meetingId,
      duration: this.endTime.getTime() - (this.startTime?.getTime() || 0),
      requirements: this.requirements,
      actionItems: this.actionItems,
      ambiguities: this.ambiguities,
      aiInteractionCount: this.stats.aiResponses,
      transcriptLength: this.transcript.join(' ').length,
    };

    logger.info('Meeting session ended', {
      sessionId: this.sessionId,
      duration: summary.duration,
      requirements: this.requirements.length,
      actionItems: this.actionItems.length,
    });

    this.emit('ended', summary);
    return summary;
  }

  /**
   * Update the AI's context mid-session.
   */
  updateContext(context: string): void {
    const instruction = `${this.config.voiceConfig?.systemInstruction || ''}\n\n## Current Context\n${context}`;
    this.geminiClient.updateSystemInstruction(instruction);
  }

  /**
   * Set up handlers for Gemini events.
   */
  private setupGeminiHandlers(): void {
    // Audio output from AI
    this.geminiClient.on('audio', async (audioData) => {
      this.stats.aiResponses++;

      // Inject audio back into meeting if callback provided
      if (this.config.onAudioOutput) {
        try {
          await this.config.onAudioOutput(audioData);
        } catch (error) {
          logger.error('Failed to inject audio', { error: (error as Error).message });
        }
      }
    });

    // Transcript of AI speech
    this.geminiClient.on('transcript', (text) => {
      this.transcript.push(text);
      this.emit('aiSpoke', text, Buffer.alloc(0));
    });

    // Tool calls
    this.geminiClient.on('toolCall', (name, args) => {
      this.stats.toolCalls++;
      this.handleToolCall(name, args);
    });

    // Interruptions
    this.geminiClient.on('interrupted', () => {
      this.stats.interruptions++;
      logger.debug('AI was interrupted', { sessionId: this.sessionId });
    });

    // Errors
    this.geminiClient.on('error', (error) => {
      logger.error('Gemini error', {
        sessionId: this.sessionId,
        error: error.message,
      });
      this.emit('error', error);
    });

    // Disconnection
    this.geminiClient.on('disconnected', (reason) => {
      if (this.isActive) {
        logger.warn('Unexpected disconnection', {
          sessionId: this.sessionId,
          reason,
        });
      }
    });
  }

  /**
   * Handle tool calls from Gemini.
   */
  private handleToolCall(name: string, args: Record<string, unknown>): void {
    logger.info('Processing tool call', { name, args });

    switch (name) {
      case 'flag_ambiguity':
        this.handleFlagAmbiguity(args);
        break;

      case 'update_prd':
        this.handleUpdatePRD(args);
        break;

      case 'create_action_item':
        this.handleCreateActionItem(args);
        break;

      default:
        logger.warn('Unknown tool call', { name });
    }
  }

  /**
   * Handle flag_ambiguity tool call.
   */
  private handleFlagAmbiguity(args: Record<string, unknown>): void {
    const ambiguity: FlaggedAmbiguity = {
      id: `ambiguity_${Date.now()}`,
      requirement: args.requirement as string,
      question: args.question as string,
      priority: args.priority as 'high' | 'medium' | 'low',
      timestamp: new Date(),
    };

    this.ambiguities.push(ambiguity);
    this.emit('ambiguityFlagged', ambiguity);

    logger.info('Ambiguity flagged', { ambiguity });
  }

  /**
   * Handle update_prd tool call.
   */
  private handleUpdatePRD(args: Record<string, unknown>): void {
    const requirement: CapturedRequirement = {
      id: `req_${Date.now()}`,
      content: args.content as string,
      section: args.section as CapturedRequirement['section'],
      timestamp: new Date(),
      confidence: 0.8,
    };

    this.requirements.push(requirement);
    this.emit('requirementCaptured', requirement);

    logger.info('Requirement captured', { requirement });
  }

  /**
   * Handle create_action_item tool call.
   */
  private handleCreateActionItem(args: Record<string, unknown>): void {
    const item: ActionItem = {
      id: `action_${Date.now()}`,
      title: args.title as string,
      description: args.description as string | undefined,
      assignee: args.assignee as string | undefined,
      dueDate: args.dueDate ? new Date(args.dueDate as string) : undefined,
      timestamp: new Date(),
    };

    this.actionItems.push(item);
    this.emit('actionItemCreated', item);

    logger.info('Action item created', { item });
  }

  /**
   * Get system prompt for passive mode (listen only, no questions).
   */
  private getPassiveSystemPrompt(): string {
    return `You are a meeting assistant for Workforce0, an AI workforce platform.

## Your Role (PASSIVE MODE)
- Listen carefully to meeting discussions about software requirements
- DO NOT ask questions or interrupt the meeting
- Silently capture requirements, action items, and note ambiguities
- Use tools to record information without speaking

## What to Capture
- Project objectives and goals
- Feature requirements
- Acceptance criteria mentioned
- Out of scope items
- Assumptions being made
- Action items and follow-ups
- Ambiguous requirements (flag silently for later)

## Tools Available
You have access to tools to silently:
- Flag ambiguous requirements for later clarification
- Update the PRD with new information
- Create action items for follow-ups`;
  }
}

/**
 * Type declaration for EventEmitter with our events.
 */
export interface MeetingVoiceSession {
  on<K extends keyof MeetingSessionEvents>(event: K, listener: MeetingSessionEvents[K]): this;
  emit<K extends keyof MeetingSessionEvents>(event: K, ...args: Parameters<MeetingSessionEvents[K]>): boolean;
}
