import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConversationOrchestratorService,
  AGENT_PERSONAS,
} from '../conversation-orchestrator.service.js';
import { AgentDispatcherService } from '../../agent-dispatcher/agent-dispatcher.service.js';

function makePrisma(opts: {
  existingThread?: { id: string } | null;
  recentTurns?: Array<{ speaker: string; createdAt: Date }>;
  contextTurns?: Array<{ speaker: string; text: string }>;
  /** Set of PRD ids in this tenant that resolvePurposeFromText should find. */
  prdIds?: Set<string>;
  /** Set of engagement ids in this tenant that resolvePurposeFromText should find. */
  engagementIds?: Set<string>;
} = {}) {
  const threads = new Map<string, Record<string, unknown>>();
  const turns: Array<Record<string, unknown>> = [];

  const prisma = {
    conversationThread: {
      findUnique: vi.fn(async ({ where: _where }: { where: unknown }) => opts.existingThread ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `thread-${threads.size + 1}`;
        const row = { id, ...data };
        threads.set(id, row);
        return row;
      }),
      update: vi.fn(async ({ where }: { where: { id: string } }) => {
        return threads.get(where.id) ?? null;
      }),
    },
    conversationTurn: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `turn-${turns.length + 1}`, ...data, createdAt: new Date() };
        turns.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ orderBy: _o, take }: { orderBy: unknown; take: number }) => {
        if (opts.contextTurns) return opts.contextTurns.slice(0, take).reverse();
        if (opts.recentTurns) return opts.recentTurns.slice(0, take);
        return [];
      }),
    },
    // Used by resolvePurposeFromText. Returns { id } only if the id is in
    // our in-memory tenant set, matching prisma's findFirst semantics.
    pRD: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        return opts.prdIds?.has(where.id) ? { id: where.id } : null;
      }),
    },
    engagement: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        return opts.engagementIds?.has(where.id) ? { id: where.id } : null;
      }),
    },
  };
  return { prisma, turns };
}

function makeGemini(opts: { disabled?: boolean; text?: string; throws?: boolean } = {}) {
  return {
    disabled: opts.disabled ?? false,
    generateFreeformText: vi.fn(async () => {
      if (opts.throws) throw new Error('gemini boom');
      return opts.text ?? 'stub agent reply';
    }),
  } as unknown as import('../../ai/gemini.service.js').GeminiService;
}

function makeDispatcher(reply = 'dispatcher fallback'): AgentDispatcherService {
  return {
    dispatch: vi.fn(async () => ({ handled: true, agent: 'help', reply })),
  } as unknown as AgentDispatcherService;
}

