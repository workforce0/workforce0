/**
 * =============================================================================
 * GEMINI LIVE API CLIENT
 * =============================================================================
 *
 * WebSocket client for Google's Gemini Live API.
 * Handles real-time bidirectional audio streaming for voice conversations.
 *
 * Architecture:
 * -------------
 * Audio In  -> WebSocket -> Gemini Live API -> WebSocket -> Audio Out
 *                              |
 *                     Tool Calls (Jira, PRD, etc.)
 *
 * The Gemini Live API provides:
 * - Native audio understanding (no separate STT)
 * - Native audio generation (no separate TTS)
 * - Built-in VAD and turn-taking
 * - Interruption handling (barge-in)
 * - Function calling for tools
 *
 * @module voice/gemini-live
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createChildLogger } from '../lib/logger.js';
import { AppError } from '../lib/error-handler.js';
import {
  GeminiLiveConfig,
  GeminiFunctionDeclaration,
  DEFAULT_GEMINI_LIVE_CONFIG,
} from './config.js';

const logger = createChildLogger({ module: 'GeminiLive' });

/**
 * Maximum audio buffer size in bytes (10 MB).
 * Prevents unbounded memory growth during long sessions.
 * A 1-hour meeting at 16kHz 16-bit mono generates ~172MB of audio;
 * we cap the debug buffer to keep only the most recent audio.
 */
const MAX_AUDIO_BUFFER_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Gemini Live API WebSocket endpoint.
 * Note: Using v1beta as v1alpha is deprecated.
 * @see https://ai.google.dev/api/live
 */
const GEMINI_LIVE_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/**
 * Events emitted by the Gemini Live client.
 */
export interface GeminiLiveEvents {
  /** Connected to Gemini Live API */
  connected: () => void;
  /** Disconnected from API */
  disconnected: (reason: string) => void;
  /** Audio response received */
  audio: (data: Buffer) => void;
  /** Text transcript of what the model said */
  transcript: (text: string) => void;
  /** Tool/function call received */
  toolCall: (name: string, args: Record<string, unknown>) => void;
  /** Error occurred */
  error: (error: Error) => void;
  /** Model started speaking */
  speakingStarted: () => void;
  /** Model finished speaking */
  speakingStopped: () => void;
  /** User interrupted the model */
  interrupted: () => void;
  /** Turn completed (either side) */
  turnComplete: () => void;
}

/**
 * Message types from Gemini Live API.
 */
interface GeminiServerMessage {
  setupComplete?: {
    sessionId: string;
  };
  serverContent?: {
    modelTurn?: {
      parts: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
        functionCall?: {
          name: string;
          args: Record<string, unknown>;
        };
      }>;
    };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  toolCallCancellation?: {
    ids: string[];
  };
}

/**
 * Session state for Gemini Live connection.
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
 * Gemini Live API client for real-time voice conversations.
 *
 * @example
 * ```typescript
 * const client = new GeminiLiveClient(apiKey);
 *
 * client.on('audio', (data) => playAudio(data));
 * client.on('toolCall', (name, args) => handleTool(name, args));
 *
 * await client.connect();
 * client.sendAudio(audioChunk);
 * ```
 */
