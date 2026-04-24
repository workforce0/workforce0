/**
 * =============================================================================
 * PARTICIPANT ROUTING SERVICE
 * =============================================================================
 *
 * Manages meeting participants and routes clarification questions to the
 * right people based on their roles/personas.
 *
 * Flow:
 * -----
 * 1. Meeting occurs → Participants captured (names/emails from transcript)
 * 2. AI analyzes transcript → Infers participant roles
 * 3. PRD generated with questions → Each question has a target persona
 * 4. Question routed → @mention the right person in chat
 *
 * Role Detection:
 * ---------------
 * - Manual: Tenant configures role mappings (email → role)
 * - Automatic: AI infers from job titles, speaking patterns, topics
 *
 * @module services/agent/participant-routing
 */

import { PrismaClient } from '../../lib/prisma.js';
import { createChildLogger } from '../../lib/logger.js';
import { GoogleChatService } from '../integrations/gchat.service.js';

const logger = createChildLogger({ service: 'ParticipantRoutingService' });

/**
 * Known personas/roles for routing questions.
 */
export type Persona =
  | 'product_lead'
  | 'tech_lead'
  | 'engineering'
  | 'design'
  | 'stakeholder'
  | 'executive'
  | 'qa'
  | 'unknown';

/**
 * Participant with role information.
 */
export interface MeetingParticipant {
  name: string;
  email?: string;
  role?: Persona;
  inferredTitle?: string; // e.g., "Product Manager", "Senior Engineer"
  speakingTime?: number; // Percentage of meeting they spoke
  topics?: string[]; // Topics they discussed
}

/**
 * Question with routing information.
 */
export interface RoutedQuestion {
  id: string;
  text: string;
  targetPersona: Persona;
  targetParticipant?: MeetingParticipant;
  context?: string; // Why this person should answer
}

/**
 * Chat group for a meeting.
 */
export interface MeetingChatGroup {
  meetingId: string;
  threadKey: string;
  spaceId?: string; // Google Chat space ID if created
  participants: MeetingParticipant[];
  createdAt: Date;
}

/**
 * Role mapping configuration.
 */
export interface RoleMappingConfig {
  /** Email to role mappings */
  emailToRole: Record<string, Persona>;
  /** Job title keywords to role mappings */
  titleKeywords: Record<string, Persona>;
  /** Default role for unknown participants */
  defaultRole: Persona;
}

const DEFAULT_TITLE_KEYWORDS: Record<string, Persona> = {
  // Product roles
  'product manager': 'product_lead',
  'product owner': 'product_lead',
  'pm': 'product_lead',
  'product lead': 'product_lead',
  'head of product': 'product_lead',
  'vp product': 'executive',
  'cpo': 'executive',

  // Technical roles
  'tech lead': 'tech_lead',
  'technical lead': 'tech_lead',
  'architect': 'tech_lead',
  'principal engineer': 'tech_lead',
  'staff engineer': 'tech_lead',
  'engineering manager': 'tech_lead',
  'cto': 'executive',
  'vp engineering': 'executive',
  'developer': 'engineering',
  'engineer': 'engineering',
  'software engineer': 'engineering',
  'frontend': 'engineering',
  'backend': 'engineering',
  'fullstack': 'engineering',

  // Design roles
  'designer': 'design',
  'ux designer': 'design',
  'ui designer': 'design',
  'product designer': 'design',
  'design lead': 'design',
  'head of design': 'design',

  // QA roles
  'qa': 'qa',
  'quality': 'qa',
  'tester': 'qa',
  'test engineer': 'qa',
  'sdet': 'qa',

  // Executive roles
  'ceo': 'executive',
  'coo': 'executive',
  'founder': 'executive',
  'director': 'executive',
  'vp': 'executive',
  'vice president': 'executive',
  'head of': 'stakeholder',
};

/**
 * Service for routing questions to the right meeting participants.
 */
