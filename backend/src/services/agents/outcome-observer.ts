// mvp/src/services/agents/outcome-observer.ts
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger({ module: 'outcome-observer' });

type OutcomeResult = 'approved' | 'revised' | 'rejected';

export class OutcomeObserver {
  constructor(private prisma: any) {}

  /**
   * Legacy entry point — called by processors still keyed on AgentTask
   * ids. Reads AgentTask (retryCount + output.toolsUsed still live
   * there) and writes an AgentOutcome row. N6 kept AgentTask alive as
   * a read path precisely so this observer keeps working.
   */
  async recordFromTask(taskId: string): Promise<void> {
    try {
      const task = await this.prisma.agentTask.findUnique({ where: { id: taskId } });
      if (!task) {
        log.warn('Task not found for outcome recording', { taskId });
        return;
      }

      const clarifications = await this.prisma.clarificationRequest.findMany({
        where: { taskId, status: 'answered' },
        orderBy: { respondedAt: 'desc' },
      });

      const result = this.mapResult(task, clarifications);
      const revisionFeedback = clarifications.length > 0
        ? clarifications.map((c: any) => c.response).filter(Boolean).join('\n')
        : undefined;

      await this.prisma.agentOutcome.create({
        data: {
          agentType: task.agentType,
          taskId: task.id,
          result,
          confidenceScore: task.confidence || 0,
          toolsUsed: task.output?.toolsUsed || null,
          stepCount: task.output?.stepCount || null,
          revisionFeedback,
          metadata: {
            retryCount: task.retryCount,
            approvedBy: task.approvedBy,
          },
        },
      });

      log.info('Outcome recorded', { taskId, agentType: task.agentType, result });
    } catch (err) {
      log.error('Failed to record outcome', { taskId, error: (err as Error).message });
    }
  }

  /**
   * N6 native entry point — called by chief_of_staff and any new code
   * path that works in Ticket primitives. Reads the Ticket + its
   * clarifications + downstream children and writes an AgentOutcome
   * against the mirror AgentTask when the ticket id follows the legacy
   * tix_legacy_<taskId> shape, or against no taskId at all for native
   * (chief_of_staff) tickets.
   *
   * Result mapping mirrors recordFromTask:
   *   - status='failed' / 'cancelled'  → 'rejected'
   *   - status='done'  + approvedBy    → 'approved'
   *   - status='done'  + clarifications → 'revised'
   *   - status='done'  (bare)          → 'approved'
   *   - everything else                → 'rejected' (in-flight shouldn't
   *                                      reach here; defensive default)
   */
  async recordFromTicket(ticketId: string): Promise<void> {
    try {
      const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) {
        log.warn('Ticket not found for outcome recording', { ticketId });
        return;
      }

      const clarifications = await this.prisma.clarificationRequest.findMany({
        where: { ticketId, status: 'answered' },
        orderBy: { respondedAt: 'desc' },
      });

      const result = this.mapTicketResult(ticket, clarifications);
      const revisionFeedback = clarifications.length > 0
        ? clarifications.map((c: any) => c.response).filter(Boolean).join('\n')
        : undefined;

      // Derive the legacy AgentTask id for rows that came from the
      // mirror — keeps AgentOutcome's taskId FK satisfied for existing
      // analytics. Native (non-legacy) tickets write taskId=null.
      const legacyTaskId = ticket.id.startsWith('tix_legacy_')
        ? ticket.id.slice('tix_legacy_'.length)
        : null;

      const result_ = ticket.result as Record<string, unknown> | null;
      await this.prisma.agentOutcome.create({
        data: {
          agentType: ticket.roleSlug,
          taskId: legacyTaskId,
          result,
          confidenceScore: ticket.confidence || 0,
          toolsUsed: (result_?.toolsUsed as any) ?? null,
          stepCount: (result_?.stepCount as any) ?? null,
          revisionFeedback,
          metadata: {
            ticketId: ticket.id,
            approvedBy: ticket.approvedBy,
          },
        },
      });

      log.info('Outcome recorded from ticket', {
        ticketId,
        roleSlug: ticket.roleSlug,
        result,
        legacyTaskId,
      });
    } catch (err) {
      log.error('Failed to record outcome from ticket', { ticketId, error: (err as Error).message });
    }
  }

  private mapResult(task: any, clarifications: any[]): OutcomeResult {
    if (task.status === 'failed') return 'rejected';
    if (task.status === 'completed' && task.approvedBy) return 'approved';
    if (task.status === 'completed' && clarifications.length > 0) return 'revised';
    if (task.status === 'completed') return 'approved';
    return 'rejected';
  }

  private mapTicketResult(ticket: any, clarifications: any[]): OutcomeResult {
    if (ticket.status === 'failed' || ticket.status === 'cancelled') return 'rejected';
    if (ticket.status === 'done' && ticket.approvedBy) return 'approved';
    if (ticket.status === 'done' && clarifications.length > 0) return 'revised';
    if (ticket.status === 'done') return 'approved';
    return 'rejected';
  }
}
