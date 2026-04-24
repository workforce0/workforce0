/**
 * =============================================================================
 * TWILIO MEDIA STREAM HANDLER
 * =============================================================================
 *
 * Handles bidirectional audio streaming between Twilio and OpenAI Realtime API.
 *
 * Key Advantage: OpenAI Realtime supports G.711 μ-law natively!
 * - No audio format conversion needed
 * - Twilio sends μ-law → Handler → OpenAI (μ-law) → Handler → Twilio
 * - Better audio quality and lower latency
 *
 * @module services/voice/twilio-media-handler
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createChildLogger } from '../../lib/logger.js';
import { OpenAIRealtimeClient, DEFAULT_OPENAI_REALTIME_CONFIG, MEETING_TOOLS } from '../../voice/openai-realtime.js';

const logger = createChildLogger({ module: 'TwilioMediaHandler' });

/**
 * Maximum call duration in milliseconds (1 hour).
 * Prevents runaway sessions from consuming excessive OpenAI Realtime API credits.
 */
const MAX_CALL_DURATION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Warning time before max duration (5 minutes before end).
 */
const DURATION_WARNING_MS = MAX_CALL_DURATION_MS - (5 * 60 * 1000);

/**
 * Workforce0 Product Agent Instructions
 *
 * Based on PRD-Workforce0-Platform.md specifications.
 * Implements chat-first clarification protocol and smart question routing.
 */
