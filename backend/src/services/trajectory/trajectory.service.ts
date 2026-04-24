/**
 * =============================================================================
 * TRAJECTORY SERVICE — capture conversation paths for later analysis
 * =============================================================================
 *
 * Ported (pattern only) from NousResearch/hermes-agent `agent/trajectory.py`.
 *
 * Every agent turn emits a Trajectory entry: which agent acted, what they
 * read, what they produced, any tools they called, the outcome. The
 * downstream uses are:
 *   1. Skill distillation — spot recurring sequences → propose new skills
 *   2. Outcome learning — feed into AgentOutcome to close the learning loop
 *   3. Debugging — replay a conversation turn-by-turn from the log
 *
 * Storage: delegates to AuditLog so we don't add another table in this pass.
 * Migration to a dedicated Trajectory table is deferred (low risk — the
 * event shape is stable and we're appending, not querying).
 *
 * @module services/trajectory
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';

export type TrajectoryEventType =
  | 'turn_started'
  | 'tool_called'
  | 'model_called'
  | 'memory_recalled'
  | 'skill_invoked'
  | 'turn_completed'
  | 'turn_failed';

export interface TrajectoryEvent {
  tenantId: string;
  userId?: string;
  sessionId: string;
  agentName: string;          // "ba", "dev", "qa", "supervisor"
  engagementId?: string;
  prdId?: string;
  type: TrajectoryEventType;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}

export class TrajectoryService {
  private readonly logger = createChildLogger({ service: 'TrajectoryService' });

  constructor(private readonly prisma: PrismaClient) {}

  /** Record a single event. Failures are logged and swallowed — telemetry must not break the turn. */
  async record(event: TrajectoryEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: event.tenantId,
          userId: event.userId ?? null,
          action: `trajectory.${event.type}`,
          resource: 'trajectory',
          resourceId: event.sessionId,
          after: {
            agent: event.agentName,
            engagementId: event.engagementId ?? null,
            prdId: event.prdId ?? null,
            ...event.payload,
          },
        },
      });
    } catch (err) {
      this.logger.error('Trajectory record failed (swallowed)', {
        sessionId: event.sessionId,
        error: (err as Error).message,
      });
    }
  }

  /** Record an entire turn's set of events atomically. */
  async recordTurn(events: TrajectoryEvent[]): Promise<void> {
    await Promise.all(events.map((e) => this.record(e)));
  }

  /**
   * Read back a trajectory for debugging / skill-distillation feeds.
   * Returns newest-first events; callers typically reverse.
   */
  async replay(tenantId: string, sessionId: string, limit = 500): Promise<unknown[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        resource: 'trajectory',
        resourceId: sessionId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      type: r.action.replace(/^trajectory\./, ''),
      at: r.createdAt,
      payload: r.after,
    }));
  }
}
