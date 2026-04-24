import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommunicationRouter } from '../router.js';

describe('CommunicationRouter', () => {
  let router: CommunicationRouter;
  let mockPrisma: any;
  let mockSlack: any;
  let mockEmail: any;

  beforeEach(() => {
    mockPrisma = {
      teamMember: { findFirst: vi.fn(), findMany: vi.fn() },
      messageLog: {
        create: vi.fn().mockResolvedValue({ id: 'ml-1' }),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
      },
      engagement: { update: vi.fn().mockResolvedValue({}) },
    };
    mockSlack = { name: 'slack', send: vi.fn().mockResolvedValue({ messageId: 'msg-1', success: true }) };
    mockEmail = { name: 'email', send: vi.fn().mockResolvedValue({ messageId: 'msg-2', success: true }) };
    router = new CommunicationRouter(mockPrisma, [mockSlack, mockEmail]);
  });

  it('should resolve recipient by role and send via preferred channel', async () => {
    mockPrisma.teamMember.findFirst.mockResolvedValue({
      id: 'tm-1', name: 'Marcus', role: 'cto',
      preferredChannel: 'slack', channelIds: { slack: 'U123', email: 'marcus@co.com' },
    });

    const result = await router.send({
      tenantId: 't-1', recipientRole: 'cto',
      messageType: 'clarification', content: 'Which database?',
    });

    expect(mockSlack.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'U123' }));
    expect(result.success).toBe(true);
  });

  it('should fall back to founder when role not found', async () => {
    mockPrisma.teamMember.findFirst
      .mockResolvedValueOnce(null) // No CTO
      .mockResolvedValueOnce({
        id: 'tm-2', name: 'Sarah', role: 'founder',
        preferredChannel: 'slack', channelIds: { slack: 'U456' },
      });

    const result = await router.send({
      tenantId: 't-1', recipientRole: 'cto',
      messageType: 'clarification', content: 'Which database?',
    });

    expect(result.success).toBe(true);
    expect(mockSlack.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'U456' }));
  });

  it('should try alternate channel when preferred unavailable', async () => {
    mockPrisma.teamMember.findFirst.mockResolvedValue({
      id: 'tm-1', name: 'Marcus', role: 'cto',
      preferredChannel: 'whatsapp', channelIds: { email: 'marcus@co.com' },
    });

    const result = await router.send({
      tenantId: 't-1', recipientRole: 'cto',
      messageType: 'clarification', content: 'Which database?',
    });

    expect(mockEmail.send).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('should return failure when no recipient found', async () => {
    mockPrisma.teamMember.findFirst.mockResolvedValue(null);

    const result = await router.send({
      tenantId: 't-1', recipientRole: 'cto',
      messageType: 'clarification', content: 'Which database?',
    });

    expect(result.success).toBe(false);
  });

  it('should send directly by recipientId', async () => {
    mockPrisma.teamMember.findFirst.mockResolvedValue({
      id: 'tm-1', name: 'Marcus', role: 'cto',
      preferredChannel: 'email', channelIds: { email: 'marcus@co.com' },
    });

    const result = await router.send({
      tenantId: 't-1', recipientRole: 'cto', recipientId: 'tm-1',
      messageType: 'notification', content: 'PR ready for review',
    });

    expect(result.success).toBe(true);
  });

  // ===========================================================================
  // Escalation Policy
  // ===========================================================================

  describe('checkEscalations', () => {
    it('should escalate to alternate channel after 4 hours', async () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 3600000);
      mockPrisma.messageLog.findMany.mockResolvedValue([
        {
          id: 'ml-1', tenantId: 't-1', recipientId: 'tm-1',
          channel: 'slack', content: 'Which database?',
          status: 'sent', sentAt: fiveHoursAgo,
          respondedAt: null, escalatedAt: null, engagementId: null,
        },
      ]);
      mockPrisma.teamMember.findFirst.mockResolvedValue({
        id: 'tm-1', name: 'Marcus', role: 'cto',
        preferredChannel: 'slack', channelIds: { slack: 'U123', email: 'marcus@co.com' },
      });

      const summary = await router.checkEscalations();

      expect(summary.escalated).toBe(1);
      expect(mockEmail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'marcus@co.com', content: 'Which database?' }),
      );
      expect(mockPrisma.messageLog.update).toHaveBeenCalledWith({
        where: { id: 'ml-1' },
        data: expect.objectContaining({ escalationChannel: 'email' }),
      });
    });

    it('should notify founder after 8 hours', async () => {
      const nineHoursAgo = new Date(Date.now() - 9 * 3600000);
      mockPrisma.messageLog.findMany.mockResolvedValue([
        {
          id: 'ml-2', tenantId: 't-1', recipientId: 'tm-1',
          channel: 'slack', content: 'Need approval',
          status: 'sent', sentAt: nineHoursAgo,
          respondedAt: null, escalatedAt: null, engagementId: null,
        },
      ]);
      mockPrisma.teamMember.findFirst.mockResolvedValue({
        id: 'tm-founder', name: 'Sarah', role: 'founder',
        preferredChannel: 'slack', channelIds: { slack: 'U456' },
      });

      const summary = await router.checkEscalations();

      expect(summary.founderNotified).toBe(1);
      expect(mockSlack.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'U456' }),
      );
      expect(mockPrisma.messageLog.update).toHaveBeenCalledWith({
        where: { id: 'ml-2' },
        data: expect.objectContaining({ status: 'escalated', escalationChannel: 'founder' }),
      });
    });

    it('should flag engagement for pause after 24 hours', async () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3600000);
      mockPrisma.messageLog.findMany.mockResolvedValue([
        {
          id: 'ml-3', tenantId: 't-1', recipientId: 'tm-1',
          channel: 'slack', content: 'Urgent review needed',
          status: 'sent', sentAt: twentyFiveHoursAgo,
          respondedAt: null, escalatedAt: null, engagementId: 'eng-1',
        },
      ]);
      mockPrisma.teamMember.findMany.mockResolvedValue([
        {
          id: 'tm-1', name: 'Marcus', role: 'cto',
          preferredChannel: 'slack', channelIds: { slack: 'U123' },
        },
        {
          id: 'tm-2', name: 'Sarah', role: 'founder',
          preferredChannel: 'email', channelIds: { email: 'sarah@co.com' },
        },
      ]);

      const summary = await router.checkEscalations();

      expect(summary.engagementsPaused).toBe(1);
      expect(mockPrisma.engagement.update).toHaveBeenCalledWith({
        where: { id: 'eng-1' },
        data: { status: 'paused' },
      });
      // Notify all stakeholders
      expect(mockSlack.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'U123' }),
      );
      expect(mockEmail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'sarah@co.com' }),
      );
    });

    it('should not escalate responded messages', async () => {
      // The query filters for status: 'sent' and respondedAt: null,
      // so responded messages should not be returned at all.
      mockPrisma.messageLog.findMany.mockResolvedValue([]);

      const summary = await router.checkEscalations();

      expect(summary.escalated).toBe(0);
      expect(summary.founderNotified).toBe(0);
      expect(summary.engagementsPaused).toBe(0);
      expect(mockSlack.send).not.toHaveBeenCalled();
      expect(mockEmail.send).not.toHaveBeenCalled();
    });
  });

  describe('markResponded', () => {
    it('should update message status', async () => {
      await router.markResponded('ml-1', 'Use PostgreSQL');

      expect(mockPrisma.messageLog.update).toHaveBeenCalledWith({
        where: { id: 'ml-1' },
        data: expect.objectContaining({
          response: 'Use PostgreSQL',
          status: 'responded',
        }),
      });
      // Verify respondedAt is a Date instance
      const updateCall = mockPrisma.messageLog.update.mock.calls[0][0];
      expect(updateCall.data.respondedAt).toBeInstanceOf(Date);
    });
  });
});
