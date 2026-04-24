// =============================================================================
// Email Channel Adapter
// =============================================================================
//
// Sends emails via SendGrid HTTP API (v3).
// Gracefully falls back to stub mode when SENDGRID_API_KEY is not configured.
// =============================================================================

import { logger } from '../../../lib/logger.js';
import type { ChannelAdapter } from '../types.js';

const log = logger.child({ service: 'EmailChannel' });

export class EmailChannel implements ChannelAdapter {
  readonly name = 'email' as const;

  private apiKey: string | undefined;
  private fromEmail: string;
  private fromName: string;

  constructor(opts?: { apiKey?: string; fromEmail?: string; fromName?: string }) {
    this.apiKey = opts?.apiKey;
    this.fromEmail = opts?.fromEmail ?? 'noreply@workforce0.ai';
    this.fromName = opts?.fromName ?? 'Workforce0';

    if (!this.apiKey) {
      log.warn('SendGrid API key not configured — Email channel in stub mode');
    }
  }

  async send(params: {
    to: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ messageId: string; success: boolean }> {
    // Stub mode when SendGrid not configured
    if (!this.apiKey) {
      const messageId = `email-stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      log.info({ to: params.to, messageId, contentLength: params.content.length }, 'Email sent (stub)');
      return { messageId, success: true };
    }

    try {
      const subject = (params.metadata?.subject as string) ?? 'Workforce0 Notification';
      const htmlContent = (params.metadata?.html as string) ?? this.textToHtml(params.content);

      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: params.to }] }],
          from: { email: this.fromEmail, name: this.fromName },
          subject,
          content: [
            { type: 'text/plain', value: params.content },
            { type: 'text/html', value: htmlContent },
          ],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        log.error({ status: response.status, body: errorBody, to: params.to }, 'SendGrid API error');
        return { messageId: '', success: false };
      }

      // SendGrid returns message ID in X-Message-Id header
      const messageId = response.headers.get('X-Message-Id') ??
        `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      log.info({ to: params.to, messageId }, 'Email sent via SendGrid');
      return { messageId, success: true };
    } catch (err) {
      log.error({ err, to: params.to }, 'Failed to send email');
      return { messageId: '', success: false };
    }
  }

  /** Convert plain text to basic HTML for email rendering */
  private textToHtml(text: string): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 20px;">
          <strong style="font-size: 16px; color: #1a1a1a;">Workforce0</strong>
        </div>
        <div style="color: #333; line-height: 1.6; font-size: 14px;">
          ${escaped}
        </div>
        <div style="margin-top: 30px; padding-top: 12px; border-top: 1px solid #e5e5e5; color: #888; font-size: 12px;">
          Sent by Workforce0 AI Platform
        </div>
      </div>
    `.trim();
  }
}