export class ParticipantRoutingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gchatService: GoogleChatService
  ) {
    logger.info('ParticipantRoutingService initialized');
  }

  /**
   * Get enriched participants for a meeting.
   *
   * Combines data from:
   * - Meeting.participants (names/emails from calendar)
   * - Transcript.speakers (who actually spoke)
   * - Tenant role mappings (configured roles)
   * - AI inference (job titles from context)
   */
  async getEnrichedParticipants(meetingId: string): Promise<MeetingParticipant[]> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        transcript: true,
        tenant: { select: { settings: true } },
      },
    });

    if (!meeting) {
      logger.warn('Meeting not found', { meetingId });
      return [];
    }

    // Get raw participants
    const rawParticipants = (meeting.participants as any[]) || [];
    const speakers = (meeting.transcript?.speakers as string[]) || [];

    // Get tenant role mappings
    const settings = (meeting.tenant.settings as Record<string, any>) || {};
    const roleConfig: RoleMappingConfig = {
      emailToRole: settings.roleMappings?.emailToRole || {},
      titleKeywords: { ...DEFAULT_TITLE_KEYWORDS, ...(settings.roleMappings?.titleKeywords || {}) },
      defaultRole: settings.roleMappings?.defaultRole || 'stakeholder',
    };

    // Enrich participants
    const enriched: MeetingParticipant[] = [];
    const processedEmails = new Set<string>();

    // Process participants from calendar invite
    for (const p of rawParticipants) {
      const participant = this.normalizeParticipant(p);
      if (participant.email) {
        processedEmails.add(participant.email.toLowerCase());
      }

      // Assign role
      participant.role = this.inferRole(participant, roleConfig);
      enriched.push(participant);
    }

    // Add speakers who weren't in participant list
    for (const speaker of speakers) {
      const existing = enriched.find(
        (p) => p.name.toLowerCase() === speaker.toLowerCase()
      );
      if (!existing) {
        const participant: MeetingParticipant = {
          name: speaker,
          role: roleConfig.defaultRole,
        };
        enriched.push(participant);
      }
    }

    logger.info('Enriched participants', {
      meetingId,
      count: enriched.length,
      roles: enriched.map((p) => `${p.name}: ${p.role}`),
    });

    return enriched;
  }

  /**
   * Route questions to specific participants based on persona.
   */
  async routeQuestions(
    meetingId: string,
    questions: Array<{ id: string; text: string; targetPersona?: Persona }>
  ): Promise<RoutedQuestion[]> {
    const participants = await this.getEnrichedParticipants(meetingId);

    const routed: RoutedQuestion[] = [];

    for (const q of questions) {
      const persona = q.targetPersona || this.inferQuestionPersona(q.text);
      const target = this.findBestParticipant(participants, persona);

      routed.push({
        id: q.id,
        text: q.text,
        targetPersona: persona,
        targetParticipant: target,
        context: target
          ? `Routed to ${target.name} (${target.role})`
          : `No ${persona} found in meeting participants`,
      });
    }

    logger.info('Routed questions', {
      meetingId,
      questions: routed.map((q) => ({
        id: q.id,
        persona: q.targetPersona,
        target: q.targetParticipant?.name || 'all',
      })),
    });

    return routed;
  }

  /**
   * Send clarification questions to the right people in chat.
   */
  async sendRoutedClarifications(
    prdId: string,
    meetingId: string,
    questions: Array<{ id: string; text: string; targetPersona?: Persona }>,
    options: {
      documentUrl?: string;
      prdTitle?: string;
    } = {}
  ): Promise<string> {
    const routed = await this.routeQuestions(meetingId, questions);
    const participants = await this.getEnrichedParticipants(meetingId);

    // Group questions by target
    const byTarget = new Map<string, RoutedQuestion[]>();
    for (const q of routed) {
      const key = q.targetParticipant?.email || q.targetParticipant?.name || 'all';
      if (!byTarget.has(key)) {
        byTarget.set(key, []);
      }
      byTarget.get(key)!.push(q);
    }

    const threadKey = `prd-clarify-${prdId}`;

    // Build message with @mentions where possible
    let message = `*Clarification Needed: ${options.prdTitle || 'PRD Review'}*\n\n`;
    message += `The following questions need input from meeting participants:\n\n`;

    for (const [target, targetQuestions] of byTarget) {
      const participant = participants.find(
        (p) => p.email === target || p.name === target
      );

      if (participant && participant.email) {
        // @mention format for Google Chat: <users/email@domain.com>
        message += `*For ${participant.name}* (${participant.role}):\n`;
      } else if (target !== 'all') {
        message += `*For ${target}*:\n`;
      } else {
        message += `*For all participants*:\n`;
      }

      for (const q of targetQuestions) {
        message += `  ${q.id}. ${q.text}\n`;
      }
      message += `\n`;
    }

    message += `─────────────────────────────────\n`;
    message += `Reply with: "Q1: [your answer]"\n`;

    if (options.documentUrl) {
      message += `\nView PRD: ${options.documentUrl}`;
    }

    // Send to chat
    await this.gchatService.sendText({
      text: message,
      threadKey,
    });

    // Store routing info for tracking responses
    await this.storeRoutingInfo(prdId, routed);

    return threadKey;
  }

  /**
   * Normalize participant data from various formats.
   */
  private normalizeParticipant(raw: any): MeetingParticipant {
    if (typeof raw === 'string') {
      // Just a name
      return { name: raw };
    }

    return {
      name: raw.name || raw.displayName || raw.email?.split('@')[0] || 'Unknown',
      email: raw.email || raw.emailAddress,
      inferredTitle: raw.title || raw.jobTitle,
    };
  }

  /**
   * Infer role from participant data.
   */
  private inferRole(
    participant: MeetingParticipant,
    config: RoleMappingConfig
  ): Persona {
    // Check explicit email mapping
    if (participant.email && config.emailToRole[participant.email.toLowerCase()]) {
      return config.emailToRole[participant.email.toLowerCase()];
    }

    // Check job title keywords
    if (participant.inferredTitle) {
      const titleLower = participant.inferredTitle.toLowerCase();
      for (const [keyword, role] of Object.entries(config.titleKeywords)) {
        if (titleLower.includes(keyword)) {
          return role;
        }
      }
    }

    // Check name for common patterns (e.g., "John (PM)")
    const nameLower = participant.name.toLowerCase();
    for (const [keyword, role] of Object.entries(config.titleKeywords)) {
      if (nameLower.includes(`(${keyword})`) || nameLower.includes(`- ${keyword}`)) {
        return role;
      }
    }

    return config.defaultRole;
  }

  /**
   * Infer which persona should answer a question based on its content.
   */
  private inferQuestionPersona(questionText: string): Persona {
    const text = questionText.toLowerCase();

    // Technical questions
    if (
      text.includes('architecture') ||
      text.includes('database') ||
      text.includes('api') ||
      text.includes('performance') ||
      text.includes('scalability') ||
      text.includes('security') ||
      text.includes('implementation') ||
      text.includes('technical')
    ) {
      return 'tech_lead';
    }

    // Design questions
    if (
      text.includes('design') ||
      text.includes('ui') ||
      text.includes('ux') ||
      text.includes('user experience') ||
      text.includes('mockup') ||
      text.includes('layout') ||
      text.includes('visual')
    ) {
      return 'design';
    }

    // Product/business questions
    if (
      text.includes('priority') ||
      text.includes('requirement') ||
      text.includes('user story') ||
      text.includes('acceptance criteria') ||
      text.includes('business') ||
      text.includes('stakeholder') ||
      text.includes('timeline') ||
      text.includes('scope')
    ) {
      return 'product_lead';
    }

    // QA questions
    if (
      text.includes('test') ||
      text.includes('quality') ||
      text.includes('validation') ||
      text.includes('edge case')
    ) {
      return 'qa';
    }

    // Default to product lead for general questions
    return 'product_lead';
  }

  /**
   * Find the best participant to answer a question.
   */
  private findBestParticipant(
    participants: MeetingParticipant[],
    targetPersona: Persona
  ): MeetingParticipant | undefined {
    // Exact role match
    const exactMatch = participants.find((p) => p.role === targetPersona);
    if (exactMatch) return exactMatch;

    // Fallback mappings
    const fallbacks: Record<Persona, Persona[]> = {
      tech_lead: ['engineering', 'stakeholder'],
      engineering: ['tech_lead', 'stakeholder'],
      product_lead: ['stakeholder', 'executive'],
      design: ['product_lead', 'stakeholder'],
      qa: ['engineering', 'tech_lead'],
      executive: ['product_lead', 'stakeholder'],
      stakeholder: ['product_lead', 'executive'],
      unknown: ['stakeholder', 'product_lead'],
    };

    for (const fallback of fallbacks[targetPersona] || []) {
      const match = participants.find((p) => p.role === fallback);
      if (match) return match;
    }

    // Return first participant if no match
    return participants[0];
  }

  /**
   * Store routing info for tracking who should respond.
   */
  private async storeRoutingInfo(
    prdId: string,
    routed: RoutedQuestion[]
  ): Promise<void> {
    try {
      const prd = await this.prisma.pRD.findUnique({
        where: { id: prdId },
        select: { taskId: true },
      });

      if (!prd) return;

      // Store in task output
      await this.prisma.agentTask.update({
        where: { id: prd.taskId },
        data: {
          output: {
            routedQuestions: routed.map((q) => ({
              id: q.id,
              text: q.text,
              targetPersona: q.targetPersona,
              targetName: q.targetParticipant?.name,
              targetEmail: q.targetParticipant?.email,
            })),
          },
        },
      });
    } catch (error) {
      logger.warn('Failed to store routing info', {
        prdId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get role mapping configuration for a tenant.
   */
  async getRoleMappings(tenantId: string): Promise<RoleMappingConfig> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    const settings = (tenant?.settings as Record<string, any>) || {};
    return {
      emailToRole: settings.roleMappings?.emailToRole || {},
      titleKeywords: { ...DEFAULT_TITLE_KEYWORDS, ...(settings.roleMappings?.titleKeywords || {}) },
      defaultRole: settings.roleMappings?.defaultRole || 'stakeholder',
    };
  }

  /**
   * Update role mapping for a tenant.
   */
  async updateRoleMappings(
    tenantId: string,
    mappings: Partial<RoleMappingConfig>
  ): Promise<void> {
    const current = await this.getRoleMappings(tenantId);

    const updated: RoleMappingConfig = {
      emailToRole: { ...current.emailToRole, ...mappings.emailToRole },
      titleKeywords: { ...current.titleKeywords, ...mappings.titleKeywords },
      defaultRole: mappings.defaultRole || current.defaultRole,
    };

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          roleMappings: updated,
        } as any,
      },
    });

    logger.info('Updated role mappings', { tenantId });
  }
}

/**
 * Create participant routing service.
 */
export function createParticipantRoutingService(
  prisma: PrismaClient,
  gchatService: GoogleChatService
): ParticipantRoutingService {
  return new ParticipantRoutingService(prisma, gchatService);
}
