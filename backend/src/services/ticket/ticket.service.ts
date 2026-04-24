/**
 * =============================================================================
 * TICKET SERVICE — M4: role-keyed pull queue
 * =============================================================================
 *
 * Unified work-item abstraction. Every piece of agent work (implement a
 * PRD, review a PR, run QA, draft a clarification) can be modelled as a
 * Ticket. The defining feature is that tickets live in a **pull queue**
 * keyed by role slug — agents don't get pushed work; they ask for it.
 *
 * Why: a new role type requires no orchestrator code change. Insert an
 * `agent_roles` row, register an agent that claims for that role, done.
 *
 * Scope in M4:
 *   - Ticket schema + TicketEvent audit log
 *   - create / claim / transition / list / findById
 *   - REST surface at /tickets
 *   - Runs in parallel to the legacy AgentTask/AgentJob flows; nothing
 *     is removed. Follow-up commits migrate BA/Dev/QA onto tickets.
 *
 * @module services/ticket
 */

import { EventEmitter } from 'node:events';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'TicketService' });

/**
 * M6 event-driven heartbeats: TicketService emits events on transitions
 * so subscribers (agent hub WebSocket dispatcher, metrics collectors,
 * UI real-time feed) can react without polling.
 *
 * Events emitted:
 *   - 'ticket.ready'   { tenantId, ticketId, roleSlug } — a ticket just
 *                        became claimable (created or moved back to
 *                        ready). Agents matching the role can wake up.
 *   - 'ticket.claimed' { tenantId, ticketId, roleSlug, agentId } — an
 *                        agent just grabbed it; UIs update.
 *   - 'ticket.done'    { tenantId, ticketId, roleSlug } — terminal
 *                        success. Parent tickets can unblock.
 *   - 'ticket.failed'  { tenantId, ticketId, roleSlug, error }
 */
export interface TicketReadyEvent { tenantId: string; ticketId: string; roleSlug: string; }
export interface TicketClaimedEvent { tenantId: string; ticketId: string; roleSlug: string; agentId: string; }
export interface TicketDoneEvent { tenantId: string; ticketId: string; roleSlug: string; }
export interface TicketFailedEvent { tenantId: string; ticketId: string; roleSlug: string; error: string; }

export type TicketStatus = 'ready' | 'claimed' | 'waiting' | 'done' | 'failed' | 'cancelled';