const BA_AGENT_INSTRUCTIONS = `You are the Workforce0 AI Assistant joining this product meeting via phone dial-in.

## YOUR MISSION
Transform this meeting into actionable outputs. You help product teams:
- Capture requirements, decisions, and action items
- Ask clarifying questions when ambiguity could cause downstream issues
- Enable the team to generate PRDs, user stories, Jira tickets, or summaries after the call

## INTRODUCTION (Say this when you first hear people talking)
"Hi everyone, I'm the Workforce0 assistant. I'll be taking notes and may ask clarifying questions if something needs more detail. Feel free to ask me anything."

## WHAT TRIGGERS A CLARIFYING QUESTION
Only speak when you detect:

1. **Ambiguous Requirements** - Multiple valid interpretations
   - "It should be fast" → "Quick clarification - what response time are you targeting? Under 1 second, or within a few seconds?"

2. **Missing User Context** - Who is this for?
   - "Add a button to export" → "Which users should see this export button - all users or just admins?"

3. **Conflicting Information** - Contradicts earlier statement
   - "Earlier you mentioned PostgreSQL, but now Qdrant. Should I note this as a change in direction?"

4. **Missing Acceptance Criteria** - How do we know it's done?
   - "The search should work well" → "How will we know the search is working well? Any specific metrics?"

5. **Scope Ambiguity** - MVP vs future phase
   - "We could also add notifications" → "Is notifications for the MVP or a future phase?"

6. **High-Risk Decisions** - Security, data, compliance
   - "We'll store the credit cards" → "Just to confirm - are we PCI compliant, or should we use a payment processor like Stripe?"

## HOW TO ASK (Chat-First Protocol)
- Wait for a natural pause (at least 3-5 seconds of silence)
- Keep questions to 1-2 sentences MAX - you're on a phone line
- Start with context: "Quick clarification about the login flow..."
- Offer options when possible: "Should it be A or B?"
- If interrupted, immediately stop and listen

## WHEN TO STAY SILENT
- While someone is actively explaining (never interrupt flow state)
- During casual conversation or small talk
- Off-topic discussions (budgets, HR, politics)
- When the requirement is already clear and complete
- When you've already asked 3+ questions in the last 10 minutes (avoid "20 questions" fatigue)

## QUESTION PRIORITIZATION
1. **Critical Blockers** - Ask immediately at next pause
2. **Clarifications** - Queue and ask at natural pauses
3. **Nice-to-know** - Save for end of meeting or async follow-up

## SMART ROUTING (Know your audience)
- Technical questions (architecture, implementation) → Ask the tech lead
- Business questions (features, priorities, users) → Ask the PM or product owner
- Strategic questions (budget, timeline, direction) → Note for executive follow-up
- Don't ask the CEO implementation details; don't ask developers about business strategy

## WHAT YOU CAPTURE (Use tools for these)
- **Requirements**: Features, user needs, acceptance criteria
- **Decisions**: What was agreed upon and by whom
- **Action Items**: Tasks assigned with owners
- **Open Questions**: Things still unresolved
- **Risks**: Technical, business, or compliance concerns
- **Dependencies**: What blocks what

## ACKNOWLEDGMENTS
When something is clear, briefly confirm:
- "Got it" / "Noted" / "Makes sense"
- "Understood - users can export to CSV and Excel"

## AT MEETING END
When you sense the meeting wrapping up:
"Before we wrap up - I captured [X] requirements, [Y] decisions, and [Z] action items. After this call, would you like me to generate a PRD, user stories, Jira tickets, or just a meeting summary? You can let me know via the app or I can send options to your chat."

## VOICE STYLE
- Professional but warm - like a helpful colleague
- Clear and not too fast - phone audio quality varies
- Concise - respect everyone's time
- Never robotic or overly formal

## CRITICAL RULES
1. NEVER interrupt someone mid-sentence
2. NEVER assume - when unsure, ask
3. NEVER ask more than 5 questions per meeting (batch the rest)
4. NEVER discuss sensitive info (salaries, legal issues, personnel)
5. ALWAYS wait for 3+ seconds of silence before speaking
6. ALWAYS offer options rather than open-ended questions when possible

Remember: One great clarifying question is worth more than five mediocre ones. Your goal is CLARITY, not coverage.

## ADVANCED QUESTION STRATEGY (Rotate Through These Types)
Use a variety of question types to keep the conversation productive:
- **Clarifying**: "When you say X, do you mean A or B?"
- **Probing**: "Can you tell me more about how users currently handle this?"
- **Boundary**: "What happens if a user tries to do X?"
- **Priority**: "If you had to choose between A and B, which is more important?"
- **Metric**: "How would you measure success for this feature?"

Rotate through these types rather than asking the same kind repeatedly. Start with Clarifying, then Probing, then Boundary, then Priority, then Metric. After cycling through, start again.

## OFF-TOPIC HANDLING TIERS

**Brief tangent (< 30 seconds):**
- Let it play out naturally
- Look for hidden context (past failures, competitor info, stakeholder concerns)
- Gently redirect: "That's interesting context. Coming back to the feature..."

**Extended tangent (> 1 minute):**
- Politely redirect: "I want to make sure I capture everything. Can we come back to [last topic]?"
- Or: "That's helpful background. For the requirements, what does this mean for [feature]?"

**Completely unrelated (weather, sports, etc.):**
- Brief acknowledgment, then redirect: "Ha! Anyway, you were saying about the user authentication..."
- Don't be rude, but don't engage deeply

**Useful tangent (past failures, competitors, concerns):**
- Capture the relevant context
- "That's great input - I'm noting that as a potential risk. Now, for the core functionality..."

**Meeting logistics ("can you hear me?", "let me share my screen"):**
- Respond helpfully but briefly
- Don't add to requirements capture

## PERIODIC SUMMARIZATION
Every 10-15 minutes, or after capturing 3+ requirements, proactively summarize:
"So far I've captured X, Y, Z. Is that right?"
This keeps stakeholders aligned and catches misunderstandings early.`;

/**
 * Twilio Media Stream message types.
 */
interface TwilioMediaMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    customParameters?: Record<string, string>;
    mediaFormat?: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string; // Base64 encoded audio
  };
  mark?: {
    name: string;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
}

/**
 * Events emitted by the media handler.
 */
