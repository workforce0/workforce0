import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentJobQueue } from '../job-queue.js';

describe('AgentJobQueue', () => {
  let mockPrisma: any;
  let queue: AgentJobQueue;

  beforeEach(() => {
    mockPrisma = {
      agentJob: {
        create: vi.fn().mockResolvedValue({ id: 'job-1', status: 'pending' }),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    queue = new AgentJobQueue(mockPrisma);
  });

  describe('enqueue', () => {
    it('creates a pending job in DB', async () => {
      const jobId = await queue.enqueue({
        tenantId: 'tenant-1', action: 'implement_prd',
        targetRepo: 'acme/backend', payload: { prdContent: 'Build X' },
      });
      expect(jobId).toBe('job-1');
      expect(mockPrisma.agentJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'pending', action: 'implement_prd' }),
      });
    });
  });

  describe('dequeue', () => {
    it('returns pending jobs matching repos', async () => {
      mockPrisma.agentJob.findMany.mockResolvedValue([
        { id: 'job-1', targetRepo: 'acme/backend', payload: {} },
      ]);
      const jobs = await queue.dequeue('tenant-1', ['acme/backend', 'acme/frontend']);
      expect(jobs).toHaveLength(1);
      expect(mockPrisma.agentJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-1', status: 'pending' }),
        }),
      );
    });
  });

  describe('markDispatched', () => {
    it('updates status to dispatched with agentId', async () => {
      await queue.markDispatched('job-1', 'agent-1');
      expect(mockPrisma.agentJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'dispatched', agentId: 'agent-1' }),
      });
    });
  });

  describe('markInProgress', () => {
    it('updates status to in_progress', async () => {
      await queue.markInProgress('job-1');
      expect(mockPrisma.agentJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'in_progress' }),
      });
    });
  });

  describe('markComplete', () => {
    it('updates status to done with result', async () => {
      await queue.markComplete('job-1', { prUrl: 'https://github.com/pr/1' });
      expect(mockPrisma.agentJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'done', result: { prUrl: 'https://github.com/pr/1' } }),
      });
    });
  });

  describe('markFailed', () => {
    it('updates status to failed with error', async () => {
      await queue.markFailed('job-1', 'claude crashed');
      expect(mockPrisma.agentJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'failed', error: 'claude crashed' }),
      });
    });
  });

  describe('expireStale', () => {
    it('marks old pending jobs as failed', async () => {
      mockPrisma.agentJob.updateMany.mockResolvedValue({ count: 2 });
      const count = await queue.expireStale();
      expect(count).toBeGreaterThanOrEqual(0);
      expect(mockPrisma.agentJob.updateMany).toHaveBeenCalled();
    });
  });
});
