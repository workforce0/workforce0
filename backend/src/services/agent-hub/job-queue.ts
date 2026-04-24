import { createChildLogger } from '../../lib/logger.js';
import type { AgentJobData, AgentJobStatus } from './types.js';
import { JOB_EXPIRY_MS, STALE_JOB_TIMEOUT_MS, JOB_ACK_TIMEOUT_MS } from './types.js';

const log = createChildLogger({ module: 'agent-job-queue' });

export class AgentJobQueue {
  constructor(private prisma: any) {}

  async enqueue(job: AgentJobData): Promise<string> {
    const record = await this.prisma.agentJob.create({
      data: {
        tenantId: job.tenantId,
        action: job.action,
        targetRepo: job.targetRepo,
        payload: job.payload,
        status: 'pending',
      },
    });
    log.info('Job enqueued', { jobId: record.id, action: job.action, targetRepo: job.targetRepo });
    return record.id;
  }

  async dequeue(tenantId: string, repos: string[]): Promise<any[]> {
    return this.prisma.agentJob.findMany({
      where: { tenantId, status: 'pending', targetRepo: { in: repos } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getStatus(jobId: string): Promise<AgentJobStatus | null> {
    const job = await this.prisma.agentJob.findUnique({ where: { id: jobId } });
    return job?.status || null;
  }

  async markDispatched(jobId: string, agentId: string): Promise<void> {
    await this.prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'dispatched', agentId, dispatchedAt: new Date() },
    });
  }

  async markInProgress(jobId: string): Promise<void> {
    await this.prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'in_progress' },
    });
  }

  async markComplete(jobId: string, result: any): Promise<void> {
    await this.prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'done', result, completedAt: new Date() },
    });
    log.info('Job completed', { jobId });
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await this.prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'failed', error, completedAt: new Date() },
    });
    log.warn('Job failed', { jobId, error });
  }

  async expireStale(): Promise<number> {
    const cutoff = new Date(Date.now() - JOB_EXPIRY_MS);
    const expired = await this.prisma.agentJob.updateMany({
      where: { status: 'pending', createdAt: { lt: cutoff } },
      data: { status: 'failed', error: 'Expired: no agent available for 24 hours' },
    });

    const ackCutoff = new Date(Date.now() - JOB_ACK_TIMEOUT_MS);
    const unacked = await this.prisma.agentJob.updateMany({
      where: { status: 'dispatched', dispatchedAt: { lt: ackCutoff } },
      data: { status: 'pending', agentId: null, dispatchedAt: null },
    });

    const staleCutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);
    const stale = await this.prisma.agentJob.updateMany({
      where: { status: 'in_progress', updatedAt: { lt: staleCutoff } },
      data: { status: 'failed', error: 'Agent disconnected and did not reconnect within 1 hour' },
    });

    const total = expired.count + unacked.count + stale.count;
    if (total > 0) log.info('Expired stale jobs', { expired: expired.count, requeued: unacked.count, stale: stale.count });
    return total;
  }
}