export interface TwilioMediaHandlerEvents {
  /** Stream started */
  streamStarted: (streamSid: string, callSid: string) => void;
  /** Stream ended */
  streamEnded: (streamSid: string) => void;
  /** Audio received from meeting */
  audioReceived: (bytes: number) => void;
  /** Audio sent to meeting */
  audioSent: (bytes: number) => void;
  /** AI response text */
  aiResponse: (text: string) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * Handler statistics.
 */
export interface HandlerStats {
  meetingId: string;
  streamSid: string | null;
  callSid: string | null;
  inboundAudioBytes: number;
  outboundAudioBytes: number;
  inboundChunks: number;
  outboundChunks: number;
  aiResponses: number;
  startedAt: Date;
}

/**
 * Handles a single Twilio Media Stream WebSocket connection.
 *
 * Bridges audio between Twilio (meeting) and OpenAI Realtime (AI).
 *
 * Key advantage: No audio conversion needed!
 * Both Twilio and OpenAI use G.711 μ-law format directly.
 *
 * @example
 * ```typescript
 * const handler = new TwilioMediaHandler('meeting-123', openaiApiKey);
 *
 * // When WebSocket connects
 * handler.attachWebSocket(twilioWs);
 *
 * // Handler automatically:
 * // - Receives μ-law audio from Twilio
 * // - Sends directly to OpenAI (no conversion!)
 * // - Receives μ-law audio from OpenAI
 * // - Sends directly to Twilio (no conversion!)
 * ```
 */
export class TwilioMediaHandler extends EventEmitter {
  private readonly meetingId: string;
  private readonly openaiApiKey: string;
  private twilioWs: WebSocket | null = null;
  private openaiClient: OpenAIRealtimeClient | null = null;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private stats: HandlerStats;
  private audioBuffer: Buffer[] = [];
  private isConnected = false;
  private durationWarningTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private capturedData: {
    requirements: Array<{ name: string; args: Record<string, unknown>; timestamp: string }>;
    decisions: Array<{ name: string; args: Record<string, unknown>; timestamp: string }>;
    actionItems: Array<{ name: string; args: Record<string, unknown>; timestamp: string }>;
    flags: Array<{ name: string; args: Record<string, unknown>; timestamp: string }>;
  } = { requirements: [], decisions: [], actionItems: [], flags: [] };

  constructor(meetingId: string, openaiApiKey: string) {
    super();
    this.meetingId = meetingId;
    this.openaiApiKey = openaiApiKey;
    this.stats = {
      meetingId,
      streamSid: null,
      callSid: null,
      inboundAudioBytes: 0,
      outboundAudioBytes: 0,
      inboundChunks: 0,
      outboundChunks: 0,
      aiResponses: 0,
      startedAt: new Date(),
    };

    logger.info('TwilioMediaHandler created', { meetingId });
  }

  /**
   * Attach the Twilio WebSocket and start handling messages.
   */
  attachWebSocket(ws: WebSocket): void {
    if (this.twilioWs) {
      logger.warn('WebSocket already attached', { meetingId: this.meetingId });
      return;
    }

    this.twilioWs = ws;
    this.setupTwilioWebSocket();
    this.setupOpenAIClient();
  }

  /**
   * Set up Twilio WebSocket event handlers.
   */
  private setupTwilioWebSocket(): void {
    if (!this.twilioWs) return;

    this.twilioWs.on('message', (data) => {
      try {
        const message: TwilioMediaMessage = JSON.parse(data.toString());
        this.handleTwilioMessage(message);
      } catch (error) {
        logger.error('Failed to parse Twilio message', { error: (error as Error).message });
      }
    });

    this.twilioWs.on('close', (code, reason) => {
      logger.info('Twilio WebSocket closed', {
        meetingId: this.meetingId,
        code,
        reason: reason.toString(),
      });
      this.cleanup();
    });

    this.twilioWs.on('error', (error) => {
      logger.error('Twilio WebSocket error', {
        meetingId: this.meetingId,
        error: error.message,
      });
      this.emit('error', error);
    });
  }

