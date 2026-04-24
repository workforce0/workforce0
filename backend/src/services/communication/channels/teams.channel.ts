// =============================================================================
// Microsoft Teams Channel Adapter
// =============================================================================
//
// Sends messages via Teams Incoming Webhook.
// Gracefully disabled when webhook URL is not configured.
// =============================================================================

import { logger } from '../../../lib/logger.js';
import type { ChannelAdapter } from '../types.js';

const log = logger.child({ service: 'TeamsChannel' });

export class TeamsChannel implements ChannelAdapter {
  readonly name = 'teams' as const;

  private webhookUrl: string | undefined;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl;

    if (!webhookUrl) {
      log.warn('Teams webhook URL not configured — Teams channel disabled');
    }
  }

  async send(params: {
    to: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ messageId: string; success: boolean }> {
    if (!this.webhookUrl) {
      log.debug({ to: params.to }, 'Teams disabled, skipping send');
      return { messageId: '', success: false };
    }

    try {
      // Teams Incoming Webhook accepts Adaptive Cards or simple text
      const card = (params.metadata?.adaptiveCard as Record<string, unknown>) ?? {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
              type: 'AdaptiveCard',
              version: '1.4',
              body: [
                {
                  type: 'TextBlock',
                  text: params.metadata?.title as string || 'Workforce0 Notification',
                  weight: 'Bolder',
                  size: 'Medium',
                },
                {
                  type: 'TextBlock',
                  text: params.content,
                  wrap: true,
                },
              ],
            },
          },
        ],
      };

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
      });

      if (!response.ok) {
        const text = await response.text();
        log.error({ status: response.status, body: text }, 'Teams webhook error');
        return { messageId: '', success: false };
      }

      const messageId = `teams-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      log.info({ to: params.to, messageId }, 'Teams message sent');
      return { messageId, success: true };
    } catch (err) {
      log.error({ err, to: params.to }, 'Failed to send Teams message');
      return { messageId: '', success: false };
    }
  }
}