describe('ConversationOrchestratorService.detectHandoffs', () => {
  it('finds @dev / @ba / @qa references', () => {
    expect(
      ConversationOrchestratorService.detectHandoffs('handing off to @dev and also @qa please'),
    ).toEqual(['dev', 'qa']);
  });

  it('dedupes when the same handle appears twice', () => {
    expect(
      ConversationOrchestratorService.detectHandoffs('@dev @dev @dev'),
    ).toEqual(['dev']);
  });

  it('excludes the agent @mentioning itself', () => {
    const out = ConversationOrchestratorService.detectHandoffs('I am @ba, also @dev', 'ba');
    expect(out).toEqual(['dev']);
  });

  it('returns empty when there are no handoffs', () => {
    expect(ConversationOrchestratorService.detectHandoffs('just thinking')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(ConversationOrchestratorService.detectHandoffs('ping @DEV @Qa')).toEqual(['dev', 'qa']);
  });
});

describe('ConversationOrchestratorService.formatForChannel', () => {
  it('returns slack username + icon for slack', () => {
    const out = ConversationOrchestratorService.formatForChannel('ba', 'hello', 'slack');
    expect(out).toEqual({
      text: 'hello',
      username: 'Workforce0 BA',
      iconEmoji: AGENT_PERSONAS.ba.emoji,
    });
  });

  it('prefixes WhatsApp with emoji + name', () => {
    const out = ConversationOrchestratorService.formatForChannel('dev', 'hi', 'whatsapp');
    expect(out.text).toBe(`${AGENT_PERSONAS.dev.emoji} Dev: hi`);
  });

  it('passes help replies through unchanged', () => {
    const out = ConversationOrchestratorService.formatForChannel('help', 'cmds', 'slack');
    expect(out).toEqual({ text: 'cmds' });
  });
});

describe('ConversationOrchestratorService.findOrCreateThread', () => {
  it('creates a thread the first time', async () => {
    const { prisma } = makePrisma({ existingThread: null });
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );
    const r = await svc.findOrCreateThread({
      tenantId: 't-1',
      channel: 'slack',
      channelRef: 'C-abc',
    });
    expect(r.created).toBe(true);
    expect(prisma.conversationThread.create).toHaveBeenCalled();
  });

  it('reuses an existing thread and bumps lastActivityAt', async () => {
    const { prisma } = makePrisma({ existingThread: { id: 'existing-1' } });
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );
    const r = await svc.findOrCreateThread({
      tenantId: 't-1',
      channel: 'slack',
      channelRef: 'C-abc',
    });
    expect(r).toEqual({ id: 'existing-1', created: false });
    expect(prisma.conversationThread.create).not.toHaveBeenCalled();
    expect(prisma.conversationThread.update).toHaveBeenCalled();
  });
});

describe('ConversationOrchestratorService.shouldBlock', () => {
  it('returns null on an empty history', async () => {
    const { prisma } = makePrisma({ recentTurns: [] });
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );
    expect(await svc.shouldBlock('t-1')).toBeNull();
  });

  it('blocks runaway loops (last 2 turns both agents)', async () => {
    const now = new Date();
    const { prisma } = makePrisma({
      recentTurns: [
        { speaker: 'agent:dev', createdAt: now },
        { speaker: 'agent:ba', createdAt: new Date(now.getTime() - 1000) },
      ],
    });
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );
    expect(await svc.shouldBlock('t-1')).toBe('runaway_loop');
  });

  it('does not block when a human broke the chain', async () => {
    const now = new Date();
    const { prisma } = makePrisma({
      recentTurns: [
        { speaker: 'human:u-1', createdAt: now },
        { speaker: 'agent:ba', createdAt: new Date(now.getTime() - 1000) },
      ],
    });
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );
    expect(await svc.shouldBlock('t-1')).toBeNull();
  });

  it('rate-limits when 20 turns fall inside the 10-min window', async () => {
    const now = new Date();
    const { prisma } = makePrisma({
      recentTurns: Array.from({ length: 20 }, (_, i) => ({
        // Alternate speakers so we don't also trip the runaway-loop guard on turn 1.
        speaker: i % 2 === 0 ? 'human:u-1' : 'agent:ba',
        createdAt: new Date(now.getTime() - i * 1000),
      })),
    });
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );
    expect(await svc.shouldBlock('t-1')).toBe('rate_limited');
  });
});