  /**
   * Set up OpenAI Realtime client.
   */
  private setupOpenAIClient(): void {
    this.openaiClient = new OpenAIRealtimeClient(this.openaiApiKey, {
      ...DEFAULT_OPENAI_REALTIME_CONFIG,
      // Use G.711 μ-law for direct Twilio compatibility - NO CONVERSION NEEDED!
      inputAudioFormat: 'g711_ulaw',
      outputAudioFormat: 'g711_ulaw',
      // BA Agent system prompt - optimized for requirements gathering
      instructions: BA_AGENT_INSTRUCTIONS,
      tools: MEETING_TOOLS,
      turnDetection: {
        type: 'server_vad',
        threshold: 0.6, // Higher threshold for better noise rejection in meeting environments
        prefix_padding_ms: 300,
        silence_duration_ms: 700, // 700ms - better for multi-party meetings where speakers pause between thoughts
      },
    });

    logger.info('Starting OpenAI connection', { meetingId: this.meetingId });

    // Handle barge-in: when user starts speaking, clear Twilio's outbound audio buffer
    // to stop the AI's voice immediately and avoid audio collision
    this.openaiClient.on('interrupted', () => {
      logger.info('Barge-in detected - clearing Twilio audio buffer', { meetingId: this.meetingId });
      this.clearTwilioAudioBuffer();
    });

    // Handle OpenAI events
    this.openaiClient.on('connected', () => {
      logger.info('OpenAI Realtime connected', { meetingId: this.meetingId });
      this.isConnected = true;

      // Flush any buffered audio that arrived before OpenAI connected
      if (this.audioBuffer.length > 0) {
        logger.info('Flushing buffered audio chunks to OpenAI', { count: this.audioBuffer.length, meetingId: this.meetingId });
        for (const chunk of this.audioBuffer) {
          this.openaiClient!.sendAudio(chunk);
        }
        this.audioBuffer = [];
      }

      // Start call duration timers
      this.startDurationTimers();
    });

    this.openaiClient.on('audio', (audioData) => {
      logger.debug('Received audio from OpenAI', { bytes: audioData.length, meetingId: this.meetingId });
      this.handleOpenAIAudio(audioData);
    });

    this.openaiClient.on('transcript', (text) => {
      logger.debug('OpenAI transcript', { meetingId: this.meetingId, text });
    });

    this.openaiClient.on('userTranscript', (text) => {
      logger.info('User said', { meetingId: this.meetingId, text });
    });

    this.openaiClient.on('responseComplete', () => {
      this.stats.aiResponses++;
      logger.debug('AI response complete', { meetingId: this.meetingId });
    });

    this.openaiClient.on('toolCall', (callId, name, args) => {
      logger.info('OpenAI tool call', {
        meetingId: this.meetingId,
        callId,
        tool: name,
        args,
      });
      this.handleToolCall(callId, name, args);
    });

    this.openaiClient.on('error', (error) => {
      logger.error('OpenAI error in media handler', { meetingId: this.meetingId, error: error.message });
      logger.error('OpenAI error', { meetingId: this.meetingId, error: error.message });
      this.emit('error', error);
    });

    this.openaiClient.on('disconnected', (reason) => {
      logger.info('OpenAI disconnected', { meetingId: this.meetingId, reason });
      this.isConnected = false;
    });

    // Connect to OpenAI
    this.openaiClient.connect().catch((error) => {
      logger.error('Failed to connect to OpenAI', {
        meetingId: this.meetingId,
        error: (error as Error).message,
      });
      this.emit('error', error as Error);
    });

    // Keep-alive removed - Twilio handles stream maintenance
    // Sending silence every 20ms was causing audio interference
  }

  /**
   * Handle incoming Twilio Media Stream message.
   */
  private handleTwilioMessage(message: TwilioMediaMessage): void {
    switch (message.event) {
      case 'connected':
        logger.debug('Twilio stream connected', { meetingId: this.meetingId });
        break;

      case 'start':
        if (message.start) {
          this.streamSid = message.start.streamSid;
          this.callSid = message.start.callSid;
          this.stats.streamSid = this.streamSid;
          this.stats.callSid = this.callSid;

          logger.info('Twilio stream started', {
            meetingId: this.meetingId,
            streamSid: this.streamSid,
            callSid: this.callSid,
            mediaFormat: message.start.mediaFormat,
          });

          this.emit('streamStarted', this.streamSid, this.callSid);
        }
        break;

      case 'media':
        // Only process inbound audio (from the meeting), not outbound (our responses)
        if (message.media?.payload && message.media.track === 'inbound') {
          this.handleInboundAudio(message.media.payload);
        }
        break;

      case 'mark':
        logger.debug('Twilio mark received', {
          meetingId: this.meetingId,
          name: message.mark?.name,
        });
        break;

      case 'stop':
        logger.info('Twilio stream stopped', {
          meetingId: this.meetingId,
          streamSid: this.streamSid,
        });
        if (this.streamSid) {
          this.emit('streamEnded', this.streamSid);
        }
        this.cleanup();
        break;
    }
  }

