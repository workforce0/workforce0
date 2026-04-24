// =============================================================================
// WhatsApp Channel Adapter
// =============================================================================
//
// Sends messages via Twilio WhatsApp API.
// Reuses existing Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).
// Gracefully disabled when credentials are not configured.
// =============================================================================

import { logger } from '../../../lib/logger.js';
import type { ChannelAdapter } from '../types.js';

const log = logger.child({ service: 'WhatsAppChannel' });

export class WhatsAppChannel implements ChannelAdapter {
  readonly name = 'whatsapp' as const;

  private accountSid: string | undefined;
  private authToken: string | undefined;
  private fromNumber: string | undefined;

  constructor(opts?: { accountSid?: string; authToken?: string; fromNumber?: string }) {
    this.accountSid = opts?.accountSid;
    this.authToken = opts?.authToken;
    this.fromNumber = opts?.fromNumber;

    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      log.warn('Twilio WhatsApp credentials not configured — WhatsApp channel disabled');
    }
  }

  async send(params: {
    to: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ messageId: string; success: boolean }> {
    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      log.debug({ to: params.to }, 'WhatsApp disabled, skipping send');
      return { messageId: '', success: false };
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
      const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

      // Twilio WhatsApp uses 'whatsapp:' prefix on phone numbers
      const to = params.to.startsWith('whatsapp:') ? params.to : `whatsapp:${params.to}`;
      const from = this.fromNumber!.startsWith('whatsapp:') ? this.fromNumber! : `whatsapp:${this.fromNumber}`;

      const body = new URLSearchParams({
        To: to,
        From: from,
        Body: params.content,
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
        log.error({ error: data.message, errorCode: data.error_code, to }, 'Twilio WhatsApp API error');
        return { messageId: '', success: false };
      }

      log.info({ to, sid: data.sid }, 'WhatsApp message sent');
      return { messageId: data.sid ?? '', success: true };
    } catch (err) {
      log.error({ err, to: params.to }, 'Failed to send WhatsApp message');
      return { messageId: '', success: false };
    }
  }
}
