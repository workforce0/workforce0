// =============================================================================
// Communication Router — Core
// =============================================================================
//
// Routes messages to team members via their preferred channel.
// Handles:
//   - Recipient resolution by role (with founder fallback)
//   - Multi-channel delivery (preferred → alternate)
//   - Message logging for audit trail
//
// Usage:
//   const router = new CommunicationRouter(prisma, [slackChannel, emailChannel]);
//   await router.send({ tenantId, recipientRole: 'cto', messageType: 'clarification', content: '...' });
// =============================================================================

import { logger } from '../../lib/logger.js';
import type { ChannelAdapter, ChannelType, SendMessageInput } from './types.js';
import { DEFAULT_ESCALATION } from './types.js';
import type { EscalationPolicy } from './types.js';

const log = logger.child({ service: 'CommunicationRouter' });

export interface SendResult {
  success: boolean;
  messageLogId?: string;
  channel?: string;
  error?: string;
}

export interface EscalationSummary {
  escalated: number;
  founderNotified: number;
  engagementsPaused: number;
}

export class CommunicationRouter {
  private prisma: any;
  private channels: Map<ChannelType, ChannelAdapter>;

  constructor(prisma: any, adapters: ChannelAdapter[]) {
    this.prisma = prisma;
    this.channels = new Map();
    for (const adapter of adapters) {
      this.channels.set(adapter.name, adapter);
    }
  }

  /**
   * Send a message to a team member, resolving recipient and channel automatically.
   */
  async send(input: SendMessageInput): Promise<SendResult> {
    const { tenantId, recipientRole, recipientId, messageType, content, metadata, engagementId } = input;

    // Step 1: Resolve recipient
    const recipient = await this.resolveRecipient(tenantId, recipientRole, recipientId);

    if (!recipient) {
      log.warn({ tenantId, recipientRole, recipientId }, 'No recipient found');
      return { success: false, error: 'No recipient found' };
    }

    // Step 2: Resolve channel and address
    const channelIds = recipient.channelIds as Record<string, string>;
    const preferredChannel = recipient.preferredChannel as ChannelType;

    // Try preferred channel first
    const preferredAdapter = this.channels.get(preferredChannel);
    const preferredAddress = channelIds[preferredChannel];

    if (preferredAdapter && preferredAddress) {
      return this.deliverAndLog({
        adapter: preferredAdapter,
        address: preferredAddress,
        recipient,
        input,
      });
    }

    // Step 3: Fall back to any available channel
    log.debug(
      { recipientId: recipient.id, preferredChannel },
      'Preferred channel unavailable, trying alternates',
    );
    return this.sendViaAlternate(channelIds, recipient, input);
  }

  /**
   * Resolve a team member by ID or by role (with founder fallback).
   */
  private async resolveRecipient(
    tenantId: string,
    role: string,
    recipientId?: string,
  ): Promise<any | null> {
    if (recipientId) {
      const member = await this.prisma.teamMember.findFirst({
        where: { id: recipientId, tenantId, isActive: true },
      });
      if (member) return member;
    }

    // Find by role
    const member = await this.prisma.teamMember.findFirst({
      where: { tenantId, role, isActive: true },
    });

    if (member) return member;

    // Fall back to founder
    if (role !== 'founder') {
      log.debug({ tenantId, role }, 'Role not found, falling back to founder');
      return this.prisma.teamMember.findFirst({
        where: { tenantId, role: 'founder', isActive: true },
      });
    }

    return null;
  }

  /**
   * Try all available channels when the preferred one is unavailable.
   */
  private async sendViaAlternate(
    channelIds: Record<string, string>,
    recipient: any,
    input: SendMessageInput,
  ): Promise<SendResult> {
    for (const [channelName, address] of Object.entries(channelIds)) {
      const adapter = this.channels.get(channelName as ChannelType);
      if (adapter && address) {
        return this.deliverAndLog({ adapter, address, recipient, input });
      }
    }

    log.warn({ recipientId: recipient.id }, 'No channel available for recipient');
    return { success: false, error: 'No channel available' };
  }

  /**
   * Deliver a message via the given adapter and log it to MessageLog.
   */
  private async deliverAndLog(params: {
    adapter: ChannelAdapter;
    address: string;
    recipient: any;
    input: SendMessageInput;
  }): Promise<SendResult> {
    const { adapter, address, recipient, input } = params;

    try {
      const result = await adapter.send({
        to: address,
        content: input.content,
        metadata: input.metadata,
      });

      const logEntry = await this.prisma.messageLog.create({
        data: {
          tenantId: input.tenantId,
          engagementId: input.engagementId ?? null,
          recipientId: recipient.id,
          channel: adapter.name,
          messageType: input.messageType,
          content: input.content,
          metadata: input.metadata ?? null,
          status: result.success ? 'sent' : 'failed',
        },
      });

      log.info(
        {
          messageLogId: logEntry.id,
          channel: adapter.name,
          recipientId: recipient.id,
          messageType: input.messageType,
        },
        'Message sent',
      );

      return {
        success: result.success,
        messageLogId: logEntry.id,
        channel: adapter.name,
      };
    } catch (err) {
      log.error({ err, channel: adapter.name, recipientId: recipient.id }, 'Failed to send message');
      return { success: false, error: (err as Error).message };
    }
  }

