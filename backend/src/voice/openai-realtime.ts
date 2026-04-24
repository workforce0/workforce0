/**
 * =============================================================================
 * OPENAI REALTIME API CLIENT
 * =============================================================================
 *
 * WebSocket client for OpenAI's Realtime API.
 * Handles real-time bidirectional audio streaming for voice conversations.
 *
 * Key Advantage: Native G.711 μ-law support!
 * - No audio format conversion needed
 * - Direct Twilio ↔ OpenAI audio streaming
 * - Better audio quality and lower latency
 *
 * Audio Flow:
 * -----------
 * Twilio (μ-law 8kHz) → WebSocket → OpenAI → WebSocket → Twilio (μ-law 8kHz)
 *                          ↓
 *                    Tool Calls (Jira, PRD, etc.)
 *
 * @module voice/openai-realtime
 * @see https://platform.openai.com/docs/guides/realtime
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createChildLogger } from '../lib/logger.js';
import { AppError } from '../lib/error-handler.js';

const logger = createChildLogger({ module: 'OpenAIRealtime' });

/**
 * OpenAI Realtime API WebSocket endpoint.
 */
const OPENAI_REALTIME_ENDPOINT = 'wss://api.openai.com/v1/realtime';

/**
 * Default model for realtime audio.
 * Use the preview model for OpenAI Realtime API.
 */
const DEFAULT_MODEL = 'gpt-4o-realtime-preview-2024-12-17';

/**
 * Events emitted by the OpenAI Realtime client.
 */
export interface OpenAIRealtimeEvents {
  /** Connected to OpenAI Realtime API */
  connected: () => void;
  /** Disconnected from API */
  disconnected: (reason: string) => void;
  /** Audio response received (base64 encoded) */
  audio: (data: Buffer) => void;
  /** Text transcript of what the model said */
  transcript: (text: string) => void;
  /** User's speech transcribed */
  userTranscript: (text: string) => void;
  /** Tool/function call received */
  toolCall: (callId: string, name: string, args: Record<string, unknown>) => void;
  /** Error occurred */
  error: (error: Error) => void;
  /** Model started speaking */
  speakingStarted: () => void;
  /** Model finished speaking */
  speakingStopped: () => void;
  /** User interrupted the model */
  interrupted: () => void;
  /** Response completed */
  responseComplete: () => void;
}

/**
 * OpenAI Realtime session configuration.
 */
export interface OpenAIRealtimeConfig {
  /** Model to use */
  model: string;
  /** Voice for audio output */
  voice: 'alloy' | 'echo' | 'shimmer' | 'ash' | 'ballad' | 'coral' | 'sage' | 'verse';
  /** System instruction */
  instructions: string;
  /** Input audio format */
  inputAudioFormat: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
  /** Output audio format */
  outputAudioFormat: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
  /** Input audio transcription config */
  inputAudioTranscription?: {
    model: 'whisper-1';
  };
  /** Turn detection config */
  turnDetection?: {
    type: 'server_vad';
    threshold?: number;
    prefix_padding_ms?: number;
    silence_duration_ms?: number;
  };
  /** Tools/functions available */
  tools?: OpenAITool[];
  /** Temperature for responses */
  temperature?: number;
  /** Max response tokens */
  maxResponseOutputTokens?: number | 'inf';
}

/**
 * OpenAI tool/function definition.
 */
export interface OpenAITool {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

/**
 * Session state for OpenAI Realtime connection.
 */
export enum SessionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  READY = 'ready',
  SPEAKING = 'speaking',
  LISTENING = 'listening',
  ERROR = 'error',
}

/**
 * Default configuration for meeting voice sessions.
 */
export const DEFAULT_OPENAI_REALTIME_CONFIG: OpenAIRealtimeConfig = {
  model: DEFAULT_MODEL,
  voice: 'alloy',
  instructions: `You are a meeting assistant for Workforce0, an AI workforce platform.

## Your Role
- Listen carefully to meeting discussions about software requirements
- Ask clarifying questions when requirements are ambiguous
- Keep responses brief (1-2 sentences maximum)
- Say "got it" or "noted" to acknowledge understanding
- If interrupted, immediately stop speaking and listen

## Conversation Style
- Be conversational and natural, not robotic
- Use phrases like "Quick question..." or "Just to clarify..."
- Avoid long explanations - keep it brief
- Match the energy and pace of the meeting

## When to Ask Questions
- Ambiguous requirements (who is the user? what's the priority?)
- Missing acceptance criteria
- Unclear scope boundaries
- Conflicting requirements

## When NOT to Interrupt
- While someone is actively explaining something
- During off-topic discussions
- When the answer will likely come naturally`,
  // Use G.711 μ-law for direct Twilio compatibility
  inputAudioFormat: 'g711_ulaw',
  outputAudioFormat: 'g711_ulaw',
  inputAudioTranscription: {
    model: 'whisper-1',
  },
  turnDetection: {
    type: 'server_vad',
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 200, // Reduced for lower latency
  },
  temperature: 0.8,
  maxResponseOutputTokens: 4096,
};