  /**
   * Handle inbound audio from Twilio (meeting).
   *
   * SIMPLIFIED: No conversion needed!
   * Twilio sends G.711 μ-law, OpenAI accepts G.711 μ-law directly.
   */
  private handleInboundAudio(base64Payload: string): void {
    const audioBuffer = Buffer.from(base64Payload, 'base64');
    this.stats.inboundAudioBytes += audioBuffer.length;
    this.stats.inboundChunks++;

    // Log every 50 chunks (~1 second of audio)
    if (this.stats.inboundChunks % 50 === 0) {
      logger.debug('Audio chunk progress', { chunks: this.stats.inboundChunks, connected: this.isConnected, meetingId: this.meetingId });
    }

    this.emit('audioReceived', audioBuffer.length);

    // Send directly to OpenAI - no conversion needed!
    if (this.openaiClient && this.isConnected) {
      this.openaiClient.sendAudio(audioBuffer);
    } else {
      // Buffer audio until OpenAI connects
      this.audioBuffer.push(audioBuffer);
      if (this.audioBuffer.length > 100) {
        this.audioBuffer.shift(); // Prevent memory buildup
      }
    }
  }

  /**
   * Handle audio from OpenAI (AI response).
   *
   * SIMPLIFIED: No conversion needed!
   * OpenAI sends G.711 μ-law, Twilio accepts G.711 μ-law directly.
   */
  private handleOpenAIAudio(audioBuffer: Buffer): void {
    if (!this.twilioWs || this.twilioWs.readyState !== WebSocket.OPEN) {
      logger.debug('Cannot send audio - Twilio WebSocket not open', { meetingId: this.meetingId });
      return;
    }

    if (!this.streamSid) {
      logger.debug('Cannot send audio - no streamSid yet', { meetingId: this.meetingId });
      return;
    }

    // Send directly to Twilio - no conversion needed!
    const base64Payload = audioBuffer.toString('base64');

    const mediaMessage = {
      event: 'media',
      streamSid: this.streamSid,
      media: {
        payload: base64Payload,
      },
    };

    this.twilioWs.send(JSON.stringify(mediaMessage));
    this.stats.outboundAudioBytes += audioBuffer.length;
    this.stats.outboundChunks++;

    // Log every 10 chunks sent
    if (this.stats.outboundChunks % 10 === 0) {
      logger.debug('Outbound audio progress', { chunks: this.stats.outboundChunks, meetingId: this.meetingId });
    }

    this.emit('audioSent', audioBuffer.length);
  }

  /**
   * Handle tool calls from OpenAI.
   */
  private handleToolCall(callId: string, name: string, args: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();

    logger.info('Tool call received', {
      meetingId: this.meetingId,
      callId,
      tool: name,
      args,
    });

    const entry = { name, args, timestamp };

    // Categorize and store the captured data
    switch (name) {
      case 'capture_requirement':
        this.capturedData.requirements.push(entry);
        this.emit('aiResponse', `Captured requirement: ${args.title || args.feature || 'untitled'}`);
        break;

      case 'capture_decision':
        this.capturedData.decisions.push(entry);
        this.emit('aiResponse', `Captured decision: ${args.decision || 'recorded'}`);
        break;

      case 'capture_action_item':
        this.capturedData.actionItems.push(entry);
        this.emit('aiResponse', `Action item: ${args.task || args.title || 'recorded'}`);
        break;

      case 'capture_open_question':
        this.capturedData.flags.push(entry);
        break;

      case 'flag_ambiguous_requirement':
      case 'flag_missing_context':
      case 'flag_conflict':
      case 'flag_risk':
      case 'flag_dependency':
        this.capturedData.flags.push(entry);
        break;

      case 'set_output_preference':
      case 'meeting_recap':
        // Informational tool calls - just acknowledge
        break;

      default:
        logger.warn('Unknown tool call', { meetingId: this.meetingId, tool: name });
        break;
    }

    // Send result back to OpenAI so it can continue the conversation
    if (this.openaiClient) {
      this.openaiClient.sendToolResult(callId, {
        success: true,
        message: `${name} recorded successfully`,
      });
    }
  }

  /**
   * Send text to OpenAI (for context/transcript).
   */
  sendTranscript(speaker: string, text: string): void {
    if (this.openaiClient && this.isConnected) {
      this.openaiClient.sendText(`[${speaker}]: ${text}`);
    }
  }

  /**
   * Get handler statistics.
   */
  getStats(): HandlerStats {
    return { ...this.stats };
  }

  /**
   * Get all data captured by tool calls during this session.
   */
  getCapturedData(): typeof this.capturedData {
    return {
      requirements: [...this.capturedData.requirements],
      decisions: [...this.capturedData.decisions],
      actionItems: [...this.capturedData.actionItems],
      flags: [...this.capturedData.flags],
    };
  }

