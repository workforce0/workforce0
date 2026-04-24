/**
 * =============================================================================
 * VOICE MODULE
 * =============================================================================
 *
 * Real-time voice AI for meeting participation using Gemini Live API.
 *
 * Components:
 * -----------
 * - config: VAD thresholds, system prompts, type definitions
 * - gemini-live: WebSocket client for Gemini Live API
 * - meeting-session: High-level session management
 * - session-manager: Manages all active voice sessions
 *
 * Usage:
 * ------
 * ```typescript
 * import {
 *   MeetingVoiceSession,
 *   AudioBridge,
 *   buildGeminiLiveConfig,
 * } from './voice/index.js';
 *
 * // Create session
 * const session = new MeetingVoiceSession({
 *   meetingId: 'meeting-123',
 *   geminiApiKey: process.env.GEMINI_API_KEY,
 *   activeParticipation: true,
 *   onAudioOutput: async (audio) => {
 *     // Route audio back via Twilio or other sink
 *   },
 * });
 *
 * // Start session
 * await session.start();
 *
 * // Handle events
 * session.on('requirementCaptured', (req) => console.log('Requirement:', req));
 * session.on('actionItemCreated', (item) => console.log('Action:', item));
 *
 * // End session
 * const summary = await session.end();
 * ```
 *
 * @module voice
 */

// Configuration
export {
  // Types
  type VADConfig,
  type GeminiLiveConfig,
  type AudioFormat,
  type GeminiFunctionDeclaration,
  type GeminiVoice,
  type VoiceEnvConfig,

  // Constants
  DEFAULT_VAD_CONFIG,
  MEETING_VAD_CONFIG,
  DEFAULT_GEMINI_LIVE_CONFIG,
  MEETING_ASSISTANT_SYSTEM_PROMPT,
  MEETING_TOOLS,

  // Functions
  loadVoiceConfig,
  buildGeminiLiveConfig,
} from './config.js';

// Gemini Live API Client
export {
  GeminiLiveClient,
  SessionState,
  type GeminiLiveEvents,
} from './gemini-live.js';

// Meeting Session Management
export {
  MeetingVoiceSession,
  type MeetingSessionEvents,
  type MeetingSessionConfig,
  type MeetingSessionSummary,
  type CapturedRequirement,
  type ActionItem,
  type FlaggedAmbiguity,
  type SessionStats,
} from './meeting-session.js';

// Voice Session Manager (manages all active voice sessions)
export {
  VoiceSessionManager,
  type VoiceSessionManagerConfig,
  type VoiceSessionManagerEvents,
} from './session-manager.js';
