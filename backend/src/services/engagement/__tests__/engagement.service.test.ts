import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngagementService } from '../engagement.service.js';

describe('EngagementService', () => {
  let service: EngagementService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      engagement: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        findMany: vi.fn(),
      },
    };
    service = new EngagementService(mockPrisma);
  });

  it('should create engagement in listen phase', async () => {
    mockPrisma.engagement.create.mockResolvedValue({
      id: 'eng-1', phase: 'listen', status: 'active',
    });
    const result = await service.create('tenant-1', { title: 'Sprint Planning', meetingId: 'mtg-1' });
    expect(result.phase).toBe('listen');
    expect(result.status).toBe('active');
  });

  it('should transition from listen to understand', async () => {
    mockPrisma.engagement.findFirst.mockResolvedValue({
      id: 'eng-1', phase: 'listen', status: 'active', confidence: 0, tenantId: 'tenant-1',
    });
    mockPrisma.engagement.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.advancePhase('tenant-1', 'eng-1', { confidence: 0.9 });
    expect(result.phase).toBe('understand');
  });

  it('should reject invalid transitions (listen cannot go to build)', async () => {
    mockPrisma.engagement.findFirst.mockResolvedValue({
      id: 'eng-1', phase: 'listen', status: 'active', confidence: 0, tenantId: 'tenant-1',
    });
    await expect(service.advancePhase('tenant-1', 'eng-1', { targetPhase: 'build' }))
      .rejects.toThrow('Invalid transition');
  });

  it('should pause engagement when confidence below 0.5', async () => {
    mockPrisma.engagement.findFirst.mockResolvedValue({
      id: 'eng-1', phase: 'analyze_ask', status: 'active', confidence: 0, tenantId: 'tenant-1',
    });
    mockPrisma.engagement.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.advancePhase('tenant-1', 'eng-1', { confidence: 0.4 });
    expect(result.status).toBe('paused');
  });

  it('should throw if engagement not found', async () => {
    mockPrisma.engagement.findFirst.mockResolvedValue(null);
    await expect(service.advancePhase('tenant-1', 'nonexistent', {}))
      .rejects.toThrow('Engagement not found');
  });

  it('should throw if engagement is not active', async () => {
    mockPrisma.engagement.findFirst.mockResolvedValue({
      id: 'eng-1', phase: 'listen', status: 'paused', tenantId: 'tenant-1',
    });
    await expect(service.advancePhase('tenant-1', 'eng-1', {}))
      .rejects.toThrow('paused');
  });

  it('should list engagements by tenant', async () => {
    mockPrisma.engagement.findMany.mockResolvedValue([]);
    const result = await service.listByTenant('t-1', 'active');
    expect(mockPrisma.engagement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't-1', status: 'active' } })
    );
  });

  it('should pause and resume engagement', async () => {
    mockPrisma.engagement.updateMany.mockResolvedValue({ count: 1 });
    const paused = await service.pause('tenant-1', 'eng-1', 'Waiting for human input');
    expect(paused.status).toBe('paused');
    expect(mockPrisma.engagement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'eng-1', tenantId: 'tenant-1' } })
    );

    mockPrisma.engagement.updateMany.mockResolvedValue({ count: 1 });
    const resumed = await service.resume('tenant-1', 'eng-1');
    expect(resumed.status).toBe('active');
    expect(mockPrisma.engagement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'eng-1', tenantId: 'tenant-1' } })
    );
  });

  it('should reject operations on engagements from other tenants', async () => {
    // advancePhase: findFirst returns null when tenantId doesn't match
    mockPrisma.engagement.findFirst.mockResolvedValue(null);
    await expect(service.advancePhase('tenant-2', 'eng-1', { confidence: 0.9 }))
      .rejects.toThrow('Engagement not found');

    // pause: updateMany returns count 0 when tenantId doesn't match
    mockPrisma.engagement.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.pause('tenant-2', 'eng-1'))
      .rejects.toThrow('Engagement not found');

    // resume: updateMany returns count 0 when tenantId doesn't match
    mockPrisma.engagement.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.resume('tenant-2', 'eng-1'))
      .rejects.toThrow('Engagement not found');
  });
});