  /**
   * Check if handler is connected.
   */
  isActive(): boolean {
    return this.twilioWs?.readyState === WebSocket.OPEN && this.isConnected;
  }

  /**
   * Clean up resources.
   */
  cleanup(): void {
    if (!this.isConnected && !this.openaiClient && !this.twilioWs) {
      return; // Already cleaned up
    }

    logger.info('Cleaning up TwilioMediaHandler', { meetingId: this.meetingId });

    // Clear duration timers
    if (this.durationWarningTimer) {
      clearTimeout(this.durationWarningTimer);
      this.durationWarningTimer = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }

    if (this.openaiClient) {
      this.openaiClient.removeAllListeners();
      this.openaiClient.disconnect();
      this.openaiClient = null;
    }

    if (this.twilioWs) {
      this.twilioWs.removeAllListeners();
      if (this.twilioWs.readyState === WebSocket.OPEN) {
        this.twilioWs.close();
      }
      this.twilioWs = null;
    }

    this.audioBuffer = [];
    this.isConnected = false;
    this.removeAllListeners();
  }

  /**
   * Send a mark message to Twilio (for synchronization).
   */
  sendMark(name: string): void {
    if (!this.twilioWs || this.twilioWs.readyState !== WebSocket.OPEN) return;

    const markMessage = {
      event: 'mark',
      streamSid: this.streamSid,
      mark: { name },
    };

    this.twilioWs.send(JSON.stringify(markMessage));
  }

  /**
   * Start call duration timers for maximum session length enforcement.
   *
   * Sets up two timers:
   * 1. A 5-minute warning before max duration, where the AI notifies participants
   * 2. A hard cutoff at max duration that triggers cleanup
   */
  private startDurationTimers(): void {
    // 5-minute warning timer
    this.durationWarningTimer = setTimeout(() => {
      logger.warn('Call approaching max duration - 5 minute warning', { meetingId: this.meetingId });
      if (this.openaiClient && this.isConnected) {
        this.openaiClient.sendText(
          'Quick heads up - we have about 5 minutes left in this session. Let me know if there are any final items to capture.'
        );
      }
    }, DURATION_WARNING_MS);

    // Hard cutoff timer
    this.maxDurationTimer = setTimeout(() => {
      logger.warn('Call reached max duration - initiating cleanup', { meetingId: this.meetingId });
      if (this.openaiClient && this.isConnected) {
        this.openaiClient.sendText(
          "I've been on this call for the maximum duration. I'll process everything I've captured so far. Thank you!"
        );
        // Give the AI a moment to speak the farewell before disconnecting
        setTimeout(() => {
          this.cleanup();
        }, 5000);
      } else {
        this.cleanup();
      }
    }, MAX_CALL_DURATION_MS);

    logger.info('Duration timers started', {
      meetingId: this.meetingId,
      warningAtMs: DURATION_WARNING_MS,
      maxDurationMs: MAX_CALL_DURATION_MS,
    });
  }

  /**
   * Clear Twilio's outbound audio buffer.
   *
   * Used for barge-in handling: when the user starts speaking while the AI
   * is still outputting audio, this flushes the queued audio on Twilio's side
   * so the old AI speech stops immediately and doesn't collide with the new response.
   */
  private clearTwilioAudioBuffer(): void {
    if (!this.twilioWs || this.twilioWs.readyState !== WebSocket.OPEN) {
      logger.debug('Cannot clear Twilio buffer - WebSocket not open', { meetingId: this.meetingId });
      return;
    }

    if (!this.streamSid) {
      logger.debug('Cannot clear Twilio buffer - no streamSid yet', { meetingId: this.meetingId });
      return;
    }

    const clearMessage = {
      event: 'clear',
      streamSid: this.streamSid,
    };

    this.twilioWs.send(JSON.stringify(clearMessage));
    logger.info('Sent clear message to Twilio', { meetingId: this.meetingId, streamSid: this.streamSid });
  }
}

/**
 * Type declaration for EventEmitter with our events.
 */
export interface TwilioMediaHandler {
  on<K extends keyof TwilioMediaHandlerEvents>(event: K, listener: TwilioMediaHandlerEvents[K]): this;
  emit<K extends keyof TwilioMediaHandlerEvents>(event: K, ...args: Parameters<TwilioMediaHandlerEvents[K]>): boolean;
}
