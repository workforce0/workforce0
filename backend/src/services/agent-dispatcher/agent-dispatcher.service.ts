/**
 * =============================================================================
 * AGENT DISPATCHER SERVICE — tier-1 "ask an agent" from chat
 * =============================================================================
 *
 * Parses @mentions in a free-form chat message (WhatsApp, SMS, Slack
 * channel) and returns a tight text response from the right agent.
 *
 * Scope (v1):
 *   - Recognises @ba / @dev / @qa / @architect / @supervisor / @help
 *   - Handles a handful of cheap introspection intents per agent:
 *       @ba status | list | pending
 *       @dev jobs  | status
 *       @qa status
 *       @architect <prd-id>
 *       @supervisor pipeline
 *       @help
 *   - Everything else -> a friendly "here's what you can ask me" response.
 *
 * What this is NOT (yet):
 *   - A full LLM invocation path. Every response here comes from a direct
 *     database query or a static template. The LLM-backed branch lands
 *     when tier 2 ships agent-to-agent handoffs.
 *
 * The goal: prove the dispatch model and give executives a useful
 * read-only surface on their phone without burning tokens.
 *
 * @module services/agent-dispatcher
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'AgentDispatcher' });

/** Agent handles we accept in @mentions. Keep this list small and stable. */
export type AgentHandle = 'ba' | 'dev' | 'qa' | 'architect' | 'supervisor' | 'help';

/** Regex: `@ba`, `@dev`, etc. Case-insensitive, word-bounded. */
const MENTION_REGEX = /@(ba|dev|qa|architect|supervisor|help|workforce0)\b/i;

export interface DispatchInput {
  /** Raw message body from the user. */
  text: string;
  /** Tenant scope — responses only surface data for this tenant. */
  tenantId: string;
  /** Where the message came from; included in logs + audit trail. */
  source: 'whatsapp' | 'sms' | 'slack' | 'telegram' | 'teams';
}

export interface DispatchResult {
  /** True when a mention was found and we produced a targeted response. */
  handled: boolean;
  /** Agent the message was routed to. `null` when nothing matched. */
  agent: AgentHandle | null;
  /** Text to post back to the user. Empty string means "don't reply". */
  reply: string;
}

const HELP_TEXT =
  'Workforce0 quick commands:\n' +
  '  @ba status     — list pending briefs\n' +
  '  @ba list       — everything the BA agent has in flight\n' +
  '  @dev jobs      — recent code-gen jobs\n' +
  '  @qa status     — latest QA results\n' +
  '  @architect <id>— architecture design for a PRD\n' +
  '  @supervisor    — pipeline snapshot\n' +
  '  @help          — this message\n' +
  '\nApproving a brief? Reply APPROVE <token> or REJECT <token>.';

