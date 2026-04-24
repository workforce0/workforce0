// mvp/src/services/agents/__tests__/outcome-observer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutcomeObserver } from '../outcome-observer.js';

describe('OutcomeObserver', () => {
  let mockPrisma: any;
  let observer: OutcomeObserver;

  beforeEach(() => {
    mockPrisma = {
      agentOutcome: { create: vi.fn().mockResolvedValue({ id: 'outcome-1' }) },
      agentTask: { findUnique: vi.fn() },
      ticket: { findUnique: vi.fn() },
      clarificationRequest: { findMany: vi.fn().mockResolvedValue([]) },
    };
    observer = new OutcomeObserver(mockPrisma);
  });

  describe('recordFromTask', () => {
    it('maps completed+approved task to approved outcome', async () => {
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-1', status: 'completed', approvedBy: 'user-1',
        agentType: 'ba_agent', confidence: 0.92, output: {},
      });

      await observer.recordFromTask('task-1');

      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ result: 'approved', agentType: 'ba_agent' }),
      });
    });

    it('maps completed task with answered clarifications to revised', async () => {
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-2', status: 'completed', approvedBy: null,
        agentType: 'dev_agent', confidence: 0.78, output: {},
      });
      mockPrisma.clarificationRequest.findMany.mockResolvedValue([
        { id: 'cr-1', status: 'answered', response: 'Use approach B' },
      ]);

      await observer.recordFromTask('task-2');

      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          result: 'revised',
          revisionFeedback: 'Use approach B',
        }),
      });
    });

    it('maps failed task to rejected', async () => {
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        id: 'task-3', status: 'failed', approvedBy: null,
        agentType: 'qa_agent', confidence: 0.4, error: 'Validation failed',
      });

      await observer.recordFromTask('task-3');

      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ result: 'rejected' }),
      });
    });

    it('handles task not found gracefully', async () => {
      mockPrisma.agentTask.findUnique.mockResolvedValue(null);

      await observer.recordFromTask('nonexistent');

      expect(mockPrisma.agentOutcome.create).not.toHaveBeenCalled();
    });

    it('handles DB errors gracefully without throwing', async () => {
      mockPrisma.agentTask.findUnique.mockRejectedValue(new Error('DB error'));

      await expect(observer.recordFromTask('task-1')).resolves.not.toThrow();
    });
  });

  // N6 follow-up: native Ticket entry point for chief_of_staff and new
  // callers that stopped writing AgentTask rows.
  describe('recordFromTicket', () => {
    it('writes AgentOutcome with roleSlug as agentType and derives legacy taskId for mirror tickets', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        id: 'tix_legacy_abc123',
        status: 'done',
        roleSlug: 'ba_agent',
        approvedBy: 'user-1',
        confidence: 0.9,
        result: { toolsUsed: ['Read'], stepCount: 4 },
      });
      await observer.recordFromTicket('tix_legacy_abc123');
      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          agentType: 'ba_agent',
          taskId: 'abc123',
          result: 'approved',
          toolsUsed: ['Read'],
          stepCount: 4,
        }),
      });
    });

    it('writes taskId=null for native (non-mirror) tickets', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        id: 'cktn7xxx',
        status: 'done',
        roleSlug: 'chief_of_staff',
        approvedBy: null,
        confidence: 0,
        result: null,
      });
      await observer.recordFromTicket('cktn7xxx');
      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ taskId: null, agentType: 'chief_of_staff' }),
      });
    });

    it('maps failed ticket to rejected', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        id: 'tix_x',
        status: 'failed',
        roleSlug: 'dev_agent',
        approvedBy: null,
        confidence: 0,
        result: null,
      });
      await observer.recordFromTicket('tix_x');
      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ result: 'rejected' }),
      });
    });

    it('maps cancelled ticket to rejected', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        id: 'tix_x',
        status: 'cancelled',
        roleSlug: 'dev_agent',
        approvedBy: null,
        confidence: 0,
        result: null,
      });
      await observer.recordFromTicket('tix_x');
      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ result: 'rejected' }),
      });
    });

    it('maps done ticket with answered clarifications to revised', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        id: 'tix_y',
        status: 'done',
        roleSlug: 'ba_agent',
        approvedBy: null,
        confidence: 0.7,
        result: null,
      });
      mockPrisma.clarificationRequest.findMany.mockResolvedValue([
        { id: 'cr-1', status: 'answered', response: 'use B' },
      ]);
      await observer.recordFromTicket('tix_y');
      expect(mockPrisma.agentOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          result: 'revised',
          revisionFeedback: 'use B',
        }),
      });
    });

    it('handles missing ticket gracefully', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(null);
      await observer.recordFromTicket('missing');
      expect(mockPrisma.agentOutcome.create).not.toHaveBeenCalled();
    });

    it('handles DB errors without throwing', async () => {
      mockPrisma.ticket.findUnique.mockRejectedValue(new Error('boom'));
      await expect(observer.recordFromTicket('tix_x')).resolves.not.toThrow();
    });
  });
});