  // ===========================================================================
  // Escalation Policy
  // ===========================================================================

  /**
   * Check all unresponded messages and apply time-based escalation rules.
   *
   * Called periodically (e.g. by a cron job or BullMQ scheduled job).
   *
   * Rules (using DEFAULT_ESCALATION thresholds):
   *   >= 4h  no response, no prior escalation → send via alternate channel
   *   >= 8h  no response → escalate to founder/admin
   *   >= 24h no response → pause the engagement, notify all stakeholders
   */
  async checkEscalations(
    policy: EscalationPolicy = DEFAULT_ESCALATION,
  ): Promise<EscalationSummary> {
    const summary: EscalationSummary = { escalated: 0, founderNotified: 0, engagementsPaused: 0 };

    const unresponded = await this.prisma.messageLog.findMany({
      where: { status: 'sent', respondedAt: null },
    });

    const now = Date.now();

    for (const msg of unresponded) {
      const sentAt = new Date(msg.sentAt).getTime();
      const hoursElapsed = (now - sentAt) / 3_600_000;

      // --- 24-hour threshold: pause engagement ---
      if (hoursElapsed >= policy.finalAttemptHours) {
        if (msg.engagementId) {
          await this.prisma.engagement.update({
            where: { id: msg.engagementId },
            data: { status: 'paused' },
          });
        }

        // Notify all stakeholders for this tenant
        const stakeholders = await this.prisma.teamMember.findMany({
          where: { tenantId: msg.tenantId, isActive: true },
        });

        for (const member of stakeholders) {
          const channelIds = member.channelIds as Record<string, string>;
          const preferredChannel = member.preferredChannel as ChannelType;
          const adapter = this.channels.get(preferredChannel);
          const address = channelIds[preferredChannel];

          if (adapter && address) {
            await adapter.send({
              to: address,
              content: `Engagement paused: no response received after ${policy.finalAttemptHours} hours for message "${msg.content}".`,
            });
          }
        }

        await this.prisma.messageLog.update({
          where: { id: msg.id },
          data: { status: 'escalated', escalatedAt: new Date(), escalationChannel: 'all_stakeholders' },
        });

        summary.engagementsPaused++;
        continue;
      }

      // --- 8-hour threshold: escalate to founder ---
      if (hoursElapsed >= policy.secondAttemptHours) {
        const founder = await this.prisma.teamMember.findFirst({
          where: { tenantId: msg.tenantId, role: 'founder', isActive: true },
        });

        if (founder) {
          const channelIds = founder.channelIds as Record<string, string>;
          const preferredChannel = founder.preferredChannel as ChannelType;
          const adapter = this.channels.get(preferredChannel);
          const address = channelIds[preferredChannel];

          if (adapter && address) {
            await adapter.send({
              to: address,
              content: `Escalation: no response after ${policy.secondAttemptHours} hours for message "${msg.content}".`,
            });
          }
        }

        await this.prisma.messageLog.update({
          where: { id: msg.id },
          data: { status: 'escalated', escalatedAt: new Date(), escalationChannel: 'founder' },
        });

        summary.founderNotified++;
        continue;
      }

      // --- 4-hour threshold: try alternate channel ---
      if (hoursElapsed >= policy.firstAttemptHours && !msg.escalatedAt) {
        const recipient = await this.prisma.teamMember.findFirst({
          where: { id: msg.recipientId, isActive: true },
        });

        if (recipient) {
          const channelIds = recipient.channelIds as Record<string, string>;
          const originalChannel = msg.channel as ChannelType;

          // Find an alternate channel (any channel other than the one already used)
          let sent = false;
          for (const [channelName, address] of Object.entries(channelIds)) {
            if (channelName === originalChannel) continue;
            const adapter = this.channels.get(channelName as ChannelType);
            if (adapter && address) {
              await adapter.send({ to: address, content: msg.content });
              await this.prisma.messageLog.update({
                where: { id: msg.id },
                data: { escalatedAt: new Date(), escalationChannel: channelName },
              });
              sent = true;
              break;
            }
          }

          if (sent) {
            summary.escalated++;
          }
        }
      }
    }

    log.info(summary, 'Escalation check complete');
    return summary;
  }

  /**
   * Mark a message as responded to.
   */
  async markResponded(messageId: string, response: string): Promise<void> {
    await this.prisma.messageLog.update({
      where: { id: messageId },
      data: { respondedAt: new Date(), response, status: 'responded' },
    });
  }
}
