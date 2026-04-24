/**
 * =============================================================================
 * BA AGENT TOOLS — Edge Case & Error Handling Tests
 * =============================================================================
 *
 * Tests the 5 MCP tools exposed to the Business Analyst Agent:
 *   1. read_transcript
 *   2. recall_tenant_context
 *   3. create_prd
 *   4. ask_clarification
 *   5. check_existing_backlog
 *
 * Covers:
 *   - read_transcript with valid meetingId, missing meetingId, non-existent meeting
 *   - sanitizeForAI is applied to transcript fullText
 *   - create_prd with complete data, missing meetingId/taskId in context
 *   - ask_clarification routes to correct channel via commsRouter
 *   - check_existing_backlog search and empty results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBATools } from '../../services/agents/ba/tools.js';
import type { AgentContext } from '../../services/agent-runtime/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    transcript: {
      findUnique: vi.fn(),
    },
    pRD: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    clarificationRequest: {
      create: vi.fn(),
    },
  };
}

function createMockCommsRouter() {
  return {
    send: vi.fn().mockResolvedValue({ success: true, channel: 'gchat' }),
  };
}

function createMockMemoryService() {
  return {
    getContext: vi.fn().mockResolvedValue([]),
  };
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    tenantId: 'tenant-1',
    engagementId: 'eng-001',
    agentType: 'ba_agent',
    traceId: 'trace-001',
    memory: { meetingId: 'mtg-001', taskId: 'task-001' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BA Agent Tools', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let commsRouter: ReturnType<typeof createMockCommsRouter>;
  let memoryService: ReturnType<typeof createMockMemoryService>;
  let tools: ReturnType<typeof createBATools>;
  let ctx: AgentContext;

  beforeEach(() => {
    prisma = createMockPrisma();
    commsRouter = createMockCommsRouter();
    memoryService = createMockMemoryService();
    tools = createBATools({
      prisma: prisma as any,
      commsRouter: commsRouter as any,
      memoryService: memoryService as any,
    });
    ctx = makeContext();
  });

  function findTool(name: string) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    return tool;
  }

  // =========================================================================
  // read_transcript
  // =========================================================================
  describe('read_transcript', () => {
    it('returns success:true with sanitized transcript data', async () => {
      prisma.transcript.findUnique.mockResolvedValue({
        fullText: 'Meeting discussion about <script>alert("xss")</script> feature',
        segments: [{ speaker: 'Alice', text: 'Hello' }],
        speakers: ['Alice', 'Bob'],
        wordCount: 150,
        duration: 1800,
        meeting: {
          id: 'mtg-001',
          title: 'Sprint Planning',
          participants: ['Alice', 'Bob'],
          startTime: new Date('2026-03-01T10:00:00Z'),
          endTime: new Date('2026-03-01T10:30:00Z'),
          metadata: { type: 'standup' },
        },
      });

      const result = await findTool('read_transcript').execute({}, ctx);

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.meetingTitle).toBe('Sprint Planning');
      expect(data.speakers).toEqual(['Alice', 'Bob']);
      expect(data.wordCount).toBe(150);
      // sanitizeForAI passes through short text unchanged
      expect(data.fullText).toContain('Meeting discussion');
    });

    it('applies sanitizeForAI truncation on very long transcripts', async () => {
      const longText = 'A'.repeat(200_000); // exceeds 100K default
      prisma.transcript.findUnique.mockResolvedValue({
        fullText: longText,
        segments: [],
        speakers: [],
        wordCount: 200000,
        duration: 7200,
        meeting: {
          id: 'mtg-001',
          title: 'Long Meeting',
          participants: [],
          startTime: new Date(),
          endTime: new Date(),
          metadata: null,
        },
      });

      const result = await findTool('read_transcript').execute({}, ctx);

      expect(result.success).toBe(true);
      const data = result.data as any;
      // sanitizeForAI truncates to 100K + appends truncation note
      expect(data.fullText.length).toBeLessThan(200_000);
      expect(data.fullText).toContain('[Content truncated');
    });

    it('returns success:false when no meetingId in context.memory', async () => {
      const noMeetingCtx = makeContext({ memory: {} });

      const result = await findTool('read_transcript').execute(
        {},
        noMeetingCtx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No meetingId found');
    });

    it('returns success:false when transcript not found', async () => {
      prisma.transcript.findUnique.mockResolvedValue(null);

      const result = await findTool('read_transcript').execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No transcript found for meeting mtg-001');
    });

    it('returns success:false on database error', async () => {
      prisma.transcript.findUnique.mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await findTool('read_transcript').execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  // =========================================================================
  // recall_tenant_context
  // =========================================================================
  describe('recall_tenant_context', () => {
    it('returns memories from memory service', async () => {
      memoryService.getContext.mockResolvedValue([
        {
          category: 'preference',
          key: 'code-style',
          value: 'TypeScript strict',
          confidence: 0.9,
        },
      ]);

      const result = await findTool('recall_tenant_context').execute({}, ctx);

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.count).toBe(1);
      expect(data.memories[0].key).toBe('code-style');
    });

    it('passes categories filter when provided', async () => {
      memoryService.getContext.mockResolvedValue([]);

      await findTool('recall_tenant_context').execute(
        { categories: ['preference', 'convention'] },
        ctx,
      );

      expect(memoryService.getContext).toHaveBeenCalledWith('tenant-1', {
        categories: ['preference', 'convention'],
      });
    });

    it('returns empty array when no memories exist', async () => {
      memoryService.getContext.mockResolvedValue([]);

      const result = await findTool('recall_tenant_context').execute({}, ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).count).toBe(0);
    });

    it('returns success:false on memory service error', async () => {
      memoryService.getContext.mockRejectedValue(new Error('Qdrant timeout'));

      const result = await findTool('recall_tenant_context').execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Qdrant timeout');
    });
  });

  // =========================================================================
  // create_prd
  // =========================================================================
  describe('create_prd', () => {
    it('creates a PRD with complete data and returns success:true', async () => {
      prisma.pRD.create.mockResolvedValue({
        id: 'prd-001',
        title: 'Auth Feature',
        status: 'draft',
        confidence: 0.85,
      });

      const result = await findTool('create_prd').execute(
        {
          title: 'Auth Feature',
          summary: 'Add OAuth login',
          requirements: [
            {
              title: 'Google SSO',
              description: 'Users can sign in with Google',
              priority: 'P0',
              acceptanceCriteria: ['Redirect works', 'Token stored'],
            },
          ],
          objectives: ['Improve onboarding'],
          acceptanceCriteria: ['Users can log in via Google'],
          outOfScope: ['Apple sign-in'],
          assumptions: ['Google API available'],
          risks: [
            {
              description: 'Rate limits',
              impact: 'medium',
              mitigation: 'Cache tokens',
            },
          ],
          confidence: 0.85,
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as any).prdId).toBe('prd-001');
      expect((result.data as any).status).toBe('draft');
    });

    it('returns success:false when meetingId missing from context.memory', async () => {
      const noMeetingCtx = makeContext({
        memory: { taskId: 'task-001' },
      });

      const result = await findTool('create_prd').execute(
        { title: 'T', summary: 'S', requirements: [] },
        noMeetingCtx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No meetingId found');
    });

    it('returns success:false when taskId missing from context.memory', async () => {
      const noTaskCtx = makeContext({
        memory: { meetingId: 'mtg-001' },
      });

      const result = await findTool('create_prd').execute(
        { title: 'T', summary: 'S', requirements: [] },
        noTaskCtx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No taskId found');
    });

    it('returns success:false on Prisma error', async () => {
      prisma.pRD.create.mockRejectedValue(
        new Error('Foreign key constraint failed'),
      );

      const result = await findTool('create_prd').execute(
        { title: 'T', summary: 'S', requirements: [] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Foreign key constraint');
    });

    it('defaults optional arrays when not provided', async () => {
      prisma.pRD.create.mockResolvedValue({
        id: 'prd-002',
        title: 'Minimal PRD',
        status: 'draft',
        confidence: 0,
      });

      await findTool('create_prd').execute(
        { title: 'Minimal PRD', summary: 'Bare minimum', requirements: [] },
        ctx,
      );

      expect(prisma.pRD.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          objectives: [],
          acceptanceCriteria: [],
          outOfScope: [],
          assumptions: [],
          risks: [],
          confidence: 0,
        }),
      });
    });
  });

  // =========================================================================
  // ask_clarification
  // =========================================================================
  describe('ask_clarification', () => {
    it('creates clarification and sends via commsRouter', async () => {
      prisma.clarificationRequest.create.mockResolvedValue({
        id: 'clar-001',
      });

      const result = await findTool('ask_clarification').execute(
        {
          question: 'Should we use PostgreSQL or MySQL?',
          questionContext: 'The transcript mentioned both databases',
          routeTo: 'cto',
          urgency: 'high',
          options: ['PostgreSQL', 'MySQL'],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.clarificationId).toBe('clar-001');
      expect(data.routedTo).toBe('cto');
      expect(data.messageSent).toBe(true);
      expect(data.channel).toBe('gchat');
    });

    it('sends to correct role via commsRouter', async () => {
      prisma.clarificationRequest.create.mockResolvedValue({ id: 'c2' });

      await findTool('ask_clarification').execute(
        {
          question: 'Design question',
          questionContext: 'UI layout',
          routeTo: 'designer',
        },
        ctx,
      );

      expect(commsRouter.send).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          engagementId: 'eng-001',
          recipientRole: 'designer',
          messageType: 'clarification',
          urgency: 'medium', // default urgency
        }),
      );
    });

    it('returns success:false when taskId missing from context.memory', async () => {
      const noTaskCtx = makeContext({ memory: { meetingId: 'mtg-001' } });

      const result = await findTool('ask_clarification').execute(
        {
          question: 'Q',
          questionContext: 'C',
          routeTo: 'pm',
        },
        noTaskCtx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No taskId found');
    });

    it('returns success:false when commsRouter throws', async () => {
      prisma.clarificationRequest.create.mockResolvedValue({ id: 'c3' });
      commsRouter.send.mockRejectedValue(new Error('Slack webhook failed'));

      const result = await findTool('ask_clarification').execute(
        {
          question: 'Q',
          questionContext: 'C',
          routeTo: 'pm',
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Slack webhook failed');
    });

    it('creates clarification record with 24h expiry', async () => {
      prisma.clarificationRequest.create.mockResolvedValue({ id: 'c4' });

      const before = Date.now();
      await findTool('ask_clarification').execute(
        {
          question: 'Q',
          questionContext: 'C',
          routeTo: 'pm',
        },
        ctx,
      );
      const after = Date.now();

      const createCall = prisma.clarificationRequest.create.mock.calls[0][0];
      const expiresAt = createCall.data.expiresAt as Date;
      const expiryMs = expiresAt.getTime();

      // Expiry should be ~24h from now
      expect(expiryMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000);
      expect(expiryMs).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 1000);
    });
  });

  // =========================================================================
  // check_existing_backlog
  // =========================================================================
  describe('check_existing_backlog', () => {
    it('returns matching PRDs', async () => {
      prisma.pRD.findMany.mockResolvedValue([
        {
          id: 'prd-old',
          title: 'Auth System',
          summary: 'OAuth implementation for the platform with Google sign-in support',
          status: 'approved',
          confidence: 0.9,
          version: 2,
          createdAt: new Date('2026-02-01'),
        },
      ]);

      const result = await findTool('check_existing_backlog').execute(
        { searchTerms: ['auth', 'login'] },
        ctx,
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.count).toBe(1);
      expect(data.prds[0].title).toBe('Auth System');
      // Summary should be truncated to 200 chars
      expect(data.prds[0].summary.length).toBeLessThanOrEqual(200);
    });

    it('returns empty results when no matches', async () => {
      prisma.pRD.findMany.mockResolvedValue([]);

      const result = await findTool('check_existing_backlog').execute(
        { searchTerms: ['nonexistent'] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as any).count).toBe(0);
    });

    it('uses tenant scoping from context', async () => {
      prisma.pRD.findMany.mockResolvedValue([]);

      await findTool('check_existing_backlog').execute(
        { searchTerms: ['test'] },
        makeContext({ tenantId: 'other-tenant' }),
      );

      expect(prisma.pRD.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'other-tenant',
          }),
        }),
      );
    });

    it('respects custom limit', async () => {
      prisma.pRD.findMany.mockResolvedValue([]);

      await findTool('check_existing_backlog').execute(
        { searchTerms: ['test'], limit: 5 },
        ctx,
      );

      expect(prisma.pRD.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('defaults limit to 10', async () => {
      prisma.pRD.findMany.mockResolvedValue([]);

      await findTool('check_existing_backlog').execute(
        { searchTerms: ['test'] },
        ctx,
      );

      expect(prisma.pRD.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it('returns success:false on Prisma error', async () => {
      prisma.pRD.findMany.mockRejectedValue(new Error('Query timeout'));

      const result = await findTool('check_existing_backlog').execute(
        { searchTerms: ['test'] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Query timeout');
    });

    it('generates OR conditions for each search term across title and summary', async () => {
      prisma.pRD.findMany.mockResolvedValue([]);

      await findTool('check_existing_backlog').execute(
        { searchTerms: ['auth', 'login', 'sso'] },
        ctx,
      );

      const callArgs = prisma.pRD.findMany.mock.calls[0][0];
      const orConditions = callArgs.where.OR;

      // 3 terms x 2 fields (title + summary) = 6 conditions
      expect(orConditions).toHaveLength(6);
      expect(orConditions[0]).toEqual({
        title: { contains: 'auth', mode: 'insensitive' },
      });
      expect(orConditions[1]).toEqual({
        summary: { contains: 'auth', mode: 'insensitive' },
      });
    });
  });

  // =========================================================================
  // General
  // =========================================================================
  describe('tool metadata', () => {
    it('creates exactly 5 tools', () => {
      expect(tools).toHaveLength(5);
    });

    it('has correct tool names', () => {
      const names = tools.map((t) => t.name);
      expect(names).toEqual([
        'read_transcript',
        'recall_tenant_context',
        'create_prd',
        'ask_clarification',
        'check_existing_backlog',
      ]);
    });
  });
});
