/**
 * =============================================================================
 * CONVERSATION ORCHESTRATOR — tier 3b
 * =============================================================================
 *
 * Gives agents a durable shared "place" (ConversationThread) and turns the
 * stream of inbound + outbound messages into ConversationTurn rows. Layers
 * on top of AgentDispatcherService (the tier-1/2 read-only dispatcher) but
 * adds three things the dispatcher doesn't have:
 *
 *   1. **Persistent context.** Every message is recorded, so agents can
 *      reference what was said 5 turns ago without paging the whole DB.
 *   2. **Guardrails.** Runaway loops (agent → agent → agent → ...) are
 *      interrupted. Per-thread rate limits keep token spend bounded.
 *   3. **LLM-backed replies with persona.** Agents speak in their own
 *      voice with the last N turns as context — not just canned DB
 *      summaries.
 *   4. **Active initiation.** Agents can post unprompted (e.g. BA drops a
 *      "PRD approved, handing off to @dev" note the moment an approval
 *      lands) via `initiate()` — no inbound human message required.
 *
 * Scope we are NOT tackling in this first cut:
 *   - Per-tenant token budgets — daily cap covered by a later commit.
 *   - LLM-backed classifier for ambiguous messages — regex dispatch still
 *     handles everything; LLM is only used for the *response*, not for
 *     routing.
 *
 * See docs/plans/tier-3-autonomous-multi-agent-chat.md for the full vision.
 *
 * @module services/conversation/conversation-orchestrator
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import type { GeminiService } from '../ai/gemini.service.js';
import {
  AgentDispatcherService,
  type AgentHandle,
} from '../agent-dispatcher/agent-dispatcher.service.js';
import { createChildLogger } from '../../lib/logger.js';

/**
 * Narrow shape of UsageService we need here — defined as a structural
 * interface so tests can pass a plain stub without wiring the whole
 * metering subsystem.
 */
export interface OrchestratorUsageGate {
  isOverDailyTokenBudget(tenantId: string): Promise<boolean>;
}

const logger = createChildLogger({ service: 'ConversationOrchestrator' });

/** Channels the orchestrator listens on. */
export type ConversationChannel = 'slack' | 'whatsapp' | 'sms' | 'telegram' | 'teams';

/** Persona rendered when posting back to users. Used by Slack personas, WhatsApp prefixes, etc. */
export interface AgentPersona {
  /** Short, lowercase — matches AgentHandle. */
  handle: Exclude<AgentHandle, 'help'>;
  /** Display name. */
  name: string;
  /** Emoji shown in Slack / prefix in WhatsApp. */
  emoji: string;
}

export const AGENT_PERSONAS: Record<Exclude<AgentHandle, 'help'>, AgentPersona> = {
  ba: { handle: 'ba', name: 'BA', emoji: '📝' },
  dev: { handle: 'dev', name: 'Dev', emoji: '🛠️' },
  qa: { handle: 'qa', name: 'QA', emoji: '🧪' },
  architect: { handle: 'architect', name: 'Architect', emoji: '🏛️' },
  supervisor: { handle: 'supervisor', name: 'Supervisor', emoji: '🧭' },
};

/** How many past turns we load into the LLM context window. */
const CONTEXT_WINDOW_TURNS = 12;

/** Sliding-window rate limit (turns per (maxTurns × maxTurnsWindowMs)). */
const RATE_LIMIT_MAX_TURNS = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Recognise `@ba`, `@dev`, ... in agent output. Used by detectHandoffs to
 * schedule follow-up turns when one agent wants another.
 */
const HANDOFF_REGEX = /@(ba|dev|qa|architect|supervisor)\b/gi;

/**
 * Find an explicit `prd:<id>` or `engagement:<id>` reference in inbound
 * text so the orchestrator can scope the thread to a specific piece of
 * work. We require the prefix (not bare cuids) to avoid false positives
 * on any 20+ char alnum token that happens to appear in a message.
 * Capture group 1 = 'prd' or 'engagement'; group 2 = the id.
 */
