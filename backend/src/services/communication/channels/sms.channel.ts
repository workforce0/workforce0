// =============================================================================
// SMS Channel Adapter
// =============================================================================
//
// Sends SMS messages via Twilio SMS API.
// Reuses existing Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).
// Gracefully disabled when credentials are not configured.
// =============================================================================

import { logger } from '../../../lib/logger.js';
import type { ChannelAdapter } from '../types.js';

const log = logger.child({ service: 'SMSChannel' });

export class SMSChannel implements ChannelAdapter {
  readonly name = 'sms' as const;

  private accountSid: string | undefined;
  private authToken: string | undefined;
  private fromNumber: string | undefined;

  constructor(opts?: { accountSid?: string; authToken?: string; fromNumber?: string }) {
    this.accountSid = opts?.accountSid;
    this.authToken = opts?.authToken;
    this.fromNumber = opts?.fromNumber;

    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      log.warn('Twilio SMS credentials not configured — SMS channel disabled');
    }
  }

  async send(params: {
    to: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ messageId: string; success: boolean }> {
    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      log.debug({ to: params.to }, 'SMS disabled, skipping send');
      return { messageId: '', success: false };
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
      const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

      // Truncate to SMS length limit (1600 chars for Twilio)
      const truncatedContent = params.content.length > 1600
        ? params.content.slice(0, 1597) + '...'
        : params.content;

      const body = new URLSearchParams({
        To: params.to,
        From: this.fromNumber!,
        Body: truncatedContent,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const data = (await response.json()) as { sid?: string; error_code?: number; message?: string };

      if (!response.ok || data.error_code) {
        log.error({ error: data.message, errorCode: data.error_code, to: params.to }, 'Twilio SMS API error');
        return { messageId: '', success: false };
      }

      log.info({ to: params.to, sid: data.sid }, 'SMS sent');
      return { messageId: data.sid ?? '', success: true };
    } catch (err) {
      log.error({ err, to: params.to }, 'Failed to send SMS');
      return { messageId: '', success: false };
    }
  }
}
