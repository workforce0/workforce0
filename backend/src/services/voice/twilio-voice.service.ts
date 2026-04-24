/**
 * =============================================================================
 * TWILIO VOICE SERVICE
 * =============================================================================
 *
 * Manages Twilio Voice API integration for dial-in voice bot functionality.
 * The bot dials into meetings as a phone participant and speaks AI responses.
 *
 * Flow:
 * -----
 * 1. dialIntoMeeting() → Twilio makes outbound call to meeting dial-in number
 * 2. Twilio connects → webhook returns TwiML with <Connect><Stream>
 * 3. Media Stream WebSocket → bidirectional audio with our server
 * 4. AI audio → Twilio → Meeting (everyone hears AI speak)
 *
 * @module services/voice/twilio-voice
 */

import Twilio from 'twilio';
import { Redis } from 'ioredis';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ module: 'TwilioVoice' });

/**
 * Escape special XML characters to prevent XML injection.
 * Must be applied to any user-controlled value interpolated into TwiML.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Twilio service configuration.
 */
export interface TwilioVoiceConfig {
  /** Twilio Account SID */
  accountSid: string;
  /** Twilio Auth Token */
  authToken: string;
  /** Twilio phone number to call from */
  phoneNumber: string;
  /** Base URL for webhooks (must be publicly accessible) */
  webhookBaseUrl: string;
  /** Optional Redis client for persisting call state across restarts */
  redis?: Redis;
}

/** Redis key prefix for persisted call state */
const REDIS_CALL_PREFIX = 'voice:call:';
/** TTL for Redis call keys (4 hours) */
const REDIS_CALL_TTL_SECONDS = 4 * 60 * 60;

/**
 * Call status from Twilio.
 */
export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled';

/**
 * Active call information.
 */
export interface ActiveCall {
  callSid: string;
  meetingId: string;
  dialInNumber: string;
  status: CallStatus;
  startedAt: Date;
  streamSid?: string;
}

/**
 * Service for managing Twilio Voice calls to meetings.
 *
 * @example
 * ```typescript
 * const twilioService = new TwilioVoiceService({
 *   accountSid: 'ACxxxx',
 *   authToken: 'xxxx',
 *   phoneNumber: '+1234567890',
 *   webhookBaseUrl: 'https://your-server.com',
 * });
 *
 * // Dial into a meeting
 * const callSid = await twilioService.dialIntoMeeting(
 *   'meeting-123',
 *   '+18001234567',
 *   '12345#'
 * );
 *
 * // Later: hang up
 * await twilioService.hangup(callSid);
 * ```
 */
export class TwilioVoiceService {
  private readonly client: Twilio.Twilio;
  private readonly config: TwilioVoiceConfig;
  private readonly activeCalls: Map<string, ActiveCall> = new Map();
  private readonly callsByMeeting: Map<string, string> = new Map(); // meetingId -> callSid
  private readonly redis: Redis | null;

  constructor(config: TwilioVoiceConfig) {
    this.config = config;
    this.client = Twilio(config.accountSid, config.authToken);
    this.redis = config.redis ?? null;

    logger.info('TwilioVoiceService initialized', {
      phoneNumber: config.phoneNumber,
      webhookBaseUrl: config.webhookBaseUrl,
      redisEnabled: !!this.redis,
    });
  }

  /**
   * Check if the service is properly configured.
   */
  isAvailable(): boolean {
    return !!(
      this.config.accountSid &&
      this.config.authToken &&
      this.config.phoneNumber &&
      this.config.webhookBaseUrl
    );
  }