describe('ConversationOrchestratorService.dispatchFromInbound', () => {
  const inboundBase = {
    tenantId: 't-1',
    channel: 'slack' as const,
    channelRef: 'C-abc',
    speaker: 'human:u-1',
  };

  it('returns no_mention when text has none', async () => {
    const { prisma } = makePrisma();
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );
    const r = await svc.dispatchFromInbound({ ...inboundBase, text: 'just saying hi' });
    expect(r).toMatchObject({ handled: false, reason: 'no_mention' });
  });

  it('routes @help through the plain dispatcher', async () => {
    const { prisma } = makePrisma();
    const dispatcher = makeDispatcher('list of commands');
    const svc = new ConversationOrchestratorService(
      prisma as any,
      dispatcher,
      makeGemini({ disabled: true }),
    );
    const r = await svc.dispatchFromInbound({ ...inboundBase, text: '@help' });
    expect(r).toMatchObject({ handled: true, agent: 'help', reply: 'list of commands' });
    expect(dispatcher.dispatch).toHaveBeenCalled();
  });

  it('uses Gemini when available and detects handoffs in the reply', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ text: 'On it. Handing off to @dev for the payload review.' });
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      gemini,
    );
    const r = await svc.dispatchFromInbound({
      ...inboundBase,
      text: '@ba please triage the compliance ask',
    });
    expect(r.handled).toBe(true);
    expect(r.agent).toBe('ba');
    expect(r.handoffs).toEqual(['dev']);
    expect(gemini.generateFreeformText).toHaveBeenCalled();
  });

  it('falls back to the dispatcher when Gemini is disabled', async () => {
    const { prisma } = makePrisma();
    const dispatcher = makeDispatcher('BA agent: 0 briefs pending');
    const gemini = makeGemini({ disabled: true });
    const svc = new ConversationOrchestratorService(prisma as any, dispatcher, gemini);
    const r = await svc.dispatchFromInbound({ ...inboundBase, text: '@ba status' });
    expect(r.handled).toBe(true);
    expect(r.reply).toBe('BA agent: 0 briefs pending');
    expect(gemini.generateFreeformText).not.toHaveBeenCalled();
  });

  it('falls back to the dispatcher when Gemini throws', async () => {
    const { prisma } = makePrisma();
    const dispatcher = makeDispatcher('fallback reply');
    const gemini = makeGemini({ throws: true });
    const svc = new ConversationOrchestratorService(prisma as any, dispatcher, gemini);
    const r = await svc.dispatchFromInbound({ ...inboundBase, text: '@dev jobs' });
    expect(r.reply).toBe('fallback reply');
    expect(dispatcher.dispatch).toHaveBeenCalled();
  });

  it('blocks runaway loops before any dispatch work', async () => {
    const now = new Date();
    const { prisma } = makePrisma({
      existingThread: { id: 't-exist' },
      recentTurns: [
        { speaker: 'agent:dev', createdAt: now },
        { speaker: 'agent:ba', createdAt: new Date(now.getTime() - 1000) },
      ],
    });
    const gemini = makeGemini();
    const svc = new ConversationOrchestratorService(prisma as any, makeDispatcher(), gemini);
    const r = await svc.dispatchFromInbound({ ...inboundBase, text: '@architect step in please' });
    expect(r).toMatchObject({ handled: false, reason: 'runaway_loop' });
    expect(gemini.generateFreeformText).not.toHaveBeenCalled();
  });
});

