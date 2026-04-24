/**
 * =============================================================================
 * ENGAGEMENT SERVICE — Edge Case & Error Handling Tests
 * =============================================================================
 *
 * Tests the 8-phase engagement lifecycle state machine:
 *   listen -> understand -> analyze_ask -> approve -> build -> test -> ship -> learn
 *
 * Covers:
 *   - Creating engagements with valid data
 *   - Advancing phases with valid and invalid transitions
 *   - Confidence gating (low confidence blocks advancement)
 *   - Pause/resume lifecycle
 *   - Engagement not found (404-style)
 *   - Duplicate engagement creation
 *   - Edge: advancing a paused/completed engagement
 *   - Edge: wrapping from learn -> listen
 *   - Edge: queue service dispatch failures are non-fatal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngagementService } from '../../services/engagement/engagement.service.js';
import { PHASE_AGENT_MAP } from '../../services/engagement/engagement.types.js';

// ---------------------------------------------------------------------------
// Helpers – mock Prisma & QueueService
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    engagement: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

function createMockQueueService() {
  return {
    addJob: vi.fn().mockResolvedValue('job-id-123'),
  };
}

function makeEngagement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eng-001',
    tenantId: 'tenant-1',
    title: 'Test Engagement',
    meetingId: 'mtg-001',
    phase: 'listen',
    status: 'active',
    confidence: 0.8,
    agentType: 'meeting_brain',
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EngagementService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let queueService: ReturnType<typeof createMockQueueService>;
  let service: EngagementService;

  beforeEach(() => {
    prisma = createMockPrisma();
    queueService = createMockQueueService();
    service = new EngagementService(prisma, queueService);
  });

  // =========================================================================
  // create()
  // =========================================================================
  describe('create()', () => {
    it('creates an engagement in the listen phase with correct defaults', async () => {
      const created = makeEngagement();
      prisma.engagement.create.mockResolvedValue(created);

      const result = await service.create('tenant-1', {
        title: 'Test Engagement',
        meetingId: 'mtg-001',
      });

      expect(result).toEqual(created);
      expect(prisma.engagement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          title: 'Test Engagement',
          meetingId: 'mtg-001',
          phase: 'listen',
          status: 'active',
          confidence: 0,
          agentType: PHASE_AGENT_MAP['listen'],
        }),
      });
    });

    it('creates an engagement without optional meetingId', async () => {
      const created = makeEngagement({ meetingId: null });
      prisma.engagement.create.mockResolvedValue(created);

      const result = await service.create('tenant-1', { title: 'No Meeting' });

      expect(result.meetingId).toBeNull();
      expect(prisma.engagement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ meetingId: null }),
      });
    });

    it('passes through optional metadata', async () => {
      const meta = { source: 'slack', channel: '#general' };
      const created = makeEngagement({ metadata: meta });
      prisma.engagement.create.mockResolvedValue(created);

      await service.create('tenant-1', { title: 'With meta', metadata: meta });

      expect(prisma.engagement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ metadata: meta }),
      });
    });

    it('propagates Prisma errors (e.g. unique constraint)', async () => {
      prisma.engagement.create.mockRejectedValue(
        new Error('Unique constraint failed on the fields: (`title`,`tenantId`)'),
      );

      await expect(
        service.create('tenant-1', { title: 'Duplicate' }),
      ).rejects.toThrow('Unique constraint failed');
    });
  });

  // =========================================================================
  // advancePhase()
  // =========================================================================
  describe('advancePhase()', () => {
    it('advances listen -> understand with sufficient confidence', async () => {
      const eng = makeEngagement({ phase: 'listen', confidence: 0.8 });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.advancePhase('tenant-1', 'eng-001', {
        confidence: 0.9,
      });

      expect(result.phase).toBe('understand');
      expect(result.confidence).toBe(0.9);
    });

    it('advances through every valid sequential transition', async () => {
      const transitions = [
        ['listen', 'understand'],
        ['understand', 'analyze_ask'],
        ['analyze_ask', 'approve'],
        ['approve', 'build'],
        ['build', 'test'],
        ['test', 'ship'],
        ['ship', 'learn'],
        ['learn', 'listen'],
      ] as const;

      for (const [from, to] of transitions) {
        const eng = makeEngagement({ phase: from });
        prisma.engagement.findFirst.mockResolvedValue(eng);
        prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

        const result = await service.advancePhase('tenant-1', 'eng-001', {
          confidence: 0.9,
        });

        expect(result.phase).toBe(to);
      }
    });

    it('rejects invalid transition listen -> ship', async () => {
      const eng = makeEngagement({ phase: 'listen' });
      prisma.engagement.findFirst.mockResolvedValue(eng);

      await expect(
        service.advancePhase('tenant-1', 'eng-001', {
          confidence: 0.9,
          targetPhase: 'ship',
        }),
      ).rejects.toThrow("Invalid transition from 'listen' to 'ship'");
    });

    it('rejects invalid transition build -> approve (backwards)', async () => {
      const eng = makeEngagement({ phase: 'build' });
      prisma.engagement.findFirst.mockResolvedValue(eng);

      await expect(
        service.advancePhase('tenant-1', 'eng-001', {
          confidence: 0.9,
          targetPhase: 'approve',
        }),
      ).rejects.toThrow("Invalid transition from 'build' to 'approve'");
    });

    it('rejects non-adjacent skip: listen -> analyze_ask', async () => {
      const eng = makeEngagement({ phase: 'listen' });
      prisma.engagement.findFirst.mockResolvedValue(eng);

      await expect(
        service.advancePhase('tenant-1', 'eng-001', {
          confidence: 0.9,
          targetPhase: 'analyze_ask',
        }),
      ).rejects.toThrow("Invalid transition from 'listen' to 'analyze_ask'");
    });

    it('pauses engagement when confidence < 0.5 (gating)', async () => {
      const eng = makeEngagement({ phase: 'listen' });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.advancePhase('tenant-1', 'eng-001', {
        confidence: 0.3,
      });

      expect(result.status).toBe('paused');
      expect(result.confidence).toBe(0.3);
      // Phase should NOT have changed
      expect(result.phase).toBe('listen');
    });

    it('pauses engagement when confidence is exactly 0 (boundary)', async () => {
      const eng = makeEngagement({ phase: 'understand' });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.advancePhase('tenant-1', 'eng-001', {
        confidence: 0,
      });

      expect(result.status).toBe('paused');
    });

    it('advances when confidence is exactly 0.5 (boundary)', async () => {
      const eng = makeEngagement({ phase: 'listen' });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.advancePhase('tenant-1', 'eng-001', {
        confidence: 0.5,
      });

      expect(result.phase).toBe('understand');
    });

    it('throws when engagement is not found', async () => {
      prisma.engagement.findFirst.mockResolvedValue(null);

      await expect(
        service.advancePhase('tenant-1', 'nonexistent', { confidence: 0.9 }),
      ).rejects.toThrow('Engagement not found');
    });

    it('throws when engagement is paused', async () => {
      const eng = makeEngagement({ status: 'paused' });
      prisma.engagement.findFirst.mockResolvedValue(eng);

      await expect(
        service.advancePhase('tenant-1', 'eng-001', { confidence: 0.9 }),
      ).rejects.toThrow('Engagement is paused, cannot advance');
    });

    it('throws when engagement is completed', async () => {
      const eng = makeEngagement({ status: 'completed' });
      prisma.engagement.findFirst.mockResolvedValue(eng);

      await expect(
        service.advancePhase('tenant-1', 'eng-001', { confidence: 0.9 }),
      ).rejects.toThrow('Engagement is completed, cannot advance');
    });

    it('throws when engagement is failed', async () => {
      const eng = makeEngagement({ status: 'failed' });
      prisma.engagement.findFirst.mockResolvedValue(eng);

      await expect(
        service.advancePhase('tenant-1', 'eng-001', { confidence: 0.9 }),
      ).rejects.toThrow('Engagement is failed, cannot advance');
    });

    it('uses existing engagement confidence when none provided', async () => {
      const eng = makeEngagement({ phase: 'listen', confidence: 0.85 });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.advancePhase('tenant-1', 'eng-001', {});

      expect(result.confidence).toBe(0.85);
      expect(result.phase).toBe('understand');
    });

    it('dispatches agent for phase when agent is assigned (build -> dev_agent)', async () => {
      const eng = makeEngagement({ phase: 'approve' });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      await service.advancePhase('tenant-1', 'eng-001', {
        confidence: 0.9,
        output: { prdId: 'prd-001' },
      });

      expect(queueService.addJob).toHaveBeenCalledWith(
        'dev_agent_process',
        expect.objectContaining({
          prdId: 'prd-001',
          engagementId: 'eng-001',
          tenantId: 'tenant-1',
        }),
      );
    });

    it('does not dispatch agent for approve phase (human-driven, null agent)', async () => {
      const eng = makeEngagement({ phase: 'analyze_ask' });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      await service.advancePhase('tenant-1', 'eng-001', { confidence: 0.9 });

      // approve phase has no agent (PHASE_AGENT_MAP['approve'] === null)
      expect(queueService.addJob).not.toHaveBeenCalled();
    });

    it('swallows queue dispatch errors (non-fatal)', async () => {
      const eng = makeEngagement({ phase: 'approve' });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });
      queueService.addJob.mockRejectedValue(new Error('Redis down'));

      // Should NOT throw even though queue fails
      const result = await service.advancePhase('tenant-1', 'eng-001', {
        confidence: 0.9,
        output: { prdId: 'prd-001' },
      });

      expect(result.phase).toBe('build');
    });

    it('wraps from learn -> listen (cyclic lifecycle)', async () => {
      const eng = makeEngagement({ phase: 'learn' });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.advancePhase('tenant-1', 'eng-001', {
        confidence: 0.9,
      });

      expect(result.phase).toBe('listen');
    });

    it('handles updateMany returning count=0 after confidence check', async () => {
      const eng = makeEngagement({ phase: 'listen', confidence: 0.3 });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.advancePhase('tenant-1', 'eng-001', { confidence: 0.3 }),
      ).rejects.toThrow('Engagement not found');
    });

    it('handles updateMany returning count=0 after valid advance', async () => {
      const eng = makeEngagement({ phase: 'listen' });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.advancePhase('tenant-1', 'eng-001', { confidence: 0.9 }),
      ).rejects.toThrow('Engagement not found');
    });
  });

  // =========================================================================
  // get()
  // =========================================================================
  describe('get()', () => {
    it('returns an engagement by ID', async () => {
      const eng = makeEngagement();
      prisma.engagement.findUnique.mockResolvedValue(eng);

      const result = await service.get('eng-001');
      expect(result).toEqual(eng);
    });

    it('throws when engagement not found', async () => {
      prisma.engagement.findUnique.mockResolvedValue(null);

      await expect(service.get('missing-id')).rejects.toThrow(
        'Engagement not found',
      );
    });
  });

  // =========================================================================
  // listByTenant()
  // =========================================================================
  describe('listByTenant()', () => {
    it('lists all engagements for a tenant', async () => {
      const engagements = [makeEngagement(), makeEngagement({ id: 'eng-002' })];
      prisma.engagement.findMany.mockResolvedValue(engagements);

      const result = await service.listByTenant('tenant-1');
      expect(result).toHaveLength(2);
      expect(prisma.engagement.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('filters by status when provided', async () => {
      prisma.engagement.findMany.mockResolvedValue([]);

      await service.listByTenant('tenant-1', 'paused');

      expect(prisma.engagement.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', status: 'paused' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns empty array when tenant has no engagements', async () => {
      prisma.engagement.findMany.mockResolvedValue([]);

      const result = await service.listByTenant('empty-tenant');
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // pause() / resume()
  // =========================================================================
  describe('pause()', () => {
    it('pauses an engagement with a reason', async () => {
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.pause('tenant-1', 'eng-001', 'Low confidence');

      expect(result).toEqual({ id: 'eng-001', status: 'paused' });
      expect(prisma.engagement.updateMany).toHaveBeenCalledWith({
        where: { id: 'eng-001', tenantId: 'tenant-1' },
        data: {
          status: 'paused',
          metadata: { pauseReason: 'Low confidence' },
        },
      });
    });

    it('pauses an engagement without a reason', async () => {
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.pause('tenant-1', 'eng-001');

      expect(result.status).toBe('paused');
      expect(prisma.engagement.updateMany).toHaveBeenCalledWith({
        where: { id: 'eng-001', tenantId: 'tenant-1' },
        data: { status: 'paused', metadata: undefined },
      });
    });

    it('throws when engagement not found', async () => {
      prisma.engagement.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.pause('tenant-1', 'missing', 'reason'),
      ).rejects.toThrow('Engagement not found');
    });
  });

  describe('resume()', () => {
    it('resumes a paused engagement', async () => {
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.resume('tenant-1', 'eng-001');

      expect(result).toEqual({ id: 'eng-001', status: 'active' });
    });

    it('throws when engagement not found', async () => {
      prisma.engagement.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resume('tenant-1', 'missing'),
      ).rejects.toThrow('Engagement not found');
    });
  });

  // =========================================================================
  // setQueueService()
  // =========================================================================
  describe('setQueueService()', () => {
    it('allows setting queue service after construction', async () => {
      const serviceNoQueue = new EngagementService(prisma);

      const eng = makeEngagement({ phase: 'approve' });
      prisma.engagement.findFirst.mockResolvedValue(eng);
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      // Without queue service, dispatch should not happen
      await serviceNoQueue.advancePhase('tenant-1', 'eng-001', {
        confidence: 0.9,
        output: { prdId: 'prd-001' },
      });
      expect(queueService.addJob).not.toHaveBeenCalled();

      // Now attach queue service
      serviceNoQueue.setQueueService(queueService);

      prisma.engagement.findFirst.mockResolvedValue(
        makeEngagement({ phase: 'approve' }),
      );
      prisma.engagement.updateMany.mockResolvedValue({ count: 1 });

      await serviceNoQueue.advancePhase('tenant-1', 'eng-001', {
        confidence: 0.9,
        output: { prdId: 'prd-002' },
      });

      expect(queueService.addJob).toHaveBeenCalled();
    });
  });
});