  /**
   * Dial into a meeting as a phone participant.
   *
   * @param meetingId - Internal meeting ID for tracking
   * @param dialInNumber - Phone number to call (meeting dial-in)
   * @param pin - Optional PIN/meeting code (use # for send, w for wait)
   * @returns Call SID
   *
   * @example
   * ```typescript
   * // Google Meet dial-in with PIN
   * await twilioService.dialIntoMeeting(
   *   'meeting-123',
   *   '+18001234567',
   *   'wwwww12345678#' // wait, then enter PIN
   * );
   * ```
   */
  async dialIntoMeeting(
    meetingId: string,
    dialInNumber: string,
    pin?: string
  ): Promise<string> {
    // Check if already in this meeting
    const existingCallSid = this.callsByMeeting.get(meetingId);
    if (existingCallSid) {
      const existingCall = this.activeCalls.get(existingCallSid);
      if (existingCall && existingCall.status === 'in-progress') {
        logger.warn('Already in meeting', { meetingId, callSid: existingCallSid });
        return existingCallSid;
      }
    }

    logger.info('Dialing into meeting', { meetingId, dialInNumber });

    try {
      // Format number for Twilio - if PIN provided, use sendDigits
      const toNumber = pin
        ? `${dialInNumber}`
        : dialInNumber;

      const call = await this.client.calls.create({
        to: toNumber,
        from: this.config.phoneNumber,
        url: `${this.config.webhookBaseUrl}/webhooks/twilio/voice?meetingId=${encodeURIComponent(meetingId)}`,
        statusCallback: `${this.config.webhookBaseUrl}/webhooks/twilio/status?meetingId=${encodeURIComponent(meetingId)}`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        // If PIN provided, send digits after connection
        sendDigits: pin || undefined,
      });

      const activeCall: ActiveCall = {
        callSid: call.sid,
        meetingId,
        dialInNumber,
        status: call.status as CallStatus,
        startedAt: new Date(),
      };

      this.activeCalls.set(call.sid, activeCall);
      this.callsByMeeting.set(meetingId, call.sid);

      // Persist to Redis for crash recovery
      await this.trackCallInRedis(activeCall);

      logger.info('Call initiated', {
        callSid: call.sid,
        meetingId,
        status: call.status,
      });

      return call.sid;
    } catch (error) {
      logger.error('Failed to dial into meeting', {
        meetingId,
        dialInNumber,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Generate TwiML response for incoming call webhook.
   *
   * This TwiML instructs Twilio to connect the call to our Media Stream
   * WebSocket endpoint for bidirectional audio.
   *
   * @param meetingId - Meeting ID to associate with the stream
   * @returns TwiML XML string
   */
  generateConnectTwiML(meetingId: string): string {
    const streamUrl = `${this.config.webhookBaseUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/media-stream/${encodeURIComponent(meetingId)}`;

    // Escape user-controlled values to prevent XML injection in TwiML
    const safeStreamUrl = escapeXml(streamUrl);
    const safeMeetingId = escapeXml(meetingId);

    // TwiML with bidirectional stream - CRITICAL: bidirectional="true" required for outbound audio!
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${safeStreamUrl}" bidirectional="true">
      <Parameter name="meetingId" value="${safeMeetingId}" />
    </Stream>
  </Connect>
</Response>`;

    logger.debug('Generated TwiML', { meetingId, streamUrl });
    return twiml;
  }

  /**
   * Get current call status.
   *
   * @param callSid - Twilio Call SID
   * @returns Current status or null if call not found
   */
  async getCallStatus(callSid: string): Promise<CallStatus | null> {
    const activeCall = this.activeCalls.get(callSid);
    if (activeCall) {
      return activeCall.status;
    }

    try {
      const call = await this.client.calls(callSid).fetch();
      return call.status as CallStatus;
    } catch {
      return null;
    }
  }

  /**
   * Get call info by meeting ID.
   *
   * @param meetingId - Meeting ID
   * @returns Active call info or null
   */
  getCallByMeeting(meetingId: string): ActiveCall | null {
    const callSid = this.callsByMeeting.get(meetingId);
    if (!callSid) return null;
    return this.activeCalls.get(callSid) || null;
  }

  /**
   * Update call status (called from status webhook).
   *
   * @param callSid - Twilio Call SID
   * @param status - New status
   */
  updateCallStatus(callSid: string, status: CallStatus): void {
    const activeCall = this.activeCalls.get(callSid);
    if (activeCall) {
      activeCall.status = status;
      logger.debug('Call status updated', { callSid, status });

      // Clean up completed calls
      if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
        this.callsByMeeting.delete(activeCall.meetingId);
        this.activeCalls.delete(callSid);
        // Remove from Redis
        this.removeCallFromRedis(callSid).catch((e) => {
          logger.warn('Failed to remove ended call from Redis', {
            callSid,
            error: (e as Error).message,
          });
        });
        logger.info('Call ended', { callSid, status, meetingId: activeCall.meetingId });
      }
    }
  }

  /**
   * Set the stream SID for an active call.
   *
   * @param callSid - Twilio Call SID
   * @param streamSid - Media Stream SID
   */
  setStreamSid(callSid: string, streamSid: string): void {
    const activeCall = this.activeCalls.get(callSid);
    if (activeCall) {
      activeCall.streamSid = streamSid;
      logger.debug('Stream SID set', { callSid, streamSid });
    }
  }

  /**
   * Hang up a call.
   *
   * @param callSid - Twilio Call SID
   */
  async hangup(callSid: string): Promise<void> {
    logger.info('Hanging up call', { callSid });

    try {
      await this.client.calls(callSid).update({ status: 'completed' });
      this.updateCallStatus(callSid, 'completed');
    } catch (error) {
      logger.error('Failed to hang up', { callSid, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Hang up call for a specific meeting.
   *
   * @param meetingId - Meeting ID
   */
  async hangupByMeeting(meetingId: string): Promise<void> {
    const callSid = this.callsByMeeting.get(meetingId);
    if (callSid) {
      await this.hangup(callSid);
    } else {
      logger.warn('No active call for meeting', { meetingId });
    }
  }

  /**
   * End all active calls (for graceful shutdown).
   */
  async endAllCalls(): Promise<void> {
    logger.info('Ending all active calls', { count: this.activeCalls.size });

    const hangupPromises = Array.from(this.activeCalls.keys()).map(
      (callSid) => this.hangup(callSid).catch((e) => {
        logger.warn('Failed to hang up call during shutdown', {
          callSid,
          error: (e as Error).message,
        });
      })
    );

    await Promise.all(hangupPromises);
    logger.info('All calls ended');
  }

  /**
   * Get all active calls.
   */
  getActiveCalls(): ActiveCall[] {
    return Array.from(this.activeCalls.values());
  }

  // ===========================================================================
  // Redis-backed call state persistence
  // ===========================================================================

  /**
   * Persist call data to Redis alongside the in-memory Map.
   * Called internally whenever a call is tracked.
   */
  private async trackCallInRedis(call: ActiveCall): Promise<void> {
    if (!this.redis) return;

    try {
      const key = `${REDIS_CALL_PREFIX}${call.callSid}`;
      const data = JSON.stringify({
        callSid: call.callSid,
        meetingId: call.meetingId,
        dialInNumber: call.dialInNumber,
        status: call.status,
        startedAt: call.startedAt.toISOString(),
        streamSid: call.streamSid,
      });
      await this.redis.set(key, data, 'EX', REDIS_CALL_TTL_SECONDS);
      logger.debug('Call persisted to Redis', { callSid: call.callSid });
    } catch (error) {
      logger.warn('Failed to persist call to Redis', {
        callSid: call.callSid,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Remove call data from Redis.
   * Called internally whenever a call is removed from tracking.
   */
  private async removeCallFromRedis(callSid: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.del(`${REDIS_CALL_PREFIX}${callSid}`);
      logger.debug('Call removed from Redis', { callSid });
    } catch (error) {
      logger.warn('Failed to remove call from Redis', {
        callSid,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Reconcile in-memory call state from Redis on startup.
   *
   * Reads all `voice:call:*` keys from Redis and populates
   * the in-memory Maps so the server is aware of calls that
   * were active before a restart.
   */
  async reconcileOnStartup(): Promise<void> {
    if (!this.redis) {
      logger.debug('Redis not configured, skipping call reconciliation');
      return;
    }

    try {
      const keys = await this.redis.keys(`${REDIS_CALL_PREFIX}*`);
      if (keys.length === 0) {
        logger.info('No persisted calls found in Redis');
        return;
      }

      logger.info('Reconciling persisted calls from Redis', { count: keys.length });

      for (const key of keys) {
        try {
          const data = await this.redis.get(key);
          if (!data) continue;

          const parsed = JSON.parse(data) as {
            callSid: string;
            meetingId: string;
            dialInNumber: string;
            status: CallStatus;
            startedAt: string;
            streamSid?: string;
          };

          const activeCall: ActiveCall = {
            callSid: parsed.callSid,
            meetingId: parsed.meetingId,
            dialInNumber: parsed.dialInNumber,
            status: parsed.status,
            startedAt: new Date(parsed.startedAt),
            streamSid: parsed.streamSid,
          };

          this.activeCalls.set(activeCall.callSid, activeCall);
          this.callsByMeeting.set(activeCall.meetingId, activeCall.callSid);

          logger.info('Reconciled call from Redis', {
            callSid: activeCall.callSid,
            meetingId: activeCall.meetingId,
            status: activeCall.status,
          });
        } catch (error) {
          logger.warn('Failed to reconcile call from Redis', {
            key,
            error: (error as Error).message,
          });
        }
      }

      logger.info('Call reconciliation complete', {
        activeCalls: this.activeCalls.size,
      });
    } catch (error) {
      logger.error('Failed to reconcile calls from Redis', {
        error: (error as Error).message,
      });
    }
  }
}