export interface TicketDTO {
  id: string;
  tenantId: string;
  goalId: string | null;
  parentTicketId: string | null;
  roleSlug: string;
  title: string;
  description: string;
  status: TicketStatus;
  claimedByAgent: string | null;
  claimedAt: Date | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  priority: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface TicketEventDTO {
  id: string;
  ticketId: string;
  kind: string;
  actor: string;
  data: Record<string, unknown>;
  createdAt: Date;
}

function toTicketDTO(row: any): TicketDTO {
  return {
    id: row.id,
    tenantId: row.tenantId,
    goalId: row.goalId ?? null,
    parentTicketId: row.parentTicketId ?? null,
    roleSlug: row.roleSlug,
    title: row.title,
    description: row.description,
    status: row.status,
    claimedByAgent: row.claimedByAgent ?? null,
    claimedAt: row.claimedAt ?? null,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    result: (row.result ?? null) as Record<string, unknown> | null,
    error: row.error ?? null,
    priority: row.priority,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? null,
  };
}

function toEventDTO(row: any): TicketEventDTO {
  return {
    id: row.id,
    ticketId: row.ticketId,
    kind: row.kind,
    actor: row.actor,
    data: (row.data ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

/** Which status transitions are allowed. Anything outside this map throws. */
const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  ready:     ['claimed', 'cancelled'],
  claimed:   ['waiting', 'done', 'failed', 'ready' /* release back to queue */],
  waiting:   ['claimed', 'ready', 'cancelled'],
  done:      [],
  failed:    ['ready' /* retry */],
  cancelled: [],
};

export class TicketService {
  /**
   * Exposed to the DI container + agent hub. Subscribers attach with
   * `.events.on('ticket.ready', handler)`. Marked readonly so callers
   * can't reassign the emitter out from under existing subscribers.
   */
  readonly events = new EventEmitter({ captureRejections: true });

  constructor(private readonly prisma: PrismaClient) {
    // Swallow subscriber errors — a crashing metrics collector must not
    // poison the ticket write path.
    this.events.on('error', (err) => {
      logger.warn('TicketService event listener errored', { error: (err as Error).message });
    });
  }

  /** Create a ticket in status='ready'. */
  async create(input: {
    tenantId: string;
    roleSlug: string;
    title: string;
    description?: string;
    goalId?: string | null;
    parentTicketId?: string | null;
    payload?: Record<string, unknown>;
    priority?: number;
    createdBy?: string;
    /** P1: project scope — children inherit this from their parent. */
    projectId?: string | null;
    /** N6: optional meeting link (surface tickets back to their origin meeting). */
    meetingId?: string | null;
  }): Promise<TicketDTO> {
    const ticket = await (this.prisma as any).ticket.create({
      data: {
        tenantId: input.tenantId,
        roleSlug: input.roleSlug,
        title: input.title,
        description: input.description ?? '',
        goalId: input.goalId ?? null,
        parentTicketId: input.parentTicketId ?? null,
        payload: input.payload ?? {},
        priority: input.priority ?? 100,
        createdBy: input.createdBy ?? null,
        projectId: input.projectId ?? null,
        meetingId: input.meetingId ?? null,
        status: 'ready',
      },
    });
    await this.recordEvent(ticket.id, 'created', input.createdBy ?? 'system', {
      roleSlug: input.roleSlug,
    });
    logger.info('Ticket created', { ticketId: ticket.id, roleSlug: input.roleSlug });
    // M6: emit ticket.ready so any listening agent can wake up.
    this.events.emit('ticket.ready', {
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      roleSlug: ticket.roleSlug,
    } satisfies TicketReadyEvent);
    return toTicketDTO(ticket);
  }

  /**
   * N6 final — Ticket-first primary-write path. Create a Ticket AND a
   * matching AgentTask row (reverse mirror) for legacy readers that
   * still work in AgentTask primitives. The Ticket id uses the same
   * `tix_legacy_<agentTaskId>` shape as the N6 mirror so the two rows
   * are bidirectionally addressable:
   *
   *   ticketId  ←→  agentTaskId  via  `tix_legacy_` prefix
   *
   * New entry points (MEETING_PROCESS processor, POST /briefs, POST
   * /code-generation) call this INSTEAD of `taskRepository.createTask`.
   * Downstream services that still read AgentTask keep working via
   * the reverse-mirrored row. Once all call sites migrate, the
   * deprecation warning on `TaskRepository.createTask` goes silent
   * in production logs — that's our signal that we can drop the
   * `agent_tasks` table.
   */
  async createAsNewWork(input: {
    tenantId: string;
    roleSlug: string;
    title: string;
    description?: string;
    goalId?: string | null;
    projectId?: string | null;
    meetingId?: string | null;
    payload?: Record<string, unknown>;
    /** Fields the reverse-mirror AgentTask row needs. */
    agentTaskInput?: Record<string, unknown>;
  }): Promise<{ ticket: TicketDTO; agentTaskId: string }> {
    // Generate an AgentTask id up-front so we can build the Ticket id
    // with the `tix_legacy_` prefix. Keeps the two rows addressable
    // from either side.
    const agentTaskRow = await (this.prisma as any).agentTask.create({
      data: {
        tenantId: input.tenantId,
        meetingId: input.meetingId ?? null,
        projectId: input.projectId ?? null,
        goalId: input.goalId ?? null,
        agentType: input.roleSlug,
        input: (input.agentTaskInput ?? input.payload ?? {}) as any,
        status: 'pending',
        retryCount: 0,
      },
    });
    const ticketId = `tix_legacy_${agentTaskRow.id}`;

    const ticket = await (this.prisma as any).ticket.create({
      data: {
        id: ticketId,
        tenantId: input.tenantId,
        roleSlug: input.roleSlug,
        title: input.title,
        description: input.description ?? '',
        goalId: input.goalId ?? null,
        projectId: input.projectId ?? null,
        meetingId: input.meetingId ?? null,
        payload: input.payload ?? {},
        priority: 100,
        status: 'ready',
      },
    });
    await this.recordEvent(ticket.id, 'created', 'system', {
      roleSlug: input.roleSlug,
      via: 'createAsNewWork',
      agentTaskId: agentTaskRow.id,
    });
    this.events.emit('ticket.ready', {
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      roleSlug: ticket.roleSlug,
    } satisfies TicketReadyEvent);

    logger.info('Ticket-first work created', {
      ticketId: ticket.id,
      agentTaskId: agentTaskRow.id,
      roleSlug: input.roleSlug,
    });
    return { ticket: toTicketDTO(ticket), agentTaskId: agentTaskRow.id };
  }

  /**
   * Claim the next ready ticket for a role. Single-writer via a
   * conditional UPDATE — two agents racing for the same ticket can't
   * both win. Returns null if the queue is empty.
   *
   * Priority-ordered (higher priority first), then FIFO within a priority.
   */
  async claimNext(tenantId: string, roleSlug: string, agentId: string): Promise<TicketDTO | null> {
    // Find the best candidate. We could do this with a single SQL
    // `UPDATE ... WHERE status='ready' ... RETURNING` but Prisma's
    // typed client doesn't expose that cleanly across drivers, so we do
    // find-then-conditional-update instead. Still safe because the
    // update filters on status='ready' — a racing claim lands with 0
    // rows affected and we retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await (this.prisma as any).ticket.findFirst({
        where: { tenantId, roleSlug, status: 'ready' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });
      if (!candidate) return null;

      const updated = await (this.prisma as any).ticket.updateMany({
        where: { id: candidate.id, status: 'ready' },
        data: {
          status: 'claimed',
          claimedByAgent: agentId,
          claimedAt: new Date(),
        },
      });
      if (updated.count === 0) continue; // lost the race; try the next one

      const fresh = await (this.prisma as any).ticket.findUnique({ where: { id: candidate.id } });
      await this.recordEvent(candidate.id, 'claimed', agentId, {
        from: 'ready',
        to: 'claimed',
      });
      logger.info('Ticket claimed', { ticketId: candidate.id, roleSlug, agentId });
      this.events.emit('ticket.claimed', {
        tenantId,
        ticketId: candidate.id,
        roleSlug,
        agentId,
      } satisfies TicketClaimedEvent);
      return toTicketDTO(fresh);
    }
    return null;
  }

  /**
   * Move a ticket to a new status. Records an event. Validates that the
   * transition is in ALLOWED_TRANSITIONS; throws otherwise so we catch
   * illegal state machines at the call site.
   */
  async transition(
    tenantId: string,
    ticketId: string,
    toStatus: TicketStatus,
    opts: {
      actor: string;
      result?: Record<string, unknown>;
      error?: string;
    },
  ): Promise<TicketDTO> {
    const existing = (await (this.prisma as any).ticket.findFirst({
      where: { id: ticketId, tenantId },
    })) as any;
    if (!existing) throw new Error(`Ticket ${ticketId} not found in tenant ${tenantId}`);

    const from = existing.status as TicketStatus;
    if (!ALLOWED_TRANSITIONS[from].includes(toStatus)) {
      throw new Error(`Illegal ticket transition ${from} → ${toStatus}`);
    }

    const terminal = toStatus === 'done' || toStatus === 'failed' || toStatus === 'cancelled';
    const updated = await (this.prisma as any).ticket.update({
      where: { id: ticketId },
      data: {
        status: toStatus,
        ...(opts.result !== undefined ? { result: opts.result } : {}),
        ...(opts.error !== undefined ? { error: opts.error } : {}),
        ...(terminal ? { completedAt: new Date() } : {}),
        ...(toStatus === 'ready' ? { claimedByAgent: null, claimedAt: null } : {}),
      },
    });
    await this.recordEvent(ticketId, 'status_changed', opts.actor, {
      from,
      to: toStatus,
      ...(opts.error ? { error: opts.error } : {}),
    });

    // M6: emit lifecycle events for subscribers (agent hub, metrics, UI).
    const base = { tenantId, ticketId, roleSlug: updated.roleSlug as string };
    if (toStatus === 'ready') {
      this.events.emit('ticket.ready', base satisfies TicketReadyEvent);
    } else if (toStatus === 'done') {
      this.events.emit('ticket.done', base satisfies TicketDoneEvent);
    } else if (toStatus === 'failed') {
      this.events.emit('ticket.failed', {
        ...base,
        error: opts.error ?? 'unknown',
      } satisfies TicketFailedEvent);
    }

    return toTicketDTO(updated);
  }

  /** Append a freeform comment / step log to the ticket's event stream. */
  async comment(ticketId: string, actor: string, text: string): Promise<TicketEventDTO> {
    const ev = await (this.prisma as any).ticketEvent.create({
      data: { ticketId, kind: 'comment', actor, data: { text } },
    });
    return toEventDTO(ev);
  }

  async findById(tenantId: string, ticketId: string): Promise<TicketDTO | null> {
    const row = await (this.prisma as any).ticket.findFirst({
      where: { id: ticketId, tenantId },
    });
    return row ? toTicketDTO(row) : null;
  }

  async listForTenant(
    tenantId: string,
    opts: { roleSlug?: string; status?: TicketStatus; projectId?: string | null; limit?: number } = {},
  ): Promise<TicketDTO[]> {
    const rows = (await (this.prisma as any).ticket.findMany({
      where: {
        tenantId,
        ...(opts.roleSlug ? { roleSlug: opts.roleSlug } : {}),
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: opts.limit ?? 50,
    })) as any[];
    return rows.map(toTicketDTO);
  }

  async listEvents(tenantId: string, ticketId: string): Promise<TicketEventDTO[]> {
    const ticket = await this.findById(tenantId, ticketId);
    if (!ticket) return [];
    const events = (await (this.prisma as any).ticketEvent.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    })) as any[];
    return events.map(toEventDTO);
  }

  private async recordEvent(
    ticketId: string,
    kind: string,
    actor: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await (this.prisma as any).ticketEvent.create({
        data: { ticketId, kind, actor, data },
      });
    } catch (err) {
      logger.warn('TicketEvent write failed (swallowed)', {
        ticketId,
        kind,
        error: (err as Error).message,
      });
    }
  }
}
