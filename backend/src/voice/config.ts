/**
 * =============================================================================
 * VOICE CONFIGURATION
 * =============================================================================
 *
 * Configuration for Gemini Live API real-time voice sessions.
 * Includes VAD thresholds, system prompts, and tool definitions.
 *
 * @module voice/config
 */

import { z } from 'zod';

/**
 * Voice Activity Detection configuration.
 * These thresholds control when the AI responds vs continues listening.
 */
export interface VADConfig {
  /** Silence duration (ms) before AI considers turn complete */
  silenceDurationMs: number;
  /** Speech probability threshold (0-1) for voice detection */
  speechProbabilityThreshold: number;
  /** Prefix padding (ms) - audio included before speech detected */
  prefixPaddingMs: number;
  /** Suffix padding (ms) - audio included after speech ends */
  suffixPaddingMs: number;
}

/**
 * Default VAD settings optimized for meeting conversations.
 *
 * Why these values?
 * - silenceDurationMs: 500ms allows natural pauses without cutting off
 * - speechProbabilityThreshold: 0.5 balances sensitivity vs noise rejection
 * - prefixPaddingMs: 200ms captures word beginnings
 * - suffixPaddingMs: 300ms captures word endings
 */
export const DEFAULT_VAD_CONFIG: VADConfig = {
  silenceDurationMs: 500,
  speechProbabilityThreshold: 0.5,
  prefixPaddingMs: 200,
  suffixPaddingMs: 300,
};

/**
 * Configuration for meeting-specific behavior.
 * Adjusted for longer pauses common in business discussions.
 */
export const MEETING_VAD_CONFIG: VADConfig = {
  silenceDurationMs: 800, // Longer pause tolerance for meeting discussions
  speechProbabilityThreshold: 0.6, // Higher threshold for noisy meeting rooms
  prefixPaddingMs: 250,
  suffixPaddingMs: 400,
};

/**
 * Available Gemini voice options for the meeting assistant.
 */
export type GeminiVoice = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede';

/**
 * Gemini Live API session configuration.
 */
export interface GeminiLiveConfig {
  /** Model to use for live audio */
  model: string;
  /** Voice for audio output */
  voice: GeminiVoice;
  /** System instruction for the assistant */
  systemInstruction: string;
  /** Voice Activity Detection settings */
  vad: VADConfig;
  /** Function declarations for tool use */
  tools: GeminiFunctionDeclaration[];
  /** Audio input format */
  inputFormat: AudioFormat;
  /** Audio output format */
  outputFormat: AudioFormat;
}

/**
 * Audio format specification.
 */
export interface AudioFormat {
  mimeType: 'audio/pcm' | 'audio/wav' | 'audio/mp3';
  sampleRate: number;
  channels: number;
}

/**
 * Gemini function declaration for tool calling.
 */
export interface GeminiFunctionDeclaration {
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
 * System prompt for the meeting assistant.
 * Carefully tuned for natural conversation flow.
 */
export const MEETING_ASSISTANT_SYSTEM_PROMPT = `You are a meeting assistant for Workforce0, an AI workforce platform.

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
- When the answer will likely come naturally

## Example Interactions
User: "We need a login page"
You: "Got it. Will this be email/password, or should I also note SSO support?"

User: "The dashboard should show analytics"
You: "Noted. Quick question - which metrics are most important for the first version?"

## Tools Available
You have access to tools to:
- Flag ambiguous requirements for later clarification
- Update the PRD with new information
- Create Jira tickets for action items`;

/**
 * Function declarations for meeting tools.
 */
export const MEETING_TOOLS: GeminiFunctionDeclaration[] = [
  {
    name: 'flag_ambiguity',
    description: 'Flag a requirement or statement that needs clarification. Use when something is unclear but interrupting would be disruptive.',
    parameters: {
      type: 'object',
      properties: {
        requirement: {
          type: 'string',
          description: 'The ambiguous requirement or statement',
        },
        question: {
          type: 'string',
          description: 'The clarifying question to ask later',
        },
        priority: {
          type: 'string',
          description: 'How important is this clarification',
          enum: ['high', 'medium', 'low'],
        },
      },
      required: ['requirement', 'question', 'priority'],
    },
  },
  {
    name: 'update_prd',
    description: 'Add or update a requirement in the PRD being built.',
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'PRD section to update',
          enum: ['objectives', 'requirements', 'acceptance_criteria', 'out_of_scope', 'assumptions'],
        },
        content: {
          type: 'string',
          description: 'The content to add or update',
        },
        action: {
          type: 'string',
          description: 'Whether to add new content or replace existing',
          enum: ['add', 'replace'],
        },
      },
      required: ['section', 'content', 'action'],
    },
  },
  {
    name: 'create_action_item',
    description: 'Create an action item or follow-up task mentioned in the meeting.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Brief title of the action item',
        },
        description: {
          type: 'string',
          description: 'More detailed description if needed',
        },
        assignee: {
          type: 'string',
          description: 'Person responsible (if mentioned)',
        },
        dueDate: {
          type: 'string',
          description: 'Due date if mentioned (ISO format)',
        },
      },
      required: ['title'],
    },
  },
];

/**
 * Default configuration for meeting voice sessions.
 * Note: Model updated to gemini-2.5-flash as gemini-2.0-flash-live-001 was deprecated Dec 2025.
 * @see https://ai.google.dev/gemini-api/docs/models
 */
export const DEFAULT_GEMINI_LIVE_CONFIG: GeminiLiveConfig = {
  model: 'gemini-2.5-flash-native-audio-preview-12-2025',
  voice: 'Kore',
  systemInstruction: MEETING_ASSISTANT_SYSTEM_PROMPT,
  vad: MEETING_VAD_CONFIG,
  tools: MEETING_TOOLS,
  inputFormat: {
    mimeType: 'audio/pcm',
    sampleRate: 16000,
    channels: 1,
  },
  outputFormat: {
    mimeType: 'audio/pcm',
    sampleRate: 24000,
    channels: 1,
  },
};

/**
 * Environment configuration schema for voice module.
 */
export const voiceEnvSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, 'Gemini API key is required'),
  VOICE_MODEL: z.string().default('gemini-2.5-flash-native-audio-preview-12-2025'),
  VOICE_SILENCE_MS: z.string().transform(Number).default('800'),
  VOICE_SPEECH_THRESHOLD: z.string().transform(Number).default('0.6'),
});

export type VoiceEnvConfig = z.infer<typeof voiceEnvSchema>;

/**
 * Load voice configuration from environment.
 */
export function loadVoiceConfig(): VoiceEnvConfig {
  const result = voiceEnvSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Voice config validation failed: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Build a GeminiLiveConfig from environment and overrides.
 */
export function buildGeminiLiveConfig(
  overrides: Partial<GeminiLiveConfig> = {}
): GeminiLiveConfig {
  const env = loadVoiceConfig();

  return {
    ...DEFAULT_GEMINI_LIVE_CONFIG,
    model: env.VOICE_MODEL,
    vad: {
      ...DEFAULT_GEMINI_LIVE_CONFIG.vad,
      silenceDurationMs: env.VOICE_SILENCE_MS,
      speechProbabilityThreshold: env.VOICE_SPEECH_THRESHOLD,
    },
    ...overrides,
  };
}