describe('ConversationOrchestratorService.initiate', () => {
  it('records a turn against an existing threadId without creating a thread', async () => {
    const { prisma, turns } = makePrisma({ existingThread: null });
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );

    const r = await svc.initiate({
      tenantId: 't-1',
      threadId: 'thread-abc',
      channel: 'slack',
      agent: 'ba',
      text: 'PRD approved — @dev please kick off implementation.',
    });

    expect(r.blocked).toBeUndefined();
    expect(r.threadId).toBe('thread-abc');
    expect(r.turnId).toBe('turn-1');
    expect(r.handoffs).toEqual(['dev']);
    expect(r.formatted.username).toBe('Workforce0 BA');
    expect(prisma.conversationThread.create).not.toHaveBeenCalled();
    expect(turns[0]).toMatchObject({
      speaker: 'agent:ba',
      kind: 'handoff',
      addressedTo: 'agent:dev',
    });
  });

  it('creates a thread when only channel/channelRef is given', async () => {
    const { prisma } = makePrisma({ existingThread: null });
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );

    const r = await svc.initiate({
      tenantId: 't-1',
      channel: 'slack',
      channelRef: 'C-xyz',
      purpose: 'engagement:eng-1',
      agent: 'dev',
      text: 'Starting work now.',
    });

    expect(prisma.conversationThread.create).toHaveBeenCalledTimes(1);
    expect(r.threadId).toBe('thread-1');
    expect(r.handoffs).toEqual([]);
  });

  it('throws when neither threadId nor channel+channelRef is supplied', async () => {
    const { prisma } = makePrisma();
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );

    await expect(
      svc.initiate({ tenantId: 't-1', agent: 'ba', text: 'hi' }),
    ).rejects.toThrow(/threadId or channel\+channelRef/);
  });

  it('returns blocked=runaway_loop without writing a turn when the last two speakers were agents', async () => {
    const now = new Date();
    const { prisma, turns } = makePrisma({
      recentTurns: [
        { speaker: 'agent:dev', createdAt: now },
        { speaker: 'agent:ba', createdAt: new Date(now.getTime() - 1000) },
      ],
    });
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );

    const r = await svc.initiate({
      tenantId: 't-1',
      threadId: 'thread-existing',
      channel: 'slack',
      agent: 'ba',
      text: 'hello again',
    });

    expect(r.blocked).toBe('runaway_loop');
    expect(r.turnId).toBe('');
    expect(turns).toHaveLength(0);
  });

  it('marks kind=speak when there are no @other-agent handoffs', async () => {
    const { prisma, turns } = makePrisma();
    const svc = new ConversationOrchestratorService(
      prisma as any,
      makeDispatcher(),
      makeGemini({ disabled: true }),
    );

    const r = await svc.initiate({
      tenantId: 't-1',
      threadId: 'thread-abc',
      channel: 'whatsapp',
      agent: 'qa',
      text: 'Verification passed.',
    });

    expect(r.blocked).toBeUndefined();
    expect(r.handoffs).toEqual([]);
    expect(turns[0]!.kind).toBe('speak');
    expect(turns[0]!.addressedTo).toBeUndefined();
    // WhatsApp gets flat emoji-prefixed text, not a username.
    expect(r.formatted.username).toBeUndefined();
    expect(r.formatted.text).toMatch(/QA: Verification passed\./);
  });
});

describe('ConversationOrchestratorService — daily token budget gate (Change A)', () => {
  const inbound = {
    tenantId: 't-budget',
    channel: 'slack' as const,
    channelRef: 'C-budget',
    speaker: 'human:u-1',
    text: '@ba quick brief check please',
  };

  it('falls back to the dispatcher when the tenant is over its daily budget', async () => {
    const { prisma } = makePrisma();
    const dispatcher = makeDispatcher('fallback from budget gate');
    const gemini = makeGemini({ text: 'should not be called' });
    const usageGate = { isOverDailyTokenBudget: vi.fn().mockResolvedValue(true) };

    const svc = new ConversationOrchestratorService(
      prisma as any, dispatcher, gemini, usageGate,
    );
    const r = await svc.dispatchFromInbound(inbound);

    expect(r.handled).toBe(true);
    expect(r.reply).toBe('fallback from budget gate');
    expect(gemini.generateFreeformText).not.toHaveBeenCalled();
    expect(usageGate.isOverDailyTokenBudget).toHaveBeenCalledWith('t-budget');
  });

  it('calls Gemini when the tenant is under budget', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ text: 'under-budget reply' });
    const usageGate = { isOverDailyTokenBudget: vi.fn().mockResolvedValue(false) };

    const svc = new ConversationOrchestratorService(
      prisma as any, makeDispatcher(), gemini, usageGate,
    );
    const r = await svc.dispatchFromInbound(inbound);

    expect(r.reply).toBe('under-budget reply');
    expect(gemini.generateFreeformText).toHaveBeenCalled();
  });

  it('fail-opens (Gemini runs) when the budget check itself throws', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ text: 'still went through' });
    const usageGate = {
      isOverDailyTokenBudget: vi.fn().mockRejectedValue(new Error('usage db down')),
    };

    const svc = new ConversationOrchestratorService(
      prisma as any, makeDispatcher(), gemini, usageGate,
    );
    const r = await svc.dispatchFromInbound(inbound);

    expect(r.reply).toBe('still went through');
    expect(gemini.generateFreeformText).toHaveBeenCalled();
  });

  it('skips the budget check entirely when no usage gate is supplied', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ text: 'no gate' });

    const svc = new ConversationOrchestratorService(prisma as any, makeDispatcher(), gemini);
    const r = await svc.dispatchFromInbound(inbound);

    expect(r.reply).toBe('no gate');
  });
});

