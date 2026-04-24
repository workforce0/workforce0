/**
 * =============================================================================
 * DASHBOARD API ROUTES
 * =============================================================================
 *
 * Aggregate stats and recent activity for the executive dashboard.
 *
 * Endpoints:
 * ----------
 * GET /dashboard/stats     → Aggregate counts and metrics
 * GET /dashboard/activity  → Recent activity feed
 *
 * @module routes/dashboard
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'dashboard' });

const ActivityQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(20),
});

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /dashboard/stats
   *
   * Returns aggregate counts for the executive dashboard.
   */
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    // P1 follow-up: scope stats to the active project when one is set.
    // Null means "across all projects" (home/global view).
    const projectId = (request as FastifyRequest & { projectId: string | null }).projectId;
    const projectScope = projectId ? { projectId } : {};
    // PRD is mapped to `prds` table; its relation is `meeting.projectId`,
    // so we filter via the meeting relation when a project scope is active.
    const prdProjectScope = projectId ? { projectId } : {};

    logger.debug('Fetching dashboard stats', { tenantId, projectId });

    const prisma = fastify.services.prisma;

    // Run all counts in parallel
    const [
      totalMeetings,
      completedMeetings,
      activeMeetings,
      totalPrds,
      approvedPrds,
      pendingPrds,
      totalTasks,
      activeTasks,
      pendingClarifications,
      totalTickets,
      recentMeetings,
      recentPrds,
    ] = await Promise.all([
      prisma.meeting.count({ where: { tenantId, ...projectScope } }),
      prisma.meeting.count({ where: { tenantId, status: 'completed', ...projectScope } }),
      prisma.meeting.count({ where: { tenantId, status: { in: ['scheduled', 'joining', 'in_progress'] }, ...projectScope } }),
      prisma.pRD.count({ where: { tenantId, ...prdProjectScope } }),
      prisma.pRD.count({ where: { tenantId, status: 'approved', ...prdProjectScope } }),
      prisma.pRD.count({ where: { tenantId, status: { in: ['draft', 'pending_approval'] }, ...prdProjectScope } }),
      // N6: counts now come from Ticket (Ticket is the single source of
      // truth; legacy AgentTask rows were backfilled into it, and every
      // new AgentTask write mirrors into Ticket via TaskRepository).
      (prisma as any).ticket.count({ where: { tenantId, ...projectScope } }),
      (prisma as any).ticket.count({ where: { tenantId, status: { in: ['ready', 'claimed'] }, ...projectScope } }),
      (prisma as any).ticket.count({ where: { tenantId, status: 'waiting', ...projectScope } }),
      prisma.jiraTicket.count({
        where: { prd: { tenantId, ...prdProjectScope } },
      }),
      prisma.meeting.findMany({
        where: { tenantId, ...projectScope },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, title: true, status: true, startTime: true, createdAt: true },
      }),
      prisma.pRD.findMany({
        where: { tenantId, ...prdProjectScope },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, title: true, status: true, confidence: true, createdAt: true },
      }),
    ]);

    return reply.send({
      success: true,
      data: {
        overview: {
          meetings: { total: totalMeetings, completed: completedMeetings, active: activeMeetings },
          prds: { total: totalPrds, approved: approvedPrds, pending: pendingPrds },
          tasks: { total: totalTasks, active: activeTasks, pendingClarifications },
          tickets: { total: totalTickets },
        },
        recent: {
          meetings: recentMeetings,
          prds: recentPrds,
        },
      },
    });
  });

  /**
   * GET /dashboard/activity
   *
   * Returns a combined activity feed of recent events.
   */
  fastify.get('/activity', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const query = ActivityQuerySchema.parse(request.query);
    const limit = query.limit;

    const prisma = fastify.services.prisma;

    // Fetch recent items from all tables
    const [meetings, prds, tasks] = await Promise.all([
      prisma.meeting.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: { id: true, title: true, status: true, updatedAt: true },
      }),
      prisma.pRD.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: { id: true, title: true, status: true, confidence: true, updatedAt: true },
      }),
      // N6: activity feed reads tickets (same single source of truth).
      // We return `agentType` to preserve the legacy API shape; it maps
      // 1:1 from ticket.roleSlug.
      (prisma as any).ticket.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: { id: true, roleSlug: true, status: true, updatedAt: true },
      }).then((rows: any[]) =>
        rows.map((r) => ({
          id: r.id,
          agentType: r.roleSlug,
          status: r.status,
          updatedAt: r.updatedAt,
        })),
      ),
    ]);

    // Combine and sort by date
    const activity = [
      ...meetings.map(m => ({ type: 'meeting' as const, id: m.id, title: m.title, status: m.status, timestamp: m.updatedAt })),
      ...prds.map(p => ({ type: 'prd' as const, id: p.id, title: p.title, status: p.status, confidence: p.confidence, timestamp: p.updatedAt })),
      ...tasks.map((t: { id: string; agentType: string; status: string; updatedAt: Date }) => ({ type: 'task' as const, id: t.id, title: t.agentType, status: t.status, timestamp: t.updatedAt })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return reply.send({
      success: true,
      data: activity,
    });
  });

  /**
   * GET /dashboard/roi
   *
   * Returns ROI metrics: hours saved, meetings processed, etc.
   * Hours saved = completed meeting duration (hours) * 2 (estimated manual PRD time).
   */
  fastify.get('/roi', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    // P1 follow-up: scope ROI to the active project when set.
    const projectId = (request as FastifyRequest & { projectId: string | null }).projectId;
    const scope = projectId ? { projectId } : {};
    const prisma = fastify.services.prisma;

    // Current week (Mon-Sun)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    // Previous week
    const prevMonday = new Date(monday);
    prevMonday.setDate(prevMonday.getDate() - 7);

    const [
      thisWeekMeetings,
      prevWeekMeetings,
      thisWeekPrds,
      totalApproved,
      totalPrds,
      thisWeekTranscripts,
    ] = await Promise.all([
      prisma.meeting.count({ where: { tenantId, ...scope, status: 'completed', updatedAt: { gte: monday } } }),
      prisma.meeting.count({ where: { tenantId, ...scope, status: 'completed', updatedAt: { gte: prevMonday, lt: monday } } }),
      prisma.pRD.count({ where: { tenantId, ...scope, createdAt: { gte: monday } } }),
      prisma.pRD.count({ where: { tenantId, ...scope, status: 'approved' } }),
      prisma.pRD.count({ where: { tenantId, ...scope } }),
      prisma.transcript.findMany({
        where: {
          meeting: { tenantId, ...scope, status: 'completed', updatedAt: { gte: monday } },
        },
        select: { duration: true },
      }),
    ]);

    // Hours saved = sum of meeting durations (seconds) / 3600 * 2
    const totalMeetingSeconds = thisWeekTranscripts.reduce((sum: number, t: { duration: number }) => sum + t.duration, 0);
    const hoursSavedThisWeek = Math.round((totalMeetingSeconds / 3600) * 2 * 10) / 10;

    const approvalRate = totalPrds > 0 ? Math.round((totalApproved / totalPrds) * 100) : 0;

    const weekOverWeekChange = prevWeekMeetings > 0
      ? Math.round(((thisWeekMeetings - prevWeekMeetings) / prevWeekMeetings) * 100)
      : thisWeekMeetings > 0 ? 100 : 0;

    return reply.send({
      success: true,
      data: {
        hoursSavedThisWeek,
        meetingsThisWeek: thisWeekMeetings,
        prdsThisWeek: thisWeekPrds,
        approvalRate,
        weekOverWeekChange,
      },
    });
  });

  /**
   * GET /dashboard/analytics
   *
   * Returns detailed analytics: AI cost by agent, token usage, engagement stats.
   */
  fastify.get('/analytics', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    // P1 follow-up: project scope. TenantUsage carries no projectId
    // (token cost tracking is tenant-wide because budgets live at the
    // tenant level), so usage stays global even when a project is
    // selected; the meeting + engagement breakdowns DO scope.
    const projectId = (request as FastifyRequest & { projectId: string | null }).projectId;
    const scope = projectId ? { projectId } : {};
    const prisma = fastify.services.prisma;

    // Get last 30 days boundary
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      usageByAgent,
      totalCost,
      engagementsByPhase,
      meetingsByStatus,
      recentUsage,
    ] = await Promise.all([
      // Cost & tokens by agent type (tenant-wide — no project scope).
      prisma.tenantUsage.groupBy({
        by: ['agentType'],
        where: { tenantId },
        _sum: { inputTokens: true, outputTokens: true, costUSD: true },
        _count: true,
      }),
      // Total cost all time (tenant-wide).
      prisma.tenantUsage.aggregate({
        where: { tenantId },
        _sum: { costUSD: true, inputTokens: true, outputTokens: true },
      }),
      // Engagements by phase (project-scoped).
      prisma.engagement.groupBy({
        by: ['phase'],
        where: { tenantId, ...scope },
        _count: true,
      }),
      // Meetings by status (project-scoped).
      prisma.meeting.groupBy({
        by: ['status'],
        where: { tenantId, ...scope },
        _count: true,
      }),
      // Daily usage for last 30 days (tenant-wide).
      prisma.tenantUsage.findMany({
        where: { tenantId, createdAt: { gte: thirtyDaysAgo } },
        select: { agentType: true, costUSD: true, inputTokens: true, outputTokens: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Summarize daily usage into date buckets
    const dailyCosts: Record<string, number> = {};
    for (const u of recentUsage) {
      const day = (u.createdAt as Date).toISOString().slice(0, 10);
      dailyCosts[day] = (dailyCosts[day] || 0) + u.costUSD;
    }

    return reply.send({
      success: true,
      data: {
        costByAgent: usageByAgent.map((g: any) => ({
          agentType: g.agentType,
          totalCost: g._sum.costUSD || 0,
          inputTokens: g._sum.inputTokens || 0,
          outputTokens: g._sum.outputTokens || 0,
          jobCount: g._count,
        })),
        totals: {
          costUSD: totalCost._sum.costUSD || 0,
          inputTokens: totalCost._sum.inputTokens || 0,
          outputTokens: totalCost._sum.outputTokens || 0,
        },
        engagementsByPhase: engagementsByPhase.map((g: any) => ({
          phase: g.phase,
          count: g._count,
        })),
        meetingsByStatus: meetingsByStatus.map((g: any) => ({
          status: g.status,
          count: g._count,
        })),
        dailyCosts: Object.entries(dailyCosts).map(([date, cost]) => ({ date, cost })),
      },
    });
  });

  /**
   * GET /dashboard/meeting-analytics
   *
   * Returns aggregate meeting analytics: completion rate, average duration,
   * meeting frequency trends, top action items, sentiment distribution, and
   * most-discussed topics across all meetings.
   */
  fastify.get('/meeting-analytics', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    // P1 follow-up: scope meeting analytics to the active project.
    const projectId = (request as FastifyRequest & { projectId: string | null }).projectId;
    const meetingScope = projectId ? { projectId } : {};
    const prisma = fastify.services.prisma;

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [
      totalMeetings,
      completedMeetings,
      failedMeetings,
      transcripts,
      insights,
      recentMeetings,
    ] = await Promise.all([
      prisma.meeting.count({ where: { tenantId, ...meetingScope } }),
      prisma.meeting.count({ where: { tenantId, ...meetingScope, status: 'completed' } }),
      prisma.meeting.count({ where: { tenantId, ...meetingScope, status: 'failed' } }),
      // Get transcripts for last 90 days (duration/speaker stats)
      prisma.transcript.findMany({
        where: { meeting: { tenantId, ...meetingScope }, createdAt: { gte: ninetyDaysAgo } },
        select: { duration: true, wordCount: true, speakers: true, createdAt: true },
      }),
      // Get insights for last 90 days — filter via the meeting relation
      // so project scope flows through even though MeetingInsights
      // itself carries no projectId.
      prisma.meetingInsights.findMany({
        where: {
          tenantId,
          createdAt: { gte: ninetyDaysAgo },
          ...(projectId
            ? { meeting: { projectId } }
            : {}),
        },
        select: { actionItems: true, decisions: true, sentiment: true, topics: true, participantStats: true },
      }),
      // Recent 10 meetings with transcript duration
      prisma.meeting.findMany({
        where: { tenantId, ...meetingScope },
        orderBy: { startTime: 'desc' },
        take: 10,
        select: {
          id: true, title: true, status: true, startTime: true,
          participants: true,
          transcript: { select: { duration: true, wordCount: true, speakers: true } },
        },
      }),
    ]);

    // Avg duration (seconds)
    const totalDuration = transcripts.reduce((s, t) => s + t.duration, 0);
    const avgDurationSeconds = transcripts.length > 0 ? Math.round(totalDuration / transcripts.length) : 0;

    // Total words across all meetings
    const totalWords = transcripts.reduce((s, t) => s + t.wordCount, 0);

    // Completion rate
    const completionRate = totalMeetings > 0 ? Math.round((completedMeetings / totalMeetings) * 100) : 0;

    // Sentiment distribution
    const sentimentCounts: Record<string, number> = { positive: 0, neutral: 0, concerned: 0 };
    for (const i of insights) {
      const s = i.sentiment as string | null;
      if (s && sentimentCounts[s] !== undefined) sentimentCounts[s]++;
    }

    // Top topics across all meetings (flatten & count)
    const topicCounts = new Map<string, number>();
    for (const i of insights) {
      const topics = i.topics as string[] | null;
      if (Array.isArray(topics)) {
        for (const t of topics) {
          topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
        }
      }
    }
    const topTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count }));

    // Total action items & decisions
    let totalActionItems = 0;
    let totalDecisions = 0;
    for (const i of insights) {
      const ai = i.actionItems as unknown[];
      const d = i.decisions as unknown[];
      if (Array.isArray(ai)) totalActionItems += ai.length;
      if (Array.isArray(d)) totalDecisions += d.length;
    }

    // Meeting frequency: count per day-of-week (0=Sun..6=Sat)
    const dayOfWeekCounts: number[] = [0, 0, 0, 0, 0, 0, 0];
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const t of transcripts) {
      dayOfWeekCounts[t.createdAt.getDay()]++;
    }
    const meetingsByDayOfWeek = dayLabels.map((label, i) => ({ day: label, count: dayOfWeekCounts[i] }));

    return reply.send({
      success: true,
      data: {
        summary: {
          totalMeetings,
          completedMeetings,
          failedMeetings,
          completionRate,
          avgDurationSeconds,
          totalWords,
          totalActionItems,
          totalDecisions,
        },
        sentimentDistribution: sentimentCounts,
        meetingsByDayOfWeek,
        topTopics,
        recentMeetings: recentMeetings.map(m => ({
          id: m.id,
          title: m.title,
          status: m.status,
          startTime: m.startTime,
          durationSeconds: m.transcript?.duration ?? null,
          wordCount: m.transcript?.wordCount ?? null,
          speakerCount: Array.isArray(m.transcript?.speakers) ? (m.transcript!.speakers as string[]).length : 0,
          participantCount: Array.isArray(m.participants) ? (m.participants as unknown[]).length : 0,
        })),
      },
    });
  });
}