export class AgentDispatcherService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Parses @mention from text. Exported for tests + channel handlers. */
  static extractMention(text: string): AgentHandle | null {
    const m = text.match(MENTION_REGEX);
    if (!m) return null;
    const raw = m[1]!.toLowerCase();
    // Treat @workforce0 as @help so a bare "hi Workforce0" lands somewhere.
    if (raw === 'workforce0') return 'help';
    return raw as AgentHandle;
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const mention = AgentDispatcherService.extractMention(input.text);
    if (!mention) {
      return { handled: false, agent: null, reply: '' };
    }

    // Strip the mention itself so the intent matcher works on "status list"
    // rather than "@ba status list".
    const body = input.text.replace(MENTION_REGEX, '').trim();

    logger.info('Dispatching mention', {
      agent: mention,
      source: input.source,
      tenantId: input.tenantId,
    });

    switch (mention) {
      case 'ba':
        return { handled: true, agent: 'ba', reply: await this.handleBa(input.tenantId, body) };
      case 'dev':
        return { handled: true, agent: 'dev', reply: await this.handleDev(input.tenantId, body) };
      case 'qa':
        return { handled: true, agent: 'qa', reply: await this.handleQa(input.tenantId) };
      case 'architect':
        return {
          handled: true,
          agent: 'architect',
          reply: await this.handleArchitect(input.tenantId, body),
        };
      case 'supervisor':
        return {
          handled: true,
          agent: 'supervisor',
          reply: await this.handleSupervisor(input.tenantId),
        };
      case 'help':
      default:
        return { handled: true, agent: 'help', reply: HELP_TEXT };
    }
  }

  private async handleBa(tenantId: string, body: string): Promise<string> {
    const wantsStatus = /\b(status|list|pending|waiting)\b/i.test(body);
    // Default for a bare "@ba" is the status summary — that's the most
    // common question executives ask and avoids forcing them to memorise
    // subcommands.
    const wantsAll = !body || wantsStatus;
    if (!wantsAll) {
      return 'BA agent: I can show `status` (pending briefs) or `list` (everything in flight). What would you like?';
    }

    const prds = await this.prisma.pRD.findMany({
      where: { tenantId, status: { in: ['review', 'pending_approval', 'draft'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, title: true, status: true, confidence: true, createdAt: true },
    });

    if (prds.length === 0) {
      return 'BA agent: nothing pending — your AI workforce is caught up.';
    }

    const lines = prds.map((p) => {
      const shortId = p.id.slice(-6);
      const conf = Math.round((p.confidence ?? 0) * 100);
      return `  • ${p.title} (${shortId} · ${p.status} · ${conf}%)`;
    });
    return `BA agent: ${prds.length} brief${prds.length === 1 ? '' : 's'} pending\n${lines.join('\n')}`;
  }

  private async handleDev(tenantId: string, body: string): Promise<string> {
    const jobs = await this.prisma.agentJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, action: true, status: true, targetRepo: true, createdAt: true },
    });

    if (jobs.length === 0) {
      return 'Dev agent: no recent code-gen jobs. Approve a brief and I will open a PR.';
    }

    const lines = jobs.map((j) => {
      const shortId = j.id.slice(-6);
      return `  • ${j.action} · ${j.status} · ${j.targetRepo ?? '?'} (${shortId})`;
    });
    const suffix = /\bjobs?|status\b/i.test(body) || !body
      ? ''
      : '\n(Showing recent jobs — ask with "jobs" for details.)';
    return `Dev agent: last ${jobs.length} job${jobs.length === 1 ? '' : 's'}\n${lines.join('\n')}${suffix}`;
  }

  private async handleQa(tenantId: string): Promise<string> {
    // Proxy for QA status: count of completed vs failed agent jobs of type review/test.
    const [completed, failed] = await Promise.all([
      this.prisma.agentJob.count({
        where: { tenantId, status: 'done', action: { in: ['review_pr', 'run_tests'] } },
      }),
      this.prisma.agentJob.count({
        where: { tenantId, status: 'failed', action: { in: ['review_pr', 'run_tests'] } },
      }),
    ]);
    if (completed === 0 && failed === 0) {
      return 'QA agent: no review or test runs recorded yet.';
    }
    return `QA agent: ${completed} passed · ${failed} failed (lifetime).`;
  }

  private async handleArchitect(tenantId: string, body: string): Promise<string> {
    // Try to parse a short-id at the tail of the message.
    const idMatch = body.match(/([a-z0-9]{6,})/i);
    if (!idMatch) {
      return 'Architect: tell me which brief — e.g. `@architect abc123`. Grab the last 6 chars of the PRD id.';
    }
    const needle = idMatch[1]!.toLowerCase();

    const prd = await this.prisma.pRD.findFirst({
      where: {
        tenantId,
        id: { endsWith: needle },
      },
      select: { id: true, title: true, architectureDesign: true },
    });
    if (!prd) {
      return `Architect: no brief matched "${needle}" in this workspace.`;
    }
    if (!prd.architectureDesign) {
      return `Architect: ${prd.title} has no design yet. Run the architect once the brief is approved.`;
    }
    const design = prd.architectureDesign as {
      summary?: string;
      components?: unknown[];
      apis?: unknown[];
    };
    const componentCount = Array.isArray(design.components) ? design.components.length : 0;
    const apiCount = Array.isArray(design.apis) ? design.apis.length : 0;
    return `Architect: ${prd.title}\n  ${design.summary ?? '(no summary)'}\n  ${componentCount} components · ${apiCount} APIs`;
  }

  private async handleSupervisor(tenantId: string): Promise<string> {
    const [meetings, prds, jobs] = await Promise.all([
      this.prisma.meeting.count({ where: { tenantId } }),
      this.prisma.pRD.count({ where: { tenantId } }),
      this.prisma.agentJob.count({ where: { tenantId } }),
    ]);
    return (
      `Supervisor: pipeline snapshot\n` +
      `  Meetings ingested: ${meetings}\n` +
      `  Briefs created: ${prds}\n` +
      `  Dev jobs run: ${jobs}`
    );
  }
}