const INBOUND_SCOPE_REGEX = /\b(prd|engagement)[:_\-\s]+([a-z0-9]{20,})\b/i;

export interface RecordTurnInput {
  threadId: string;
  speaker: string; // "agent:ba" | "human:<id>" | "external:<phone>"
  text: string;
  kind?: 'speak' | 'handoff' | 'question' | 'decision';
  addressedTo?: string;
}

export interface DispatchFromInboundInput {
  tenantId: string;
  channel: ConversationChannel;
  /** Slack channel id / WhatsApp phone / Telegram chat id. */
  channelRef: string;
  /** Purpose key so multiple threads can share a channelRef across meetings. */
  purpose?: string;
  /** The sender of the inbound message — "human:<userId>" or "external:<phone>". */
  speaker: string;
  /** The full message text. */
  text: string;
}

export interface DispatchResult {
  handled: boolean;
  /** Agent that replied. Null when nothing matched or guardrails blocked. */
  agent: AgentHandle | null;
  /** Reply text, already persona-prefixed for channels that can't render speaker labels. */
  reply: string;
  /** Any @other-agent handoffs we detected in the reply (for a follow-up queue entry). */
  handoffs: Exclude<AgentHandle, 'help'>[];
  /** Why we didn't handle, when handled=false. */
  reason?: 'no_mention' | 'rate_limited' | 'runaway_loop' | 'resolution_failed';
}

export interface InitiateInput {
  tenantId: string;
  /**
   * Where to post. Either a pre-existing threadId (the caller already
   * knows which thread this belongs to) OR a channel/channelRef/purpose
   * triple, in which case the orchestrator will findOrCreateThread.
   */
  threadId?: string;
  channel?: ConversationChannel;
  channelRef?: string;
  purpose?: string;
  /** Which agent is speaking. */
  agent: Exclude<AgentHandle, 'help'>;
  /** The unprompted message body. */
  text: string;
}

export interface InitiateResult {
  /** Thread the message was recorded on. */
  threadId: string;
  /** Turn id of the agent's message. */
  turnId: string;
  /** Persona-formatted payload the caller can hand to a channel adapter. */
  formatted: { text: string; username?: string; iconEmoji?: string };
  /** @other-agent mentions found in the text (for the caller to queue follow-up). */
  handoffs: Exclude<AgentHandle, 'help'>[];
  /** Guardrails: filled when we declined to post (runaway loop / rate limit). */
  blocked?: 'rate_limited' | 'runaway_loop';
}

/**
 * Orchestrates multi-agent conversations across channels. Thin facade over
 * Prisma for the thread/turn table, the AgentDispatcher for the read-only
 * responses, and GeminiService for the LLM-backed branch.
 */