/**
 * Workforce0 Product Agent Tools for OpenAI Realtime.
 *
 * Based on PRD-Workforce0-Platform.md Section 7.3 (BA Agent).
 * These tools allow the voice bot to capture and track information from meetings.
 */
export const MEETING_TOOLS: OpenAITool[] = [
  // ============================================================================
  // CAPTURE TOOLS - Core meeting intelligence
  // ============================================================================
  {
    type: 'function',
    name: 'capture_requirement',
    description: 'Capture a requirement, feature, or user need. Use format: As a [user], I want [feature], so that [benefit].',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Brief title for the requirement',
        },
        userType: {
          type: 'string',
          description: 'Who is this for (persona)',
        },
        feature: {
          type: 'string',
          description: 'What they want to do',
        },
        benefit: {
          type: 'string',
          description: 'Why (the business value)',
        },
        acceptanceCriteria: {
          type: 'string',
          description: 'How we know it is done (Given/When/Then if possible)',
        },
        priority: {
          type: 'string',
          description: 'MoSCoW priority if mentioned',
          enum: ['must_have', 'should_have', 'could_have', 'wont_have', 'unknown'],
        },
      },
      required: ['title', 'feature'],
    },
  },
  {
    type: 'function',
    name: 'capture_decision',
    description: 'Record a decision made during the meeting. Important for tracking what was agreed.',
    parameters: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          description: 'The decision that was made',
        },
        context: {
          type: 'string',
          description: 'Why this decision was made',
        },
        decidedBy: {
          type: 'string',
          description: 'Who made or confirmed the decision',
        },
        alternatives: {
          type: 'string',
          description: 'Other options that were considered',
        },
      },
      required: ['decision'],
    },
  },
  {
    type: 'function',
    name: 'capture_action_item',
    description: 'Create an action item or follow-up task from the meeting.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What needs to be done',
        },
        owner: {
          type: 'string',
          description: 'Who is responsible',
        },
        deadline: {
          type: 'string',
          description: 'When it should be done',
        },
        priority: {
          type: 'string',
          description: 'Urgency level',
          enum: ['high', 'medium', 'low'],
        },
      },
      required: ['task'],
    },
  },
  {
    type: 'function',
    name: 'capture_open_question',
    description: 'Record a question that needs follow-up outside this meeting.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The open question',
        },
        context: {
          type: 'string',
          description: 'Why this matters',
        },
        routeTo: {
          type: 'string',
          description: 'Who should answer this',
          enum: ['technical_lead', 'product_lead', 'executive', 'domain_expert', 'unknown'],
        },
      },
      required: ['question'],
    },
  },
  // ============================================================================
  // CLARIFICATION TRIGGERS - Based on PRD Section 7.9
  // ============================================================================
  {
    type: 'function',
    name: 'flag_ambiguous_requirement',
    description: 'Flag when multiple valid interpretations exist. Triggers clarification.',
    parameters: {
      type: 'object',
      properties: {
        statement: {
          type: 'string',
          description: 'The ambiguous statement heard',
        },
        interpretations: {
          type: 'string',
          description: 'Possible interpretations (comma separated)',
        },
        clarifyingQuestion: {
          type: 'string',
          description: 'Question to ask for clarification',
        },
        importance: {
          type: 'string',
          description: 'How critical is this clarification',
          enum: ['critical', 'important', 'minor'],
        },
      },
      required: ['statement', 'clarifyingQuestion', 'importance'],
    },
  },
  {
    type: 'function',
    name: 'flag_missing_context',
    description: 'Flag when required information is missing (user type, acceptance criteria, etc).',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'What topic is missing context',
        },
        missingInfo: {
          type: 'string',
          description: 'What specific info is missing',
          enum: ['user_type', 'acceptance_criteria', 'priority', 'scope', 'timeline', 'owner', 'other'],
        },
        clarifyingQuestion: {
          type: 'string',
          description: 'Question to ask',
        },
      },
      required: ['topic', 'missingInfo', 'clarifyingQuestion'],
    },
  },
  {
    type: 'function',
    name: 'flag_conflict',
    description: 'Flag when new statement conflicts with earlier discussion or documentation.',
    parameters: {
      type: 'object',
      properties: {
        newStatement: {
          type: 'string',
          description: 'What was just said',
        },
        conflictsWith: {
          type: 'string',
          description: 'What it conflicts with',
        },
        clarifyingQuestion: {
          type: 'string',
          description: 'Question to resolve the conflict',
        },
      },
      required: ['newStatement', 'conflictsWith', 'clarifyingQuestion'],
    },
  },
  {
    type: 'function',
    name: 'flag_risk',
    description: 'Flag security, compliance, or high-risk decisions that need verification.',
    parameters: {
      type: 'object',
      properties: {
        risk: {
          type: 'string',
          description: 'The potential risk identified',
        },
        category: {
          type: 'string',
          description: 'Type of risk',
          enum: ['security', 'compliance', 'data_privacy', 'technical', 'business', 'legal'],
        },
        impact: {
          type: 'string',
          description: 'Potential impact',
        },
        clarifyingQuestion: {
          type: 'string',
          description: 'Question to verify risk handling',
        },
      },
      required: ['risk', 'category'],
    },
  },
  {
    type: 'function',
    name: 'flag_dependency',
    description: 'Track a dependency or blocker mentioned in the meeting.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'What has the dependency',
        },
        dependsOn: {
          type: 'string',
          description: 'What it depends on',
        },
        status: {
          type: 'string',
          description: 'Current status',
          enum: ['blocked', 'at_risk', 'in_progress', 'resolved', 'unknown'],
        },
        owner: {
          type: 'string',
          description: 'Who owns resolving this',
        },
      },
      required: ['item', 'dependsOn'],
    },
  },
  // ============================================================================
  // OUTPUT TOOLS - End of meeting
  // ============================================================================
  {
    type: 'function',
    name: 'set_output_preference',
    description: 'Record what output the team wants after the meeting.',
    parameters: {
      type: 'object',
      properties: {
        outputType: {
          type: 'string',
          description: 'Type of document to generate',
          enum: ['prd', 'brd', 'user_stories', 'jira_tickets', 'meeting_summary', 'technical_spec', 'custom'],
        },
        format: {
          type: 'string',
          description: 'Preferred format',
          enum: ['google_doc', 'notion', 'confluence', 'markdown', 'jira'],
        },
        reviewer: {
          type: 'string',
          description: 'Who should review the output',
        },
        additionalInstructions: {
          type: 'string',
          description: 'Any special instructions',
        },
      },
      required: ['outputType'],
    },
  },
  {
    type: 'function',
    name: 'meeting_recap',
    description: 'Provide a verbal summary of what was captured so far.',
    parameters: {
      type: 'object',
      properties: {
        requirementsCount: {
          type: 'number',
          description: 'Number of requirements captured',
        },
        decisionsCount: {
          type: 'number',
          description: 'Number of decisions captured',
        },
        actionItemsCount: {
          type: 'number',
          description: 'Number of action items',
        },
        openQuestionsCount: {
          type: 'number',
          description: 'Number of open questions',
        },
        keyHighlights: {
          type: 'string',
          description: 'Key highlights to mention',
        },
      },
      required: [],
    },
  },
];