export class GeminiLiveClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private state: SessionState = SessionState.DISCONNECTED;
  private config: GeminiLiveConfig;
  private apiKey: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private audioBuffer: Buffer[] = [];
  private audioBufferSize = 0; // Track total buffer size in bytes
  private pendingToolCalls: Map<string, { name: string; args: Record<string, unknown> }> = new Map();

  constructor(apiKey: string, config: Partial<GeminiLiveConfig> = {}) {
    super();

    if (!apiKey) {
      throw new AppError('Gemini API key is required', 500, 'CONFIG_ERROR');
    }

    this.apiKey = apiKey;
    this.config = { ...DEFAULT_GEMINI_LIVE_CONFIG, ...config };

    logger.info('GeminiLiveClient created', {
      model: this.config.model,
      voice: this.config.voice,
    });
  }

  /**
   * Get current session state.
   */
  getState(): SessionState {
    return this.state;
  }

  /**
   * Get session ID (available after setup complete).
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Connect to Gemini Live API and initialize session.
   */
  async connect(): Promise<void> {
    if (this.state !== SessionState.DISCONNECTED) {
      logger.warn('Already connected or connecting');
      return;
    }

    this.state = SessionState.CONNECTING;
    logger.info('Connecting to Gemini Live API');

    return new Promise((resolve, reject) => {
      // SECURITY: The Gemini Live API requires the API key as a query parameter.
      // This URL MUST NEVER be logged, as it contains the plaintext API key.
      // Any error messages from the WebSocket layer are sanitized below to prevent leakage.
      const url = `${GEMINI_LIVE_ENDPOINT}?key=${this.apiKey}`;

      this.ws = new WebSocket(url);

      // Connection timeout
      const timeout = setTimeout(() => {
        reject(new AppError('Connection timeout', 504, 'CONNECTION_TIMEOUT'));
        this.ws?.close();
      }, 30000);

      this.ws.on('open', () => {
        logger.info('WebSocket connected, sending setup');
        this.sendSetup();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as GeminiServerMessage;
          this.handleMessage(message, () => {
            clearTimeout(timeout);
            resolve();
          });
        } catch (error) {
          logger.error('Failed to parse message', { error });
        }
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        // SECURITY: Redact API key from error messages to prevent log leakage.
        const safeMessage = error.message?.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
        logger.error('WebSocket error', { error: safeMessage });
        this.state = SessionState.ERROR;
        this.emit('error', error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        // SECURITY: Redact API key from close reason to prevent log leakage.
        const safeReason = reason.toString().replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
        logger.info('WebSocket closed', { code, reason: safeReason });
        this.handleDisconnect(safeReason);
      });
    });
  }

  /**
   * Disconnect from Gemini Live API.
   */
  disconnect(): void {
    logger.info('Disconnecting from Gemini Live API');

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    this.state = SessionState.DISCONNECTED;
    this.sessionId = null;
    this.audioBuffer = [];
    this.audioBufferSize = 0;
    this.pendingToolCalls.clear();
  }

  /**
   * Send audio chunk to Gemini for processing.
   *
   * @param audioData - Raw PCM audio data
   */
  sendAudio(audioData: Buffer): void {
    if (this.state !== SessionState.READY && this.state !== SessionState.LISTENING) {
      logger.warn('Cannot send audio in current state', { state: this.state });
      return;
    }

    this.state = SessionState.LISTENING;

    const message = {
      realtimeInput: {
        mediaChunks: [{
          mimeType: this.config.inputFormat.mimeType,
          data: audioData.toString('base64'),
        }],
      },
    };

    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Send a text message (for testing or text-based input).
   */
  sendText(text: string): void {
    if (this.state !== SessionState.READY && this.state !== SessionState.LISTENING) {
      logger.warn('Cannot send text in current state', { state: this.state });
      return;
    }

    const message = {
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text }],
        }],
        turnComplete: true,
      },
    };

    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Send a tool result back to Gemini.
   */
  sendToolResult(toolCallId: string, result: unknown): void {
    const message = {
      toolResponse: {
        functionResponses: [{
          id: toolCallId,
          response: result,
        }],
      },
    };

    this.ws?.send(JSON.stringify(message));
    this.pendingToolCalls.delete(toolCallId);
  }

  /**
   * Update the system instruction mid-session.
   */
  updateSystemInstruction(instruction: string): void {
    this.config.systemInstruction = instruction;

    // Send updated config if connected
    if (this.ws && this.state === SessionState.READY) {
      const message = {
        setup: {
          systemInstruction: {
            parts: [{ text: instruction }],
          },
        },
      };
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send session setup message.
   */
  private sendSetup(): void {
    const setup = {
      setup: {
        model: `models/${this.config.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.config.voice,
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: this.config.systemInstruction }],
        },
        tools: this.config.tools.length > 0
          ? [{ functionDeclarations: this.config.tools }]
          : undefined,
        // Note: realtimeInputConfig removed - the API uses automatic activity detection
        // by default with sensible settings. Custom VAD settings can be re-enabled once
        // the API field names are confirmed.
      },
    };

    this.ws?.send(JSON.stringify(setup));
    logger.debug('Setup message sent', { model: this.config.model });
  }

  /**
   * Handle incoming message from Gemini.
   */
  private handleMessage(message: GeminiServerMessage, onSetupComplete?: () => void): void {
    // Setup complete
    if (message.setupComplete) {
      this.sessionId = message.setupComplete.sessionId;
      this.state = SessionState.READY;
      logger.info('Session setup complete', { sessionId: this.sessionId });
      this.emit('connected');
      onSetupComplete?.();
      return;
    }

    // Server content (audio, text, tool calls)
    if (message.serverContent) {
      const content = message.serverContent;

      // Handle interruption
      if (content.interrupted) {
        logger.debug('Interrupted by user');
        this.state = SessionState.LISTENING;
        this.emit('interrupted');
        return;
      }

      // Process model turn
      if (content.modelTurn?.parts) {
        this.state = SessionState.SPEAKING;
        this.emit('speakingStarted');

        for (const part of content.modelTurn.parts) {
          // Audio output
          if (part.inlineData?.mimeType.startsWith('audio/')) {
            const audioData = Buffer.from(part.inlineData.data, 'base64');

            // Cap the audio buffer to prevent unbounded memory growth
            this.audioBuffer.push(audioData);
            this.audioBufferSize += audioData.length;

            // Trim oldest chunks when buffer exceeds max size
            while (this.audioBufferSize > MAX_AUDIO_BUFFER_SIZE && this.audioBuffer.length > 1) {
              const removed = this.audioBuffer.shift()!;
              this.audioBufferSize -= removed.length;
            }

            this.emit('audio', audioData);
          }

          // Text transcript
          if (part.text) {
            this.emit('transcript', part.text);
          }

          // Function/tool call
          if (part.functionCall) {
            const { name, args } = part.functionCall;
            const callId = `${name}_${Date.now()}`;
            this.pendingToolCalls.set(callId, { name, args });
            logger.info('Tool call received', { name, args });
            this.emit('toolCall', name, args);
          }
        }
      }

      // Turn complete
      if (content.turnComplete) {
        this.state = SessionState.READY;
        this.emit('speakingStopped');
        this.emit('turnComplete');
        logger.debug('Turn complete');
      }
    }

    // Tool call cancellation
    if (message.toolCallCancellation) {
      for (const id of message.toolCallCancellation.ids) {
        this.pendingToolCalls.delete(id);
      }
      logger.debug('Tool calls cancelled', { ids: message.toolCallCancellation.ids });
    }
  }

  /**
   * Handle WebSocket disconnect.
   */
  private handleDisconnect(reason: string): void {
    this.state = SessionState.DISCONNECTED;
    this.sessionId = null;

    this.emit('disconnected', reason);

    // Attempt reconnection if not intentional
    if (reason !== 'normal closure' && this.reconnectAttempts < this.maxReconnectAttempts) {
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

  /**
   * Get collected audio buffer (for debugging/recording).
   */
  getAudioBuffer(): Buffer {
    return Buffer.concat(this.audioBuffer);
  }

  /**
   * Clear the audio buffer.
   */
  clearAudioBuffer(): void {
    this.audioBuffer = [];
    this.audioBufferSize = 0;
  }
}

/**
 * Type declaration for EventEmitter with our events.
 */
export interface GeminiLiveClient {
  on<K extends keyof GeminiLiveEvents>(event: K, listener: GeminiLiveEvents[K]): this;
  emit<K extends keyof GeminiLiveEvents>(event: K, ...args: Parameters<GeminiLiveEvents[K]>): boolean;
}