export class ConversationOrchestratorService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dispatcher: AgentDispatcherService,
    /** Optional; LLM responses are only used when Gemini is configured. */
    private readonly gemini: GeminiService | null,
    /**
     * Optional daily-token-budget gate. When supplied, the orchestrator
     * skips Gemini once a tenant crosses its daily cap and falls back to
     * the non-LLM dispatcher path. Omit in tests that don't care.
     */
    private readonly usageGate: OrchestratorUsageGate | null = null,
    /**
     * Opt-in LLM fallback for ambiguous messages that contain no @mention.
     * When true AND Gemini is available, the orchestrator asks the LLM
     * which agent should handle the text before giving up with `no_mention`.
     * Off by default — ambiguous routing burns tokens, and callers often
     * prefer a quiet "I don't understand" over a confident wrong guess.
     */
    private readonly llmMentionClassifierEnabled: boolean = false,
  ) {}

  /**
   * Last-ditch classifier: when the regex finds no @agent, ask Gemini to
   * pick one from our fixed roster. Constrained to a single lowercase
   * word in the response so we can parse without JSON gymnastics. The
   * LLM gets an explicit "none" escape so it doesn't feel pressured to
   * invent a match — we'd rather have `no_mention` than the wrong agent.
   *
   * Any failure (network, malformed output, unknown word) resolves to
   * null so the caller can continue with `no_mention` behaviour.
   */
  async classifyMentionWithLLM(text: string): Promise<Exclude<AgentHandle, 'help'> | null> {
    if (!this.gemini || (this.gemini as unknown as { disabled: boolean }).disabled) {
      return null;
    }
    const prompt = [
      'You are a router that picks which Workforce0 agent should handle a message.',
      'Roster (exact, lowercase):',
      '  ba          — product briefs, clarifications, approvals',
      '  dev         — writing or reviewing code and PRs',
      '  qa          — running tests, security scans, merge gating',
      '  architect   — system design, API shape, data model',
      '  supervisor  — pipeline status, blockers, orchestration',
      '  none        — the message is chitchat, an announcement, or ambiguous',
      '',
      'Reply with EXACTLY ONE of those words, lowercase, no punctuation, no explanation.',
      '',
      `Message: ${text}`,
    ].join('\n');
    try {
      const raw = (await this.gemini.generateFreeformText(prompt)).trim().toLowerCase();
      // Pull the first word so a chatty model that prefixes/explains
      // still gives us something usable.
      const first = raw.split(/\s+/)[0]?.replace(/[^a-z]/g, '') ?? '';
      const allowed: Array<Exclude<AgentHandle, 'help'>> = ['ba', 'dev', 'qa', 'architect', 'supervisor'];
      if ((allowed as string[]).includes(first)) {
        return first as Exclude<AgentHandle, 'help'>;
      }
      return null;
    } catch (err) {
      logger.warn('LLM mention classifier failed', { err: (err as Error).message });
      return null;
    }
  }

  /** Find (or create) a thread for a given channel address + purpose. */
  async findOrCreateThread(input: {
    tenantId: string;
    channel: ConversationChannel;
    channelRef: string;
    purpose?: string;
  }): Promise<{ id: string; created: boolean }> {
    const purpose = input.purpose ?? 'general';
    const existing = await (this.prisma as any).conversationThread.findUnique({
      where: {
        channel_channelRef_purpose: {
          channel: input.channel,
          channelRef: input.channelRef,
          purpose,
        },
      },
      select: { id: true },
    });
    if (existing) {
      await (this.prisma as any).conversationThread.update({
        where: { id: existing.id },
        data: { lastActivityAt: new Date() },
      });
      return { id: existing.id, created: false };
    }
    const created = await (this.prisma as any).conversationThread.create({
      data: {
        tenantId: input.tenantId,
        channel: input.channel,
        channelRef: input.channelRef,
        purpose,
        lastActivityAt: new Date(),
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  }

  async recordTurn(input: RecordTurnInput): Promise<{ id: string }> {
    const turn = await (this.prisma as any).conversationTurn.create({
      data: {
        threadId: input.threadId,
        speaker: input.speaker,
        text: input.text,
        kind: input.kind ?? 'speak',
        addressedTo: input.addressedTo,
      },
      select: { id: true },
    });
    return { id: turn.id };
  }

  /**
   * Best-effort: if the inbound text explicitly names a `prd:<id>` or
   * `engagement:<id>`, verify the id belongs to this tenant and return
   * a scoped purpose string so thread lookup lands on the right row.
   *
   * Returns `null` when nothing matches or the id doesn't resolve — the
   * caller falls back to whatever `input.purpose` they passed (or the
   * `'general'` default inside findOrCreateThread). The query is
   * tenant-scoped to prevent a curious user from hijacking someone
   * else's thread by pasting their PRD id into a DM.
   */
  async resolvePurposeFromText(tenantId: string, text: string): Promise<string | null> {
    const m = text.match(INBOUND_SCOPE_REGEX);
    if (!m) return null;
    const kind = m[1]!.toLowerCase();
    const id = m[2]!;

    try {
      if (kind === 'prd') {
        const row = await (this.prisma as any).pRD.findFirst({
          where: { id, tenantId },
          select: { id: true },
        });
        return row ? `prd:${row.id}` : null;
      }
      const row = await (this.prisma as any).engagement.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      return row ? `engagement:${row.id}` : null;
    } catch (err) {
      logger.warn('resolvePurposeFromText failed — falling back', {
        tenantId,
        err: (err as Error).message,
      });
      return null;
    }
  }

  /**
   * Daily token budget check that never throws. A bug in the usage
   * service must not take down the dispatch path — we log and assume
   * the tenant is under budget (fail-open). Callers that want to
   * fail-closed should surface the error and set a sensible default.
   */
  private async checkBudgetSafe(tenantId: string): Promise<boolean> {
    if (!this.usageGate) return false;
    try {
      const over = await this.usageGate.isOverDailyTokenBudget(tenantId);
      if (over) {
        logger.info('Daily token budget exhausted — falling back to non-LLM dispatcher', {
          tenantId,
        });
      }
      return over;
    } catch (err) {
      logger.warn('Budget check failed, treating as under budget', {
        tenantId,
        err: (err as Error).message,
      });
      return false;
    }
  }

  /**
   * Guardrail check. Returns the reason to block, or null if we should dispatch.
   *
   * Blocks when:
   *   - Last two turns were both agents (runaway loop, the third would make it three agents in a row without a human)
   *   - We've had >= RATE_LIMIT_MAX_TURNS inside the last RATE_LIMIT_WINDOW_MS
   */
  async shouldBlock(threadId: string): Promise<DispatchResult['reason'] | null> {
    const recent = await (this.prisma as any).conversationTurn.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: RATE_LIMIT_MAX_TURNS,
      select: { speaker: true, createdAt: true },
    });

    const last2 = recent.slice(0, 2);
    if (last2.length === 2 && last2.every((t: { speaker: string }) => t.speaker.startsWith('agent:'))) {
      return 'runaway_loop';
    }

    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    const inWindow = recent.filter((t: { createdAt: Date }) => t.createdAt.getTime() > cutoff).length;
    if (inWindow >= RATE_LIMIT_MAX_TURNS) {
      return 'rate_limited';
    }

    return null;
  }

  /**
   * Load the last N turns ordered oldest→newest, suitable for passing to the
   * LLM as conversation context.
   */
  async loadContext(threadId: string): Promise<Array<{ speaker: string; text: string }>> {
    const raw = await (this.prisma as any).conversationTurn.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: CONTEXT_WINDOW_TURNS,
      select: { speaker: true, text: true },
    });
    return (raw as Array<{ speaker: string; text: string }>).reverse();
  }

  /**
   * Scan agent output for @other-agent references so the orchestrator can
   * schedule follow-up turns. Does NOT return the agent's own handle — an
   * agent @mentioning itself is a no-op.
   */
  static detectHandoffs(text: string, selfHandle?: AgentHandle): Exclude<AgentHandle, 'help'>[] {
    const matches = text.matchAll(HANDOFF_REGEX);
    const out = new Set<Exclude<AgentHandle, 'help'>>();
    for (const m of matches) {
      const h = m[1]!.toLowerCase() as Exclude<AgentHandle, 'help'>;
      if (h !== selfHandle) out.add(h);
    }
    return [...out];
  }

  /**
   * Craft an LLM prompt that asks the given agent to respond, with recent
   * conversation context. Kept small and deterministic; no tool calls.
   */
  private buildAgentPrompt(params: {
    agent: Exclude<AgentHandle, 'help'>;
    messageFromUser: string;
    context: Array<{ speaker: string; text: string }>;
  }): string {
    const persona = AGENT_PERSONAS[params.agent];
    const history = params.context
      .map((t) => {
        const who = t.speaker.startsWith('agent:')
          ? `${t.speaker.slice(6).toUpperCase()}`
          : t.speaker.startsWith('human:')
            ? 'USER'
            : t.speaker.startsWith('external:')
              ? 'USER'
              : t.speaker;
        return `${who}: ${t.text}`;
      })
      .join('\n');

    return [
      `You are the **${persona.name} agent** on the Workforce0 AI team. Your role:`,
      params.agent === 'ba' && 'Capture product requirements from meetings and keep briefs on track.',
      params.agent === 'dev' && 'Turn approved briefs into working code through the Dev daemon or PRs.',
      params.agent === 'qa' && 'Verify tests pass, run security scans, and gate merges.',
      params.agent === 'architect' && 'Design the implementation — components, APIs, data model.',
      params.agent === 'supervisor' && 'Orchestrate the pipeline and surface blockers.',
      '',
      'Recent conversation:',
      history || '(this is the first message)',
      '',
      `New message: ${params.messageFromUser}`,
      '',
      'Reply in 1-3 sentences. If you need another agent, write "@dev" / "@ba" / etc. — the orchestrator will route them. If the conversation has nothing for you to do, say so briefly rather than making up work.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * The main entry point. Takes an inbound message, records it as a turn,
   * runs guardrails, routes to an agent, persists the agent's reply, and
   * returns everything the caller needs to post it back.
   */
  async dispatchFromInbound(input: DispatchFromInboundInput): Promise<DispatchResult> {
    // Derive thread purpose from the inbound text when the user explicitly
    // names a PRD or engagement. Falls back to whatever the caller passed
    // (or 'general') when no match resolves to a row in this tenant.
    const derivedPurpose = await this.resolvePurposeFromText(input.tenantId, input.text);
    const thread = await this.findOrCreateThread({
      tenantId: input.tenantId,
      channel: input.channel,
      channelRef: input.channelRef,
      purpose: derivedPurpose ?? input.purpose,
    });

    await this.recordTurn({
      threadId: thread.id,
      speaker: input.speaker,
      text: input.text,
      kind: 'speak',
    });

    let mention = AgentDispatcherService.extractMention(input.text);
    if (!mention && this.llmMentionClassifierEnabled) {
      // Opt-in LLM fallback for ambiguous messages. Only runs when no
      // regex match AND the tenant explicitly opted in — we won't quietly
      // burn tokens guessing at intent otherwise. `classifyMentionWithLLM`
      // fail-closes to null, which keeps the existing no_mention path.
      const llmPick = await this.classifyMentionWithLLM(input.text);
      if (llmPick) {
        logger.info('LLM classifier resolved an ambiguous mention', {
          agent: llmPick,
          threadId: thread.id,
        });
        mention = llmPick;
      }
    }
    if (!mention) {
      return { handled: false, agent: null, reply: '', handoffs: [], reason: 'no_mention' };
    }
    if (mention === 'help') {
      const dispatched = await this.dispatcher.dispatch({
        text: input.text,
        tenantId: input.tenantId,
        source: input.channel,
      });
      await this.recordTurn({
        threadId: thread.id,
        speaker: 'agent:help',
        text: dispatched.reply,
        kind: 'speak',
      });
      return { handled: true, agent: 'help', reply: dispatched.reply, handoffs: [] };
    }

    const block = await this.shouldBlock(thread.id);
    if (block) {
      logger.info('Orchestrator blocked dispatch', {
        threadId: thread.id,
        reason: block,
        agent: mention,
      });
      return { handled: false, agent: null, reply: '', handoffs: [], reason: block };
    }

    // Decide: LLM response (if Gemini is wired and the tenant hasn't
    // blown its daily token cap) or DB-only fallback.
    const geminiAvailable =
      !!this.gemini && !(this.gemini as unknown as { disabled: boolean }).disabled;
    const budgetBlocked = geminiAvailable
      ? await this.checkBudgetSafe(input.tenantId)
      : false;

    let reply: string;
    if (geminiAvailable && !budgetBlocked) {
      const context = await this.loadContext(thread.id);
      const prompt = this.buildAgentPrompt({
        agent: mention,
        messageFromUser: input.text,
        context,
      });
      try {
        reply = (await this.gemini!.generateFreeformText(prompt)).trim();
      } catch (err) {
        logger.warn('Gemini failed, falling back to dispatcher', { err: (err as Error).message });
        const dispatched = await this.dispatcher.dispatch({
          text: input.text,
          tenantId: input.tenantId,
          source: input.channel,
        });
        reply = dispatched.reply;
      }
    } else {
      const dispatched = await this.dispatcher.dispatch({
        text: input.text,
        tenantId: input.tenantId,
        source: input.channel,
      });
      reply = dispatched.reply;
    }

    const handoffs = ConversationOrchestratorService.detectHandoffs(reply, mention);

    await this.recordTurn({
      threadId: thread.id,
      speaker: `agent:${mention}`,
      text: reply,
      kind: handoffs.length > 0 ? 'handoff' : 'speak',
      addressedTo: handoffs.length > 0 ? `agent:${handoffs[0]}` : undefined,
    });

    return { handled: true, agent: mention, reply, handoffs };
  }

  /**
   * Active initiation — the agent posts *without* a preceding human
   * message. Used by hooks like "PRD approved → BA drops a handoff note"
   * so conversation threads stay live without forcing the human to poke
   * them first.
   *
   * Behaviour:
   *   - Finds (or creates) the thread keyed by channel/ref/purpose, OR
   *     uses a pre-known threadId when supplied.
   *   - Runs the same guardrails dispatchFromInbound does (runaway-loop
   *     guard, sliding-window rate limit). If blocked, returns
   *     `blocked=...` and does NOT write a turn — callers log and move on.
   *   - Records the agent's text as a turn with speaker `agent:<handle>`
   *     and kind `handoff` when @another-agent is mentioned, else `speak`.
   *   - Returns the persona-formatted payload so the caller can hand it
   *     straight to a channel adapter (Slack, WhatsApp, etc.) without
   *     re-deriving the emoji/username shape.
   *
   * Note: the orchestrator does NOT itself send to any external channel —
   * that's the caller's job. This keeps initiation DB-writes atomic and
   * lets callers pick the right adapter per tenant / per channel.
   */
  async initiate(input: InitiateInput): Promise<InitiateResult> {
    let threadId: string;
    if (input.threadId) {
      threadId = input.threadId;
    } else {
      if (!input.channel || !input.channelRef) {
        throw new Error('initiate() requires either threadId or channel+channelRef');
      }
      const thread = await this.findOrCreateThread({
        tenantId: input.tenantId,
        channel: input.channel,
        channelRef: input.channelRef,
        purpose: input.purpose,
      });
      threadId = thread.id;
    }

    const block = await this.shouldBlock(threadId);
    if (block === 'rate_limited' || block === 'runaway_loop') {
      logger.info('initiate blocked by guardrail', { threadId, reason: block, agent: input.agent });
      return {
        threadId,
        turnId: '',
        formatted: { text: '' },
        handoffs: [],
        blocked: block,
      };
    }

    const handoffs = ConversationOrchestratorService.detectHandoffs(input.text, input.agent);
    const turn = await this.recordTurn({
      threadId,
      speaker: `agent:${input.agent}`,
      text: input.text,
      kind: handoffs.length > 0 ? 'handoff' : 'speak',
      addressedTo: handoffs.length > 0 ? `agent:${handoffs[0]}` : undefined,
    });

    const channelForFormat: ConversationChannel = input.channel ?? 'slack';
    const formatted = ConversationOrchestratorService.formatForChannel(
      input.agent,
      input.text,
      channelForFormat,
    );

    return { threadId, turnId: turn.id, formatted, handoffs };
  }

  /**
   * Decorate an outbound reply with the agent's persona emoji. Channels
   * that support per-message usernames (Slack) prefer the returned
   * { username, iconEmoji, text } split; WhatsApp just wants a flat string.
   */
  static formatForChannel(
    agent: AgentHandle,
    reply: string,
    channel: ConversationChannel,
  ): { text: string; username?: string; iconEmoji?: string } {
    if (agent === 'help') return { text: reply };
    const persona = AGENT_PERSONAS[agent];
    if (channel === 'slack') {
      return {
        text: reply,
        username: `Workforce0 ${persona.name}`,
        iconEmoji: persona.emoji,
      };
    }
    return { text: `${persona.emoji} ${persona.name}: ${reply}` };
  }
}