describe('ConversationOrchestratorService.classifyMentionWithLLM (Change B)', () => {
  it('returns a valid agent when Gemini picks one from the roster', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ text: 'dev' });
    const svc = new ConversationOrchestratorService(prisma as any, makeDispatcher(), gemini);
    expect(await svc.classifyMentionWithLLM('Can someone review this PR?')).toBe('dev');
  });

  it('tolerates chatty output — picks the first word', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ text: 'ba, because it is a product brief.' });
    const svc = new ConversationOrchestratorService(prisma as any, makeDispatcher(), gemini);
    expect(await svc.classifyMentionWithLLM('new product request')).toBe('ba');
  });

  it('returns null when Gemini picks "none"', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ text: 'none' });
    const svc = new ConversationOrchestratorService(prisma as any, makeDispatcher(), gemini);
    expect(await svc.classifyMentionWithLLM('lol thanks team')).toBeNull();
  });

  it('returns null when Gemini hallucinates a non-roster agent', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ text: 'ceo' });
    const svc = new ConversationOrchestratorService(prisma as any, makeDispatcher(), gemini);
    expect(await svc.classifyMentionWithLLM('who signs off?')).toBeNull();
  });

  it('returns null on Gemini failure without throwing', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ throws: true });
    const svc = new ConversationOrchestratorService(prisma as any, makeDispatcher(), gemini);
    expect(await svc.classifyMentionWithLLM('any message')).toBeNull();
  });

  it('returns null when Gemini is disabled (defensive)', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ disabled: true });
    const svc = new ConversationOrchestratorService(prisma as any, makeDispatcher(), gemini);
    expect(await svc.classifyMentionWithLLM('any message')).toBeNull();
  });
});

describe('ConversationOrchestratorService dispatch + LLM classifier (Change B wiring)', () => {
  const inbound = {
    tenantId: 't-1',
    channel: 'slack' as const,
    channelRef: 'C-x',
    speaker: 'human:u-1',
    text: 'can someone pick this up', // deliberately no @mention
  };

  it('uses the LLM classifier when opted-in and no @mention found', async () => {
    const { prisma } = makePrisma();
    const gemini = {
      disabled: false,
      // First call: classifier picks "qa". Second call: agent reply.
      generateFreeformText: vi
        .fn()
        .mockResolvedValueOnce('qa')
        .mockResolvedValueOnce('QA agent here, running the checks.'),
    } as unknown as import('../../ai/gemini.service.js').GeminiService;

    const svc = new ConversationOrchestratorService(
      prisma as any, makeDispatcher(), gemini, null, /* llmClassifier */ true,
    );
    const r = await svc.dispatchFromInbound(inbound);

    expect(r.handled).toBe(true);
    expect(r.agent).toBe('qa');
    expect(r.reply).toBe('QA agent here, running the checks.');
  });

  it('does NOT call the classifier when opt-in flag is off (defaults)', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ text: 'should not be called' });
    const svc = new ConversationOrchestratorService(prisma as any, makeDispatcher(), gemini);
    const r = await svc.dispatchFromInbound(inbound);

    expect(r).toMatchObject({ handled: false, reason: 'no_mention' });
    expect(gemini.generateFreeformText).not.toHaveBeenCalled();
  });

  it('returns no_mention when LLM classifier opts in but picks "none"', async () => {
    const { prisma } = makePrisma();
    const gemini = makeGemini({ text: 'none' });
    const svc = new ConversationOrchestratorService(
      prisma as any, makeDispatcher(), gemini, null, true,
    );
    const r = await svc.dispatchFromInbound(inbound);
    expect(r).toMatchObject({ handled: false, reason: 'no_mention' });
  });
});

