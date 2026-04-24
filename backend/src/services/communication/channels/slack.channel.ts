// =============================================================================
// Slack Channel Adapter
// =============================================================================
//
// Sends messages via the Slack Web API (chat.postMessage).
// Gracefully disabled when no bot token is configured.
// =============================================================================

import { logger } from '../../../lib/logger.js';
import type { ChannelAdapter } from '../types.js';

const log = logger.child({ service: 'SlackChannel' });

export class SlackChannel implements ChannelAdapter {
  readonly name = 'slack' as const;
  private botToken: string | undefined;

  constructor(botToken?: string) {
    this.botToken = botToken;

    if (!botToken) {
      log.warn('Slack bot token not configured — Slack channel disabled');
    }
  }

  async send(params: {
    to: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ messageId: string; success: boolean }> {
    if (!this.botToken) {
      log.debug({ to: params.to }, 'Slack disabled, skipping send');
      return { messageId: '', success: false };
    }

    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: params.to,
          text: params.content,
          ...(params.metadata?.blocks ? { blocks: params.metadata.blocks } : {}),
        }),
      });

      const data = (await response.json()) as { ok: boolean; ts?: string; error?: string };

      if (!data.ok) {
        log.error({ error: data.error, to: params.to }, 'Slack API error');
        return { messageId: '', success: false };
      }

      log.info({ to: params.to, ts: data.ts }, 'Slack message sent');
      return { messageId: data.ts ?? '', success: true };
    } catch (err) {
      log.error({ err, to: params.to }, 'Failed to send Slack message');
      return { messageId: '', success: false };
    }
  }
}
