/**
 * =============================================================================
 * INTEGRATION TEST — Full Engagement Lifecycle
 * =============================================================================
 *
 * Verifies the end-to-end flow:
 *   webhook → supervisor → meeting brain → BA agent → Dev agent → QA agent
 *
 * This is a UNIT-level integration test: external dependencies (Prisma, Redis,
 * model APIs) are mocked, but the real wiring between services and agents is
 * tested — EngagementService state machine, agent tool dispatch, review panel
 * confidence gating, and phase transitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { EngagementService } from '../../services/engagement/engagement.service.js';
import { MeetingBrainAgent } from '../../services/agents/meeting-brain/meeting-brain.agent.js';
import { BAAgent } from '../../services/agents/ba/ba.agent.js';
import { DevAgent } from '../../services/agents/dev/dev.agent.js';
import { QAAgent } from '../../services/agents/qa/qa.agent.js';
import { SupervisorAgent } from '../../services/agents/supervisor/supervisor.agent.js';
import { ReviewPanel } from '../../services/agent-runtime/review-panel.js';
import type { ModelClient } from '../../services/agent-runtime/types.js';
import {
  PHASE_ORDER,
  PHASE_AGENT_MAP,
  VALID_TRANSITIONS,
} from '../../services/engagement/engagement.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a model-client chat response (shorthand for repetitive mock setup). */
function chatResponse(
  content: string,
  toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [],
  stopReason: 'end_turn' | 'tool_use' = toolCalls.length > 0 ? 'tool_use' : 'end_turn',
) {
  return {
    content,
    toolCalls,
    tokenUsage: { input: 100, output: 50 },
    stopReason,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Engagement Flow Integration', () => {
  // Shared mocks
  let mockPrisma: any;
  let mockModelClient: ModelClient;
  let mockCommsRouter: any;
  let mockMemoryService: any;
  let mockModelRegistry: any;
  let mockQueueService: any;
  let engagementService: EngagementService;

  // Track the "database" state for engagement in-memory
  let engagementStore: Record<string, any>;

  beforeEach(() => {
    engagementStore = {};

    // ---- Prisma mock (engagement + agent-related tables) ----
    mockPrisma = {
      engagement: {
        create: vi.fn().mockImplementation(({ data }: any) => {
          const eng = { id: `eng-${Date.now()}`, ...data, createdAt: new Date() };
          engagementStore[eng.id] = eng;
          return Promise.resolve(eng);
        }),
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          const eng = Object.values(engagementStore).find(
            (e: any) => e.id === where.id && e.tenantId === where.tenantId,
          );
          return Promise.resolve(eng ?? null);
        }),
        findUnique: vi.fn().mockImplementation(({ where }: any) => {
          return Promise.resolve(engagementStore[where.id] ?? null);
        }),
        updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
          const eng = Object.values(engagementStore).find(
            (e: any) => e.id === where.id && e.tenantId === where.tenantId,
          );
          if (!eng) return Promise.resolve({ count: 0 });
          Object.assign(eng, data);
          return Promise.resolve({ count: 1 });
        }),
        findMany: vi.fn().mockImplementation(({ where }: any) => {
          const results = Object.values(engagementStore).filter((e: any) => {
            if (e.tenantId !== where.tenantId) return false;
            if (where.status && e.status !== where.status) return false;
            return true;
          });
          return Promise.resolve(results);
        }),
      },
      transcript: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      meetingInsights: {
        create: vi.fn().mockImplementation(({ data }: any) => {
          return Promise.resolve({ id: `summary-${Date.now()}`, ...data });
        }),
      },
      tenantMemory: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      teamMember: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      messageLog: {
        create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      },
    };

    // ---- Model client (overridden per test) ----
    mockModelClient = { chat: vi.fn() };

    // ---- Communication router ----
    mockCommsRouter = {
      send: vi.fn().mockResolvedValue({ success: true, messageLogId: 'msg-1', channel: 'gchat' }),
    };

    // ---- Memory service ----
    mockMemoryService = {
      remember: vi.fn().mockResolvedValue(undefined),
      recall: vi.fn().mockResolvedValue(null),
      getContext: vi.fn().mockResolvedValue([]),
      forget: vi.fn().mockResolvedValue(undefined),
    };

    // ---- Model registry ----
    mockModelRegistry = {
      resolveModel: vi.fn().mockResolvedValue({
        modelId: 'test-model',
        provider: 'test',
        confidenceThreshold: 0.85,
        maxSteps: 25,
      }),
    };

    // ---- Queue service ----
    mockQueueService = {
      addJob: vi.fn().mockResolvedValue('job-1'),
    };

    // ---- Engagement service (uses the in-memory Prisma mock) ----
    engagementService = new EngagementService(mockPrisma);
  });

  // =========================================================================
  // 1. Full lifecycle test
  // =========================================================================

  it('should complete full engagement lifecycle: listen -> understand -> analyze_ask -> approve -> build -> test -> ship -> learn', async () => {
    const tenantId = 'tenant-integration';

    // --- Step 1: Create engagement (starts at "listen") ---
    const engagement = await engagementService.create(tenantId, {
      title: 'Sprint Planning',
      meetingId: 'mtg-1',
    });

    expect(engagement.phase).toBe('listen');
    expect(engagement.status).toBe('active');
    expect(engagement.agentType).toBe('meeting_brain');

    const engId = engagement.id;

    // --- Step 2: MeetingBrainAgent processes transcript (listen phase) ---
    const meetingBrain = new MeetingBrainAgent(
      mockModelClient,
      mockPrisma,
      mockMemoryService,
      mockModelRegistry,
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce(chatResponse(
        'Analyzing transcript.',
        [{ name: 'analyze_transcript', input: { transcript: 'Alice: We need OAuth.\nBob: Agreed.' } }],
      ))
      .mockResolvedValueOnce(chatResponse(
        'Identifying participants.',
        [{ name: 'identify_participants', input: { participants: [{ name: 'Alice', role: 'PM', confidence: 0.9 }, { name: 'Bob', role: 'Engineer', confidence: 0.85 }] } }],
      ))
      .mockResolvedValueOnce(chatResponse(
        'Extracting decisions.',
        [{ name: 'extract_decisions', input: { decisions: [{ description: 'Implement OAuth', madeBy: 'Alice', context: 'Auth strategy', confidence: 0.92 }] } }],
      ))
      .mockResolvedValueOnce(chatResponse(
        'Extracting action items.',
        [{ name: 'extract_action_items', input: { actionItems: [{ description: 'Implement OAuth backend', assignee: 'Bob', deadline: '2026-03-15', priority: 'high' }] } }],
      ))
      .mockResolvedValueOnce(chatResponse(
        'Creating summary.',
        [{ name: 'create_meeting_summary', input: { title: 'Sprint Planning', topics: ['OAuth'], keyPoints: ['Need OAuth by March 15'], participants: [{ name: 'Alice', role: 'PM' }], decisions: [{ description: 'Implement OAuth', madeBy: 'Alice', context: 'Auth' }], actionItems: [{ description: 'Build OAuth', assignee: 'Bob', priority: 'high' }], followUps: [], confidence: 0.92 } }],
      ))
      .mockResolvedValueOnce(chatResponse(
        'Meeting processed successfully. Confidence: 0.92',
      ));

    const mbResult = await meetingBrain.processTranscript(
      tenantId, 'mtg-1', 'Alice: We need OAuth.\nBob: Agreed.', engId,
    );

    expect(mbResult.success).toBe(true);
    expect(mbResult.confidence).toBe(0.92);

    // --- Step 3: Advance listen -> understand ---
    const afterListen = await engagementService.advancePhase(tenantId, engId, {
      confidence: mbResult.confidence,
    });
    expect(afterListen.phase).toBe('understand');
    expect(afterListen.agentType).toBe('meeting_brain');

    // --- Step 4: Advance understand -> analyze_ask ---
    const afterUnderstand = await engagementService.advancePhase(tenantId, engId, {
      confidence: 0.88,
    });
    expect(afterUnderstand.phase).toBe('analyze_ask');
    expect(afterUnderstand.agentType).toBe('ba_agent');

    // --- Step 5: BAAgent generates PRD (analyze_ask phase) ---
    const baAgent = new BAAgent(
      mockModelClient,
      mockPrisma,
      mockCommsRouter,
      mockMemoryService,
      mockModelRegistry,
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce(chatResponse(
        'PRD generated successfully with all requirements documented. Confidence: 0.88',
      ));

    const baResult = await baAgent.processTranscript(tenantId, 'mtg-1', engId, 'task-1');

    expect(baResult.success).toBe(true);
    expect(baResult.confidence).toBe(0.88);

    // --- Step 6: Advance analyze_ask -> approve ---
    const afterAnalyze = await engagementService.advancePhase(tenantId, engId, {
      confidence: baResult.confidence,
    });
    expect(afterAnalyze.phase).toBe('approve');
    expect(afterAnalyze.agentType).toBeNull(); // Human approval phase

    // --- Step 7: Human approval -> advance approve -> build ---
    const afterApprove = await engagementService.advancePhase(tenantId, engId, {
      confidence: 0.95,
    });
    expect(afterApprove.phase).toBe('build');
    expect(afterApprove.agentType).toBe('dev_agent');

    // --- Step 8: DevAgent implements PRD (build phase) ---
    const devAgent = new DevAgent(
      mockModelClient,
      mockPrisma,
      mockMemoryService,
      mockModelRegistry,
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce(chatResponse(
        'Implementation complete. All code written and PR created. Confidence: 0.91',
      ));

    const devResult = await devAgent.implementPrd(tenantId, 'prd-1', engId, 'task-2');

    expect(devResult.success).toBe(true);
    expect(devResult.confidence).toBe(0.91);

    // --- Step 9: Advance build -> test ---
    const afterBuild = await engagementService.advancePhase(tenantId, engId, {
      confidence: devResult.confidence,
    });
    expect(afterBuild.phase).toBe('test');
    expect(afterBuild.agentType).toBe('qa_agent');

    // --- Step 10: QAAgent validates (test phase) ---
    const qaAgent = new QAAgent(
      mockModelClient,
      mockPrisma,
      mockCommsRouter,
      mockMemoryService,
      mockModelRegistry,
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce(chatResponse(
        'All tests pass, coverage meets requirements. No regressions found. Confidence: 0.93',
      ));

    const qaResult = await qaAgent.validatePr(tenantId, 'prd-1', 42, engId, 'task-3');

    expect(qaResult.success).toBe(true);
    expect(qaResult.confidence).toBe(0.93);

    // --- Step 11: Advance test -> ship ---
    const afterTest = await engagementService.advancePhase(tenantId, engId, {
      confidence: qaResult.confidence,
    });
    expect(afterTest.phase).toBe('ship');
    expect(afterTest.agentType).toBeNull(); // Human-triggered

    // --- Step 12: Advance ship -> learn ---
    const afterShip = await engagementService.advancePhase(tenantId, engId, {
      confidence: 0.95,
    });
    expect(afterShip.phase).toBe('learn');
    expect(afterShip.agentType).toBe('memory_optimizer');

    // --- Verify: engagement completed the full lifecycle ---
    const finalEng = engagementStore[engId];
    expect(finalEng.phase).toBe('learn');
  });

  // =========================================================================
  // 2. Create engagement from webhook meeting data
  // =========================================================================

  it('should create engagement from webhook meeting data', async () => {
    const engagement = await engagementService.create('tenant-1', {
      title: 'Product Roadmap Review',
      meetingId: 'mtg-webhook-42',
      metadata: { source: 'recall_webhook', duration: 3600 },
    });

    expect(engagement.phase).toBe('listen');
    expect(engagement.status).toBe('active');
    expect(engagement.confidence).toBe(0);
    expect(engagement.agentType).toBe('meeting_brain');
    expect(engagement.meetingId).toBe('mtg-webhook-42');
    expect(engagement.metadata).toEqual({ source: 'recall_webhook', duration: 3600 });
  });

  // =========================================================================
  // 3. Advance through all 8 phases in order
  // =========================================================================

  it('should advance through all 8 phases in order', async () => {
    const tenantId = 'tenant-phases';

    const engagement = await engagementService.create(tenantId, {
      title: 'Phase Walk',
      meetingId: 'mtg-phases',
    });
    const engId = engagement.id;

    // Walk through all 7 transitions (listen->understand->...->learn)
    const expectedPhases = PHASE_ORDER.slice(1); // skip 'listen' (already there)

    for (const expectedPhase of expectedPhases) {
      const result = await engagementService.advancePhase(tenantId, engId, {
        confidence: 0.9, // above threshold
      });
      expect(result.phase).toBe(expectedPhase);
      expect(result.agentType).toBe(PHASE_AGENT_MAP[expectedPhase]);
    }

    // Verify final state
    const final = engagementStore[engId];
    expect(final.phase).toBe('learn');
  });

  // =========================================================================
  // 4. Confidence gating blocks advancement
  // =========================================================================

  it('should block phase advancement when confidence is below threshold', async () => {
    const tenantId = 'tenant-gating';

    const engagement = await engagementService.create(tenantId, {
      title: 'Gating Test',
      meetingId: 'mtg-gate',
    });
    const engId = engagement.id;

    // Try to advance with low confidence (below 0.5 threshold)
    const result = await engagementService.advancePhase(tenantId, engId, {
      confidence: 0.3,
    });

    // Should be paused, NOT advanced
    expect(result.status).toBe('paused');
    expect(result.phase).toBe('listen'); // stays in listen
    expect(result.confidence).toBe(0.3);

    // Verify it cannot advance while paused
    await expect(
      engagementService.advancePhase(tenantId, engId, { confidence: 0.9 }),
    ).rejects.toThrow('paused');
  });

  // =========================================================================
  // 5. Correct agent dispatched for each phase
  // =========================================================================

  it('should dispatch correct agent for each phase', () => {
    // Verify the PHASE_AGENT_MAP is correctly defined
    expect(PHASE_AGENT_MAP.listen).toBe('meeting_brain');
    expect(PHASE_AGENT_MAP.understand).toBe('meeting_brain');
    expect(PHASE_AGENT_MAP.analyze_ask).toBe('ba_agent');
    expect(PHASE_AGENT_MAP.approve).toBeNull();
    expect(PHASE_AGENT_MAP.build).toBe('dev_agent');
    expect(PHASE_AGENT_MAP.test).toBe('qa_agent');
    expect(PHASE_AGENT_MAP.ship).toBeNull();
    expect(PHASE_AGENT_MAP.learn).toBe('memory_optimizer');

    // Verify agents have the correct agentType
    const meetingBrain = new MeetingBrainAgent(mockModelClient, mockPrisma, mockMemoryService);
    expect(meetingBrain.agentType).toBe('meeting_brain');

    const baAgent = new BAAgent(mockModelClient, mockPrisma, mockCommsRouter, mockMemoryService);
    expect(baAgent.agentType).toBe('ba_agent');

    const devAgent = new DevAgent(mockModelClient, mockPrisma, mockMemoryService);
    expect(devAgent.agentType).toBe('dev_agent');

    const qaAgent = new QAAgent(mockModelClient, mockPrisma, mockCommsRouter, mockMemoryService);
    expect(qaAgent.agentType).toBe('qa_agent');
  });

  // =========================================================================
  // 6. Supervisor creates engagement and dispatches meeting brain
  // =========================================================================

  it('should have supervisor create engagement and dispatch meeting_brain via tools', async () => {
    const supervisor = new SupervisorAgent(
      mockModelClient,
      engagementService,
      mockModelRegistry,
      mockQueueService,
    );

    (mockModelClient.chat as any)
      // Step 1: supervisor creates engagement
      .mockResolvedValueOnce(chatResponse(
        'Creating engagement for Sprint Planning meeting.',
        [{ name: 'create_engagement', input: { title: 'Sprint Planning', meetingId: 'mtg-sv-1' } }],
      ))
      // Step 2: supervisor dispatches meeting_brain
      .mockResolvedValueOnce(chatResponse(
        'Dispatching meeting_brain agent.',
        [{ name: 'dispatch_agent', input: { engagementId: Object.keys(engagementStore)[0] || 'eng-1', agentType: 'meeting_brain', task: 'Process transcript' } }],
      ))
      // Step 3: done
      .mockResolvedValueOnce(chatResponse(
        'Engagement created and meeting_brain dispatched. Confidence: 0.95',
      ));

    const result = await supervisor.handleMeetingCompleted(
      'tenant-sv',
      'mtg-sv-1',
      'Sprint Planning',
    );

    expect(result.success).toBe(true);
    expect(result.confidence).toBe(0.95);
    expect(result.steps[0].toolName).toBe('create_engagement');
    expect(result.steps[1].toolName).toBe('dispatch_agent');

    // Verify engagement was actually created in the store
    const engagements = Object.values(engagementStore);
    expect(engagements.length).toBe(1);
    expect((engagements[0] as any).title).toBe('Sprint Planning');
    expect((engagements[0] as any).phase).toBe('listen');
  });

  // =========================================================================
  // 7. Review panel pauses engagement when all reviewers < 50%
  // =========================================================================

  it('should pause engagement when review panel returns all < 50%', async () => {
    // Set up reviewer model clients that return low confidence
    const lowConfidenceClient: ModelClient = {
      chat: vi.fn()
        .mockResolvedValueOnce({
          content: 'The output is poor quality.\nConfidence: 0.20\nFeedback: Missing key requirements.',
          toolCalls: [],
          tokenUsage: { input: 100, output: 50 },
          stopReason: 'end_turn' as const,
        })
        .mockResolvedValueOnce({
          content: 'Significant gaps found.\nConfidence: 0.30\nFeedback: Incomplete analysis.',
          toolCalls: [],
          tokenUsage: { input: 100, output: 50 },
          stopReason: 'end_turn' as const,
        }),
    };

    const modelClients = new Map<string, ModelClient>();
    modelClients.set('reviewer-a', lowConfidenceClient);
    modelClients.set('reviewer-b', lowConfidenceClient);

    const reviewPanel = new ReviewPanel(modelClients);

    const reviewResult = await reviewPanel.review({
      agentOutput: 'Some questionable output',
      confidence: 0.5, // below 0.7 -> full panel
      reviewers: [
        { provider: 'reviewer-a', modelId: 'model-a' },
        { provider: 'reviewer-b', modelId: 'model-b' },
      ],
      confidenceThreshold: 0.7,
      context: 'Sprint planning transcript analysis',
    });

    // All reviewers below 50% -> engagement should be flagged for pause
    expect(reviewResult.engagementPaused).toBe(true);
    expect(reviewResult.approved).toBe(false);
    expect(reviewResult.pauseReason).toContain('below 50%');
    expect(reviewResult.skippedReview).toBe(false);
    expect(reviewResult.reviews.length).toBe(2);

    // Now apply the pause to an actual engagement
    const tenantId = 'tenant-review';
    const engagement = await engagementService.create(tenantId, {
      title: 'Review Pause Test',
      meetingId: 'mtg-rp',
    });

    if (reviewResult.engagementPaused) {
      const paused = await engagementService.pause(
        tenantId,
        engagement.id,
        reviewResult.pauseReason,
      );
      expect(paused.status).toBe('paused');
    }

    // Verify engagement is actually paused in the store
    expect(engagementStore[engagement.id].status).toBe('paused');
  });

  // =========================================================================
  // 8. Review panel auto-passes high confidence
  // =========================================================================

  it('should auto-pass review when agent confidence >= 0.9', async () => {
    const reviewPanel = new ReviewPanel(new Map());

    const reviewResult = await reviewPanel.review({
      agentOutput: 'Excellent output',
      confidence: 0.95,
      reviewers: [{ provider: 'reviewer-a', modelId: 'model-a' }],
      confidenceThreshold: 0.7,
      context: 'Test context',
    });

    expect(reviewResult.approved).toBe(true);
    expect(reviewResult.skippedReview).toBe(true);
    expect(reviewResult.reviews.length).toBe(0);
    expect(reviewResult.engagementPaused).toBe(false);
    expect(reviewResult.finalConfidence).toBe(0.95);
  });

  // =========================================================================
  // 9. Agent failure does not corrupt engagement state
  // =========================================================================

  it('should handle agent failure gracefully without losing engagement state', async () => {
    const tenantId = 'tenant-failure';

    const engagement = await engagementService.create(tenantId, {
      title: 'Failure Test',
      meetingId: 'mtg-fail',
    });
    const engId = engagement.id;

    // Advance to understand first
    await engagementService.advancePhase(tenantId, engId, { confidence: 0.85 });
    expect(engagementStore[engId].phase).toBe('understand');

    // Now simulate an agent that throws during execution
    const failingModelClient: ModelClient = {
      chat: vi.fn().mockRejectedValue(new Error('Model API unavailable')),
    };

    const meetingBrain = new MeetingBrainAgent(
      failingModelClient,
      mockPrisma,
      mockMemoryService,
      mockModelRegistry,
    );

    // The agent should throw, but engagement state should remain intact
    await expect(
      meetingBrain.processTranscript(tenantId, 'mtg-fail', 'Some transcript', engId),
    ).rejects.toThrow('Model API unavailable');

    // Verify engagement is still in "understand" phase, not corrupted
    expect(engagementStore[engId].phase).toBe('understand');
    expect(engagementStore[engId].status).toBe('active');
  });

  // =========================================================================
  // 10. Valid transitions are enforced
  // =========================================================================

  it('should reject invalid phase transitions', async () => {
    const tenantId = 'tenant-invalid';

    const engagement = await engagementService.create(tenantId, {
      title: 'Invalid Transition Test',
      meetingId: 'mtg-inv',
    });
    const engId = engagement.id;

    // Try to skip from listen directly to build
    await expect(
      engagementService.advancePhase(tenantId, engId, {
        targetPhase: 'build',
        confidence: 0.9,
      }),
    ).rejects.toThrow('Invalid transition');

    // Try to skip from listen directly to test
    await expect(
      engagementService.advancePhase(tenantId, engId, {
        targetPhase: 'test',
        confidence: 0.9,
      }),
    ).rejects.toThrow('Invalid transition');

    // Try to go backward from listen to learn (which is valid via the cycle,
    // but only from 'learn' -> 'listen', not 'listen' -> 'learn')
    await expect(
      engagementService.advancePhase(tenantId, engId, {
        targetPhase: 'learn',
        confidence: 0.9,
      }),
    ).rejects.toThrow('Invalid transition');

    // Engagement should still be in listen (no corruption)
    expect(engagementStore[engId].phase).toBe('listen');
  });

  // =========================================================================
  // 11. VALID_TRANSITIONS covers all consecutive phase pairs
  // =========================================================================

  it('should have valid transitions for all consecutive phases', () => {
    for (let i = 0; i < PHASE_ORDER.length - 1; i++) {
      const from = PHASE_ORDER[i];
      const to = PHASE_ORDER[i + 1];
      const transition = VALID_TRANSITIONS.find(
        (t) => t.from === from && t.to === to,
      );
      expect(
        transition,
        `Missing transition from '${from}' to '${to}'`,
      ).toBeDefined();
    }

    // Also verify the cycle transition: learn -> listen
    const cycleTransition = VALID_TRANSITIONS.find(
      (t) => t.from === 'learn' && t.to === 'listen',
    );
    expect(cycleTransition).toBeDefined();
  });

  // =========================================================================
  // 12. Meeting brain output feeds into BA agent context
  // =========================================================================

  it('should wire meeting brain output through engagement to BA agent', async () => {
    const tenantId = 'tenant-wire';

    // Create and walk to analyze_ask phase
    const engagement = await engagementService.create(tenantId, {
      title: 'Wiring Test',
      meetingId: 'mtg-wire',
    });
    const engId = engagement.id;

    // Meeting brain runs and stores output via memory service
    const meetingBrain = new MeetingBrainAgent(
      mockModelClient,
      mockPrisma,
      mockMemoryService,
      mockModelRegistry,
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce(chatResponse(
        'Extracting decisions.',
        [{ name: 'extract_decisions', input: { decisions: [{ description: 'Use OAuth', madeBy: 'Alice', context: 'Auth discussion', confidence: 0.95 }] } }],
      ))
      .mockResolvedValueOnce(chatResponse(
        'Meeting brain analysis complete. Confidence: 0.90',
      ));

    await meetingBrain.processTranscript(tenantId, 'mtg-wire', 'Alice: Use OAuth.', engId);

    // Verify decisions were stored in memory
    expect(mockMemoryService.remember).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        key: 'meeting_decisions_mtg-wire',
        category: 'decision',
      }),
    );

    // Advance to analyze_ask phase
    await engagementService.advancePhase(tenantId, engId, { confidence: 0.9 });
    await engagementService.advancePhase(tenantId, engId, { confidence: 0.9 });
    expect(engagementStore[engId].phase).toBe('analyze_ask');

    // BA agent runs — it will call memory service to get context
    const baAgent = new BAAgent(
      mockModelClient,
      mockPrisma,
      mockCommsRouter,
      mockMemoryService,
      mockModelRegistry,
    );

    (mockModelClient.chat as any)
      .mockResolvedValueOnce(chatResponse(
        'PRD created based on meeting decisions. Confidence: 0.85',
      ));

    const baResult = await baAgent.processTranscript(tenantId, 'mtg-wire', engId, 'task-wire');
    expect(baResult.success).toBe(true);
  });

  // =========================================================================
  // 13. Supervisor dispatches agents through queue service
  // =========================================================================

  it('should dispatch agents via queue service for each agent type', async () => {
    const supervisor = new SupervisorAgent(
      mockModelClient,
      engagementService,
      mockModelRegistry,
      mockQueueService,
    );

    // Test dispatch_agent tool directly for ba_agent
    const dispatchTool = supervisor.tools.find((t: any) => t.name === 'dispatch_agent')!;

    const baDispatch = await dispatchTool.execute(
      {
        engagementId: 'eng-dispatch',
        agentType: 'ba_agent',
        task: 'Generate PRD',
        meetingId: 'mtg-d1',
        transcript: 'Meeting text',
        taskId: 'task-d1',
      },
      {
        tenantId: 'tenant-dispatch',
        engagementId: 'eng-dispatch',
        agentType: 'supervisor',
        traceId: 'tr-dispatch',
        memory: {},
      },
    );

    expect(baDispatch.success).toBe(true);
    expect((baDispatch.data as any).agentType).toBe('ba_agent');
    expect((baDispatch.data as any).queue).toBe('ba_agent_process');

    // Test dispatch for dev_agent (goes through notification placeholder)
    const devDispatch = await dispatchTool.execute(
      {
        engagementId: 'eng-dispatch',
        agentType: 'dev_agent',
        task: 'Implement feature',
      },
      {
        tenantId: 'tenant-dispatch',
        engagementId: 'eng-dispatch',
        agentType: 'supervisor',
        traceId: 'tr-dispatch',
        memory: {},
      },
    );

    expect(devDispatch.success).toBe(true);
    expect((devDispatch.data as any).agentType).toBe('dev_agent');
    expect((devDispatch.data as any).queue).toBe('dev_agent_process');

    // Test dispatch for qa_agent
    const qaDispatch = await dispatchTool.execute(
      {
        engagementId: 'eng-dispatch',
        agentType: 'qa_agent',
        task: 'Validate PR',
      },
      {
        tenantId: 'tenant-dispatch',
        engagementId: 'eng-dispatch',
        agentType: 'supervisor',
        traceId: 'tr-dispatch',
        memory: {},
      },
    );

    expect(qaDispatch.success).toBe(true);
    expect((qaDispatch.data as any).agentType).toBe('qa_agent');
  });

  // =========================================================================
  // 14. Engagement resumes after pause and can advance
  // =========================================================================

  it('should resume a paused engagement and continue advancing', async () => {
    const tenantId = 'tenant-resume';

    const engagement = await engagementService.create(tenantId, {
      title: 'Resume Test',
      meetingId: 'mtg-resume',
    });
    const engId = engagement.id;

    // Pause due to low confidence
    await engagementService.advancePhase(tenantId, engId, { confidence: 0.3 });
    expect(engagementStore[engId].status).toBe('paused');

    // Resume the engagement
    await engagementService.resume(tenantId, engId);
    expect(engagementStore[engId].status).toBe('active');

    // Now advance with high confidence
    const advanced = await engagementService.advancePhase(tenantId, engId, {
      confidence: 0.9,
    });
    expect(advanced.phase).toBe('understand');
  });

  // =========================================================================
  // 15. Phase-agent mapping covers all phases
  // =========================================================================

  it('should have agent mapping for all 8 phases', () => {
    for (const phase of PHASE_ORDER) {
      expect(phase in PHASE_AGENT_MAP).toBe(true);
    }

    // Exactly 8 phases
    expect(PHASE_ORDER.length).toBe(8);
    expect(Object.keys(PHASE_AGENT_MAP).length).toBe(8);
  });
});
