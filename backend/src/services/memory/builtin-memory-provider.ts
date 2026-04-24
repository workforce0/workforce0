/**
 * =============================================================================
 * BUILTIN MEMORY PROVIDER — Postgres-backed MEMORY/USER rows per tenant
 * =============================================================================
 *
 * Fills in the "always-on" provider that MemoryManager expects. Stores
 * atomic memory entries (preferences, decisions, facts) in the existing
 * AuditLog table keyed by action `memory.*` — avoids a new Prisma table
 * in this pass while still giving us persistence + tenant scoping + RLS.
 *
 * Full-text session search via Postgres `to_tsvector` is deferred to a
 * follow-up migration — this v1 uses case-insensitive ILIKE on recent
 * entries, which is good enough while memory volume is small.
 *
 * @module services/memory/builtin-memory-provider
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import type {
  MemoryProvider,
  MemoryProviderContext,
  MemoryToolSchema,
} from './memory-provider.js';
import { createChildLogger } from '../../lib/logger.js';

const MEMORY_ACTION_PREFIX = 'memory.';
const DEFAULT_RECALL_LIMIT = 10;

export class BuiltinMemoryProvider implements MemoryProvider {
  readonly name = 'builtin';
  readonly isBuiltin = true;

  private readonly logger = createChildLogger({ service: 'BuiltinMemoryProvider' });
  private currentContext: MemoryProviderContext | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  isAvailable(): boolean {
    return true;
  }

  async initialize(ctx: MemoryProviderContext): Promise<void> {
    this.currentContext = ctx;
  }

  systemPromptBlock(): string {
    return `You have access to persistent memory via the memory_add / memory_search tools. Use memory_add to save things the user tells you they want remembered ("always use formal tone when writing to the board", "Priya prefers briefs under 300 words"). Use memory_search before answering when past context would help.`;
  }

  async prefetch(query: string, _sessionId: string): Promise<string> {
    if (!this.currentContext?.tenantId) return '';
    const normalized = query.trim();
    if (normalized.length < 3) return '';

    // Hermes III M6: Postgres to_tsvector / plainto_tsquery for ranked recall.
    // Backed by the partial GIN index audit_logs_memory_content_fts_idx
    // (migrations/20260419000032_memory_fts_index). Falls back to an
    // empty result set on query errors — memory must never block a turn.
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ content: string | null }>
      >`
        SELECT after->>'content' AS content
        FROM audit_logs
        WHERE "tenantId" = ${this.currentContext.tenantId}
          AND action LIKE ${MEMORY_ACTION_PREFIX + '%'}
          AND to_tsvector('english', COALESCE(after->>'content', '')) @@ plainto_tsquery('english', ${normalized})
        ORDER BY ts_rank(
          to_tsvector('english', COALESCE(after->>'content', '')),
          plainto_tsquery('english', ${normalized})
        ) DESC,
        "createdAt" DESC
        LIMIT ${DEFAULT_RECALL_LIMIT}
      `;

      if (rows.length === 0) return '';
      return rows
        .map((r) => `- ${r.content ?? ''}`)
        .filter((line) => line.length > 2)
        .join('\n');
    } catch (err) {
      this.logger.warn('Memory FTS query failed; returning empty recall', {
        error: (err as Error).message,
      });
      return '';
    }
  }

  async syncTurn(
    _userContent: string,
    _assistantContent: string,
    _sessionId: string,
  ): Promise<void> {
    // Builtin provider doesn't auto-capture — it relies on the model
    // calling memory_add explicitly when the user asks to remember
    // something. This mirrors Hermes's design and avoids noisy auto-saves.
  }

  getToolSchemas(): MemoryToolSchema[] {
    return [
      {
        name: 'memory_add',
        description:
          'Save a single fact / preference / decision the user wants remembered across future sessions. Keep entries short (1–2 sentences) and specific.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The fact to remember.' },
          },
          required: ['content'],
        },
      },
      {
        name: 'memory_search',
        description:
          'Search previously saved memory entries for relevant past preferences or decisions. Use this when the user asks "what did we decide about X?" or before writing in a tone/style context.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Free-text search query.' },
          },
          required: ['query'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.currentContext?.tenantId) {
      return JSON.stringify({ error: 'No active memory context' });
    }

    if (name === 'memory_add') {
      const content = String(args.content ?? '').trim();
      if (content.length === 0) return JSON.stringify({ ok: false, error: 'Empty content' });
      await this.prisma.auditLog.create({
        data: {
          tenantId: this.currentContext.tenantId,
          userId: this.currentContext.userId ?? null,
          action: `${MEMORY_ACTION_PREFIX}add`,
          resource: 'memory',
          resourceId: this.currentContext.sessionId,
          after: { content, sessionId: this.currentContext.sessionId },
        },
      });
      return JSON.stringify({ ok: true, saved: content });
    }

    if (name === 'memory_search') {
      const query = String(args.query ?? '').trim();
      const recalled = await this.prefetch(query, this.currentContext.sessionId);
      return JSON.stringify({ ok: true, recalled: recalled || '(no matches)' });
    }

    return JSON.stringify({ ok: false, error: `Unknown tool ${name}` });
  }

  async shutdown(): Promise<void> {
    this.currentContext = null;
  }
}