describe('ConversationOrchestratorService.resolvePurposeFromText (Change C)', () => {
  it('returns null when the text has no prd/engagement reference', async () => {
    const { prisma } = makePrisma();
    const svc = new ConversationOrchestratorService(
      prisma as any, makeDispatcher(), makeGemini({ disabled: true }),
    );
    expect(await svc.resolvePurposeFromText('t-1', 'hello @ba how goes it')).toBeNull();
  });

  it('resolves an explicit prd:<id> reference that belongs to the tenant', async () => {
    const pid = 'c1b2a3d4e5f6g7h8i9j0k1l2m';
    const { prisma } = makePrisma({ prdIds: new Set([pid]) });
    const svc = new ConversationOrchestratorService(
      prisma as any, makeDispatcher(), makeGemini({ disabled: true }),
    );
    expect(await svc.resolvePurposeFromText('t-1', `@dev see prd:${pid} thanks`))
      .toBe(`prd:${pid}`);
  });

  it('accepts alternate delimiters (prd-<id> and prd <id>)', async () => {
    const pid = 'c1b2a3d4e5f6g7h8i9j0k1l2m';
    const { prisma } = makePrisma({ prdIds: new Set([pid]) });
    const svc = new ConversationOrchestratorService(
      prisma as any, makeDispatcher(), makeGemini({ disabled: true }),
    );
    expect(await svc.resolvePurposeFromText('t-1', `check prd-${pid}`)).toBe(`prd:${pid}`);
    expect(await svc.resolvePurposeFromText('t-1', `check prd ${pid}`)).toBe(`prd:${pid}`);
  });

  it('resolves an engagement:<id> reference', async () => {
    const eid = 'xyz01234567890123456789';
    const { prisma } = makePrisma({ engagementIds: new Set([eid]) });
    const svc = new ConversationOrchestratorService(
      prisma as any, makeDispatcher(), makeGemini({ disabled: true }),
    );
    expect(await svc.resolvePurposeFromText('t-1', `engagement:${eid} is stuck`))
      .toBe(`engagement:${eid}`);
  });

  it('returns null when the id does not belong to the tenant (cross-tenant guard)', async () => {
    // prdIds is empty — findFirst will return null for any id we ask about.
    const { prisma } = makePrisma({ prdIds: new Set() });
    const svc = new ConversationOrchestratorService(
      prisma as any, makeDispatcher(), makeGemini({ disabled: true }),
    );
    expect(
      await svc.resolvePurposeFromText('t-1', 'hey look at prd:abcdefghij0123456789zz'),
    ).toBeNull();
  });

  it('dispatchFromInbound scopes the thread purpose when the text names a PRD', async () => {
    const pid = 'prod12345678901234567890';
    const { prisma } = makePrisma({ prdIds: new Set([pid]) });
    const svc = new ConversationOrchestratorService(
      prisma as any, makeDispatcher(), makeGemini({ disabled: true }),
    );
    await svc.dispatchFromInbound({
      tenantId: 't-1',
      channel: 'slack',
      channelRef: 'C-1',
      speaker: 'human:u-1',
      text: `@ba status for prd:${pid}`,
    });
    expect(prisma.conversationThread.findUnique).toHaveBeenCalledWith({
      where: {
        channel_channelRef_purpose: {
          channel: 'slack',
          channelRef: 'C-1',
          purpose: `prd:${pid}`,
        },
      },
      select: { id: true },
    });
  });
});