/**
 * OpenAI Realtime API client for real-time voice conversations.
 *
 * @example
 * ```typescript
 * const client = new OpenAIRealtimeClient(apiKey);
 *
 * client.on('audio', (data) => sendToTwilio(data));
 * client.on('toolCall', (id, name, args) => handleTool(id, name, args));
 *
 * await client.connect();
 * client.sendAudio(audioChunk); // Already in G.711 format!
 * ```
 */
export class OpenAIRealtimeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private state: SessionState = SessionState.DISCONNECTED;
  private config: OpenAIRealtimeConfig;
  private apiKey: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private intentionalDisconnect = false;
  private pendingToolCalls: Map<string, { name: string; args: Record<string, unknown> }> = new Map();

  constructor(apiKey: string, config: Partial<OpenAIRealtimeConfig> = {}) {
    super();

    if (!apiKey) {
      throw new AppError('OpenAI API key is required', 500, 'CONFIG_ERROR');
    }

    this.apiKey = apiKey;
    this.config = { ...DEFAULT_OPENAI_REALTIME_CONFIG, ...config };

    logger.info('OpenAIRealtimeClient created', {
      model: this.config.model,
      voice: this.config.voice,
      inputFormat: this.config.inputAudioFormat,
      outputFormat: this.config.outputAudioFormat,
    });
  }

  /**
   * Get current session state.
   */
  getState(): SessionState {
    return this.state;
  }

  /**
   * Connect to OpenAI Realtime API and initialize session.
   */
  async connect(): Promise<void> {
    if (this.state !== SessionState.DISCONNECTED) {
      logger.warn('Already connected or connecting');
      return;
    }

    this.state = SessionState.CONNECTING;
    logger.info('Connecting to OpenAI Realtime API');

    return new Promise((resolve, reject) => {
      const url = `${OPENAI_REALTIME_ENDPOINT}?model=${this.config.model}`;

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      // Connection timeout
      const timeout = setTimeout(() => {
        reject(new AppError('Connection timeout', 504, 'CONNECTION_TIMEOUT'));
        this.ws?.close();
      }, 30000);

      this.ws.on('open', () => {
        logger.info('WebSocket connected, configuring session');
        clearTimeout(timeout);
        this.configureSession();
        this.state = SessionState.CONNECTED;
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleEvent(event, resolve);
        } catch (error) {
          logger.error('Failed to parse message', { error });
        }
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        logger.error('WebSocket error', { error: error.message });
        this.state = SessionState.ERROR;
        this.emit('error', error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        logger.info('WebSocket closed', { code, reason: reason.toString() });
        this.handleDisconnect(reason.toString());
      });
    });
  }

  /**
   * Configure the session with our settings.
   * Uses the NEW OpenAI Realtime GA format (2025) with nested audio config.
   */
  private configureSession(): void {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: this.config.instructions,
        voice: this.config.voice,
        input_audio_format: this.config.inputAudioFormat,
        output_audio_format: this.config.outputAudioFormat,
        input_audio_transcription: this.config.inputAudioTranscription || null,
        turn_detection: this.config.turnDetection || null,
        tools: (this.config.tools || []).map(tool => ({
          type: tool.type,
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
        tool_choice: 'auto',
        temperature: this.config.temperature ?? 0.8,
        max_response_output_tokens: this.config.maxResponseOutputTokens ?? 4096,
      },
    };

    this.ws?.send(JSON.stringify(sessionUpdate));
    logger.info('Session configuration sent', {
      voice: this.config.voice,
      inputFormat: this.config.inputAudioFormat,
      outputFormat: this.config.outputAudioFormat,
      toolCount: this.config.tools?.length ?? 0,
      hasInstructions: !!this.config.instructions,
    });
  }

  /**
   * Disconnect from OpenAI Realtime API.
   */
  disconnect(): void {
    logger.info('Disconnecting from OpenAI Realtime API');

    this.intentionalDisconnect = true;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    this.state = SessionState.DISCONNECTED;
    this.pendingToolCalls.clear();
  }

  /**
   * Send audio chunk to OpenAI for processing.
   * Audio should already be in the configured format (G.711 μ-law).
   *
   * @param audioData - Base64 encoded audio data
   */
  sendAudio(audioData: Buffer): void {
    // Allow sending in READY, LISTENING, CONNECTED, or SPEAKING states
    if (this.state === SessionState.DISCONNECTED || this.state === SessionState.ERROR) {
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const event = {
      type: 'input_audio_buffer.append',
      audio: audioData.toString('base64'),
    };

    this.ws.send(JSON.stringify(event));
  }

  /**
   * Commit the audio buffer to trigger a response.
   * Usually not needed with server_vad turn detection.
   */
  commitAudio(): void {
    const event = {
      type: 'input_audio_buffer.commit',
    };
    this.ws?.send(JSON.stringify(event));
  }

  /**
   * Clear the audio buffer (e.g., on interruption).
   */
  clearAudioBuffer(): void {
    const event = {
      type: 'input_audio_buffer.clear',
    };
    this.ws?.send(JSON.stringify(event));
  }

  /**
   * Cancel the current response (for interruption).
   */
  cancelResponse(): void {
    const event = {
      type: 'response.cancel',
    };
    this.ws?.send(JSON.stringify(event));
    this.emit('interrupted');
  }

  /**
   * Send a tool result back to OpenAI.
   */
  sendToolResult(callId: string, result: unknown): void {
    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result),
      },
    };

    this.ws?.send(JSON.stringify(event));
    this.pendingToolCalls.delete(callId);

    // Trigger response after tool result
    this.ws?.send(JSON.stringify({ type: 'response.create' }));
  }

  /**
   * Send a text message to the conversation.
   */
  sendText(text: string): void {
    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text,
          },
        ],
      },
    };

    this.ws?.send(JSON.stringify(event));

    // Trigger a response
    this.ws?.send(JSON.stringify({ type: 'response.create' }));
  }

  /**
   * Handle incoming event from OpenAI.
   */
  private handleEvent(event: any, onReady?: () => void): void {
    switch (event.type) {
      case 'session.created':
        logger.info('Session created', { sessionId: event.session?.id });
        break;

      case 'session.updated':
        logger.info('Session configured successfully');
        this.state = SessionState.READY;
        this.reconnectAttempts = 0;
        this.intentionalDisconnect = false;
        this.emit('connected');
        onReady?.();
        break;

      case 'input_audio_buffer.speech_started':
        logger.debug('User started speaking (VAD triggered)');
        // If the AI was speaking, this is a barge-in (user interruption)
        if (this.state === SessionState.SPEAKING) {
          logger.info('Barge-in detected - user interrupted AI speech');
          this.emit('interrupted');
        }
        this.state = SessionState.LISTENING;
        break;

      case 'input_audio_buffer.speech_stopped':
        logger.debug('User stopped speaking (VAD silence detected)');
        break;

      case 'input_audio_buffer.committed':
        logger.debug('Audio buffer committed, waiting for response');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) {
          logger.info('User transcription', { transcript: event.transcript });
          this.emit('userTranscript', event.transcript);
        }
        break;

      case 'response.created':
        logger.debug('AI response started');
        this.state = SessionState.SPEAKING;
        this.emit('speakingStarted');
        break;

      case 'response.audio.delta':
      case 'response.output_audio.delta':
        if (event.delta) {
          const audioBuffer = Buffer.from(event.delta, 'base64');
          this.emit('audio', audioBuffer);
        }
        break;

      case 'response.audio_transcript.delta':
        if (event.delta) {
          this.emit('transcript', event.delta);
        }
        break;

      case 'response.function_call_arguments.done':
        if (event.call_id && event.name && event.arguments) {
          try {
            const args = JSON.parse(event.arguments);
            logger.info('Tool call received', { tool: event.name, callId: event.call_id });
            this.pendingToolCalls.set(event.call_id, { name: event.name, args });
            this.emit('toolCall', event.call_id, event.name, args);
          } catch (e) {
            logger.error('Failed to parse tool call arguments', { error: e });
          }
        }
        break;

      case 'response.done':
        logger.debug('AI response completed');
        this.state = SessionState.READY;
        this.emit('speakingStopped');
        this.emit('responseComplete');
        break;

      case 'error':
        logger.error('OpenAI API error', { error: event.error });
        this.emit('error', new Error(event.error?.message || 'Unknown error'));
        break;

      default:
        if (event.type.startsWith('response.')) {
          logger.debug('Unhandled response event', { type: event.type });
        }
    }
  }

  /**
   * Handle WebSocket disconnect.
   */
  private handleDisconnect(reason: string): void {
    this.state = SessionState.DISCONNECTED;
    this.emit('disconnected', reason);

    // Do not reconnect if disconnect was intentional
    if (this.intentionalDisconnect) {
      this.intentionalDisconnect = false;
      return;
    }

    // Attempt reconnection for unexpected disconnects
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

      logger.info('Attempting reconnection', {
        attempt: this.reconnectAttempts,
        delay,
      });

      setTimeout(() => {
        this.connect().catch((error) => {
          logger.error('Reconnection failed', { error: error.message });
        });
      }, delay);
    }
  }
}

/**
 * Type declaration for EventEmitter with our events.
 */
export interface OpenAIRealtimeClient {
  on<K extends keyof OpenAIRealtimeEvents>(event: K, listener: OpenAIRealtimeEvents[K]): this;
  emit<K extends keyof OpenAIRealtimeEvents>(event: K, ...args: Parameters<OpenAIRealtimeEvents[K]>): boolean;
}
