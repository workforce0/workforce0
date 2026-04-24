// =============================================================================
// Communication Router — Types
// =============================================================================

export type ChannelType = 'slack' | 'email' | 'whatsapp' | 'teams' | 'sms';
export type MessageType =
  | 'clarification'
  | 'approval_request'
  | 'notification'
  | 'escalation'
  | 'test'
  // M7: chief_of_staff orchestration broadcasts — user never comes to the
  // web UI, so every significant orchestration event posts to the
  // preferred comms channel.
  | 'plan_summary'
  | 'progress_update';

export interface SendMessageInput {
  tenantId: string;
  engagementId?: string;
  recipientRole: string;
  recipientId?: string;
  messageType: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
  urgency?: 'low' | 'medium' | 'high';
}

export interface ChannelAdapter {
  name: ChannelType;
  send(params: {
    to: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ messageId: string; success: boolean }>;
}

export interface EscalationPolicy {
  firstAttemptHours: number;
  secondAttemptHours: number;
  finalAttemptHours: number;
}

export const DEFAULT_ESCALATION: EscalationPolicy = {
  firstAttemptHours: 4,
  secondAttemptHours: 8,
  finalAttemptHours: 24,
};
