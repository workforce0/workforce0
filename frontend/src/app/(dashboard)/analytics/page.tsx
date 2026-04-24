"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useProjectScope } from "@/lib/use-project-scope";
import { Header } from "@/components/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign,
  TrendingUp,
  Clock,
  Bot,
  Target,
  Activity,
  Loader2,
  Video,
  CheckCircle2,
  ListChecks,
  Hash,
} from "lucide-react";

interface AnalyticsData {
  costByAgent: Array<{ agentType: string; totalCost: number; inputTokens: number; outputTokens: number; jobCount: number }>;
  totals: { costUSD: number; inputTokens: number; outputTokens: number };
  engagementsByPhase: Array<{ phase: string; count: number }>;
  meetingsByStatus: Array<{ status: string; count: number }>;
  dailyCosts: Array<{ date: string; cost: number }>;
}

interface ROIData {
  hoursSavedThisWeek: number;
  meetingsThisWeek: number;
  prdsThisWeek: number;
  approvalRate: number;
  weekOverWeekChange: number;
}

interface MeetingAnalyticsData {
  summary: {
    totalMeetings: number;
    completedMeetings: number;
    failedMeetings: number;
    completionRate: number;
    avgDurationSeconds: number;
    totalWords: number;
    totalActionItems: number;
    totalDecisions: number;
  };
  sentimentDistribution: Record<string, number>;
  meetingsByDayOfWeek: Array<{ day: string; count: number }>;
  topTopics: Array<{ topic: string; count: number }>;
  recentMeetings: Array<{
    id: string;
    title: string;
    status: string;
    startTime: string;
    durationSeconds: number | null;
    wordCount: number | null;
    speakerCount: number;
    participantCount: number;
  }>;
}

const PHASE_LABELS: Record<string, string> = {
  listen: "Listen",
  understand: "Understand",
  analyze_ask: "Analyze & Ask",
  approve: "Approve",
  build: "Build",
  test: "Test",
  ship: "Ship",
  learn: "Learn",
};

const AGENT_LABELS: Record<string, string> = {
  ba_agent: "Business Analyst",
  dev_agent: "Developer",
  qa_agent: "QA Engineer",
  meeting_brain: "Meeting Brain",
  supervisor: "Supervisor",
  memory_optimizer: "Memory",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "bg-[var(--color-emerald)]",
  neutral: "bg-sky",
  concerned: "bg-amber",
};

const SENTIMENT_LABELS: Record<string, string> = {
  positive: "Positive",
  neutral: "Neutral",
  concerned: "Concerned",
};

function formatCost(cost: number): string {
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [roi, setRoi] = useState<ROIData | null>(null);
  const [meetingAnalytics, setMeetingAnalytics] = useState<MeetingAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // P1: api client auto-attaches X-Project-Id from the active
      // project, so all three endpoints filter to the current scope.
      const [analyticsRes, roiRes, meetingRes] = await Promise.all([
        api.getAnalytics(),
        api.getDashboardROI(),
        api.getMeetingAnalytics(),
      ]);
      if (analyticsRes.data) setAnalytics(analyticsRes.data as unknown as AnalyticsData);
      if (roiRes.data) setRoi(roiRes.data);
      if (meetingRes.data) setMeetingAnalytics(meetingRes.data as unknown as MeetingAnalyticsData);
    } catch {
      setError("Unable to load analytics. Please try again later.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useProjectScope(load);

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header title="Analytics" />
        <div className="p-6 lg:p-8 flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-ink-faint" />
        </div>
      </div>
    );
  }

  const hasData = analytics && (analytics.totals.costUSD > 0 || analytics.engagementsByPhase.length > 0);
  const hasMeetingData = meetingAnalytics && meetingAnalytics.summary.totalMeetings > 0;

  return (
    <div className="min-h-screen">
      <Header title="Analytics" />

      <div className="max-w-6xl space-y-6 p-6 lg:p-8">
        <div className="space-y-2">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
            Analytics
          </h2>
          <p className="max-w-[60ch] text-sm text-ink-secondary">
            Token usage, approval rates, meeting throughput, and sentiment
            trends — all tabular, motion-aware, and color-accessible.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-amber/25 bg-amber-light p-3 text-sm text-amber">
            <Activity className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pb-4 pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-[color:var(--color-emerald-light)]">
                  <Clock className="h-5 w-5 text-[var(--color-emerald)]" />
                </div>
                <div>
                  <p className="font-display text-2xl font-semibold tabular text-ink">
                    {roi?.hoursSavedThisWeek ?? 0}h
                  </p>
                  <p className="text-xs text-ink-tertiary">
                    Hours saved this week
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pb-4 pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-sky-light">
                  <TrendingUp className="h-5 w-5 text-sky" />
                </div>
                <div>
                  <p className="font-display text-2xl font-semibold tabular text-ink">
                    {roi?.approvalRate ?? 0}%
                  </p>
                  <p className="text-xs text-ink-tertiary">
                    Brief approval rate
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pb-4 pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-violet-light">
                  <DollarSign className="h-5 w-5 text-violet" />
                </div>
                <div>
                  <p className="font-display text-2xl font-semibold tabular text-ink">
                    {formatCost(analytics?.totals.costUSD ?? 0)}
                  </p>
                  <p className="text-xs text-ink-tertiary">Total AI spend</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pb-4 pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-accent-subtle">
                  <Bot className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <p className="font-display text-2xl font-semibold tabular text-ink">
                    {formatTokens(
                      (analytics?.totals.inputTokens ?? 0) +
                        (analytics?.totals.outputTokens ?? 0),
                    )}
                  </p>
                  <p className="text-xs text-ink-tertiary">Total tokens used</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabbed Analytics */}
        <Tabs defaultValue="ai-costs">
          <TabsList>
            <TabsTrigger value="ai-costs">AI & Costs</TabsTrigger>
            <TabsTrigger value="meetings">Meetings</TabsTrigger>
          </TabsList>

          {/* ── AI & Costs Tab ─────────────────────────────────────── */}
          <TabsContent value="ai-costs" className="mt-4">
            {!hasData ? (
              <Card className="glass-strong">
                <CardContent className="py-16 text-center">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-accent-subtle">
                    <Activity className="h-7 w-7 text-accent" />
                  </div>
                  <h3 className="font-display text-xl font-semibold tracking-[-0.025em] text-ink">
                    No analytics data yet
                  </h3>
                  <p className="mx-auto mt-1 max-w-md text-sm text-ink-secondary">
                    Analytics will appear once your AI team starts processing
                    meetings and generating briefs.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {/* AI Cost by Agent */}
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                      AI Cost by Agent
                    </CardTitle>
                    <CardDescription>
                      Token usage and cost breakdown per agent type. Sorted by
                      spend.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analytics!.costByAgent.length === 0 ? (
                      <p className="py-4 text-center text-sm text-ink-tertiary">
                        No AI usage recorded yet
                      </p>
                    ) : (
                      <ul className="space-y-4">
                        {analytics!.costByAgent
                          .sort((a, b) => b.totalCost - a.totalCost)
                          .map((agent, idx) => {
                            const maxCost = Math.max(
                              ...analytics!.costByAgent.map((a) => a.totalCost),
                            );
                            const pct = maxCost > 0 ? (agent.totalCost / maxCost) * 100 : 0;
                            const isTop = idx === 0;

                            return (
                              <li key={agent.agentType}>
                                <div className="mb-1.5 flex items-center justify-between gap-4">
                                  <span className="truncate text-sm font-medium text-ink">
                                    {AGENT_LABELS[agent.agentType] || agent.agentType}
                                  </span>
                                  <div className="flex shrink-0 items-center gap-3">
                                    <span className="font-mono text-[11px] text-ink-tertiary tabular">
                                      {agent.jobCount} job{agent.jobCount === 1 ? "" : "s"}
                                    </span>
                                    <span className="font-display text-sm font-semibold tabular text-ink">
                                      {formatCost(agent.totalCost)}
                                    </span>
                                  </div>
                                </div>
                                <div
                                  className="h-2 overflow-hidden rounded-full bg-border"
                                  role="progressbar"
                                  aria-valuenow={Math.round(pct)}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-label={`${AGENT_LABELS[agent.agentType] || agent.agentType} spend`}
                                >
                                  <div
                                    className={`h-full rounded-full transition-all duration-[420ms] ${
                                      isTop ? "bg-accent" : "bg-accent/55"
                                    }`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <p className="mt-1 font-mono text-[10px] text-ink-tertiary tabular">
                                  {formatTokens(agent.inputTokens)} in ·{" "}
                                  {formatTokens(agent.outputTokens)} out
                                </p>
                              </li>
                            );
                          })}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                {/* Engagement Pipeline */}
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                      Engagement Pipeline
                    </CardTitle>
                    <CardDescription>
                      Engagements currently in each lifecycle phase.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analytics!.engagementsByPhase.length === 0 ? (
                      <p className="py-4 text-center text-sm text-ink-tertiary">
                        No engagements yet
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {[
                          "listen",
                          "understand",
                          "analyze_ask",
                          "approve",
                          "build",
                          "test",
                          "ship",
                          "learn",
                        ].map((phase) => {
                          const entry = analytics!.engagementsByPhase.find(
                            (e) => e.phase === phase,
                          );
                          const count = entry?.count ?? 0;
                          const maxCount = Math.max(
                            ...analytics!.engagementsByPhase.map((e) => e.count),
                            1,
                          );
                          const pct = (count / maxCount) * 100;

                          return (
                            <li
                              key={phase}
                              className="flex items-center gap-3"
                              title={`${PHASE_LABELS[phase] || phase}: ${count}`}
                            >
                              <span className="w-24 shrink-0 text-right text-xs text-ink-secondary">
                                {PHASE_LABELS[phase] || phase}
                              </span>
                              <div
                                className="relative h-7 flex-1 overflow-hidden rounded-[var(--radius-sm)] bg-border/60"
                                role="progressbar"
                                aria-valuenow={count}
                                aria-valuemin={0}
                                aria-valuemax={maxCount}
                              >
                                <div
                                  className="h-full rounded-[var(--radius-sm)] bg-accent-subtle transition-all duration-[420ms]"
                                  style={{ width: `${pct}%` }}
                                />
                                <span className="absolute inset-y-0 left-2.5 flex items-center font-display text-xs font-semibold tabular text-ink">
                                  {count}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                {/* Meeting Status */}
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                      Meeting Status
                    </CardTitle>
                    <CardDescription>
                      Distribution of meeting outcomes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analytics!.meetingsByStatus.length === 0 ? (
                      <p className="py-4 text-center text-sm text-ink-tertiary">
                        No meetings yet
                      </p>
                    ) : (
                      <ul className="grid grid-cols-2 gap-3">
                        {analytics!.meetingsByStatus
                          .sort((a, b) => b.count - a.count)
                          .map((m) => {
                            const total = analytics!.meetingsByStatus.reduce(
                              (s, x) => s + x.count,
                              0,
                            );
                            const pct = total > 0 ? (m.count / total) * 100 : 0;
                            const tone =
                              m.status === "completed"
                                ? "bg-[color:var(--color-emerald-light)] text-[var(--color-emerald)]"
                                : m.status === "failed"
                                  ? "bg-rose-light text-rose"
                                  : "bg-surface-sunken text-ink-secondary";
                            return (
                              <li
                                key={m.status}
                                className={`flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 ${tone}`}
                              >
                                <div>
                                  <p className="text-[11px] font-medium uppercase tracking-[0.1em]">
                                    {m.status}
                                  </p>
                                  <p className="font-display text-xl font-semibold tabular">
                                    {m.count}
                                  </p>
                                </div>
                                <span className="font-mono text-[11px] tabular opacity-70">
                                  {pct.toFixed(0)}%
                                </span>
                              </li>
                            );
                          })}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                {/* Daily Spend (last 30 days) */}
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                      Daily AI Spend
                    </CardTitle>
                    <CardDescription>
                      Cost trend over the last 30 days. Darker bar marks the
                      peak.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analytics!.dailyCosts.length === 0 ? (
                      <p className="py-4 text-center text-sm text-ink-tertiary">
                        No spending data yet
                      </p>
                    ) : (
                      (() => {
                        const maxCost = Math.max(
                          ...analytics!.dailyCosts.map((d) => d.cost),
                          0.01,
                        );
                        const total = analytics!.dailyCosts.reduce(
                          (s, d) => s + d.cost,
                          0,
                        );
                        const days = analytics!.dailyCosts.length;
                        const avg = total / Math.max(days, 1);

                        return (
                          <div className="space-y-3">
                            <div className="flex items-end gap-[3px] h-32">
                              {analytics!.dailyCosts.map((day) => {
                                const heightPct = Math.max(
                                  (day.cost / maxCost) * 100,
                                  3,
                                );
                                const isPeak = day.cost === maxCost && maxCost > 0;
                                return (
                                  <div
                                    key={day.date}
                                    className={`flex-1 rounded-t transition-[height,background-color] duration-[420ms] cursor-default ${
                                      isPeak
                                        ? "bg-accent"
                                        : "bg-accent/45 hover:bg-accent/80"
                                    }`}
                                    style={{ height: `${heightPct}%` }}
                                    title={`${day.date}: ${formatCost(day.cost)}`}
                                    aria-label={`${day.date} ${formatCost(day.cost)}`}
                                  />
                                );
                              })}
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[10px] text-ink-tertiary tabular">
                                {analytics!.dailyCosts[0]?.date}
                              </span>
                              <div className="flex items-center gap-3 text-[11px] tabular text-ink-tertiary">
                                <span>
                                  Avg{" "}
                                  <span className="font-semibold text-ink">
                                    {formatCost(avg)}
                                  </span>
                                  /day
                                </span>
                                <span className="text-ink-faint">·</span>
                                <span>
                                  Peak{" "}
                                  <span className="font-semibold text-accent">
                                    {formatCost(maxCost)}
                                  </span>
                                </span>
                              </div>
                              <span className="font-mono text-[10px] text-ink-tertiary tabular">
                                {analytics!.dailyCosts[days - 1]?.date}
                              </span>
                            </div>
                          </div>
                        );
                      })()
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* ── Meetings Tab ───────────────────────────────────────── */}
          <TabsContent value="meetings" className="mt-4">
            {!hasMeetingData ? (
              <Card className="glass-strong">
                <CardContent className="py-16 text-center">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-accent-subtle">
                    <Video className="h-7 w-7 text-accent" />
                  </div>
                  <h3 className="font-display text-xl font-semibold tracking-[-0.025em] text-ink">
                    No meeting data yet
                  </h3>
                  <p className="mx-auto mt-1 max-w-md text-sm text-ink-secondary">
                    Meeting analytics will appear after your first meeting is
                    processed.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Meeting summary cards */}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Card>
                    <CardContent className="pb-4 pt-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-sky-light">
                          <Video className="h-5 w-5 text-sky" />
                        </div>
                        <div>
                          <p className="font-display text-2xl font-semibold tabular text-ink">
                            {meetingAnalytics!.summary.totalMeetings}
                          </p>
                          <p className="text-xs text-ink-tertiary">
                            Total meetings
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pb-4 pt-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-[color:var(--color-emerald-light)]">
                          <CheckCircle2 className="h-5 w-5 text-[var(--color-emerald)]" />
                        </div>
                        <div>
                          <p className="font-display text-2xl font-semibold tabular text-ink">
                            {meetingAnalytics!.summary.completionRate}%
                          </p>
                          <p className="text-xs text-ink-tertiary">
                            Completion rate
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pb-4 pt-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-violet-light">
                          <Clock className="h-5 w-5 text-violet" />
                        </div>
                        <div>
                          <p className="font-display text-2xl font-semibold tabular text-ink">
                            {formatDuration(
                              meetingAnalytics!.summary.avgDurationSeconds,
                            )}
                          </p>
                          <p className="text-xs text-ink-tertiary">
                            Avg duration
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pb-4 pt-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-amber-light">
                          <ListChecks className="h-5 w-5 text-amber" />
                        </div>
                        <div>
                          <p className="font-display text-2xl font-semibold tabular text-ink">
                            {meetingAnalytics!.summary.totalActionItems}
                          </p>
                          <p className="text-xs text-ink-tertiary">
                            Action items captured
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  {/* Meeting Frequency by Day */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                        Meeting Frequency
                      </CardTitle>
                      <CardDescription>
                        Meetings distributed by day of the week.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {(() => {
                        const data = meetingAnalytics!.meetingsByDayOfWeek;
                        const max = Math.max(...data.map((x) => x.count), 1);
                        const peakIdx = data.findIndex((d) => d.count === max);
                        return (
                          <div className="flex h-36 items-end gap-2">
                            {data.map((d, i) => {
                              const heightPct = Math.max((d.count / max) * 100, 4);
                              const isPeak = i === peakIdx && max > 0;
                              return (
                                <div
                                  key={d.day}
                                  className="flex flex-1 flex-col items-center gap-1"
                                >
                                  <span
                                    className={`font-display text-xs font-semibold tabular ${
                                      isPeak ? "text-accent" : "text-ink"
                                    }`}
                                  >
                                    {d.count}
                                  </span>
                                  <div
                                    className={`w-full rounded-t transition-[height,background-color] duration-[420ms] ${
                                      isPeak
                                        ? "bg-accent shadow-[0_0_12px_var(--color-accent-glow)]"
                                        : "bg-accent/50 hover:bg-accent/80"
                                    }`}
                                    style={{ height: `${heightPct}%` }}
                                    title={`${d.day}: ${d.count} meeting${d.count === 1 ? "" : "s"}`}
                                    aria-label={`${d.day} ${d.count}`}
                                  />
                                  <span className="text-[10px] uppercase tracking-[0.08em] text-ink-tertiary">
                                    {d.day}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  {/* Sentiment Distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                        Meeting Sentiment
                      </CardTitle>
                      <CardDescription>
                        Overall tone across your captured meetings.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {(() => {
                        const total = Object.values(
                          meetingAnalytics!.sentimentDistribution,
                        ).reduce((s, v) => s + v, 0);
                        if (total === 0) {
                          return (
                            <p className="py-4 text-center text-sm text-ink-tertiary">
                              No sentiment data yet
                            </p>
                          );
                        }
                        return (
                          <div className="space-y-4">
                            {/* Stacked bar */}
                            <div className="flex h-7 overflow-hidden rounded-full bg-border/60">
                              {["positive", "neutral", "concerned"].map((key) => {
                                const val =
                                  meetingAnalytics!.sentimentDistribution[key] || 0;
                                const pct = total > 0 ? (val / total) * 100 : 0;
                                if (pct === 0) return null;
                                return (
                                  <div
                                    key={key}
                                    className={`${SENTIMENT_COLORS[key]} transition-all duration-[420ms]`}
                                    style={{ width: `${pct}%` }}
                                    title={`${SENTIMENT_LABELS[key]}: ${val} (${Math.round(pct)}%)`}
                                  />
                                );
                              })}
                            </div>
                            {/* Legend */}
                            <ul className="grid grid-cols-3 gap-2">
                              {["positive", "neutral", "concerned"].map((key) => {
                                const val =
                                  meetingAnalytics!.sentimentDistribution[key] || 0;
                                const pct = total > 0 ? (val / total) * 100 : 0;
                                return (
                                  <li
                                    key={key}
                                    className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface-sunken/60 px-2.5 py-1.5"
                                  >
                                    <div
                                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${SENTIMENT_COLORS[key]}`}
                                    />
                                    <div className="min-w-0">
                                      <p className="truncate text-[11px] font-medium text-ink">
                                        {SENTIMENT_LABELS[key]}
                                      </p>
                                      <p className="font-mono text-[10px] text-ink-tertiary tabular">
                                        {val} · {pct.toFixed(0)}%
                                      </p>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  {/* Top Topics */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                        Top Discussion Topics
                      </CardTitle>
                      <CardDescription>
                        Most frequently discussed topics across meetings.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {meetingAnalytics!.topTopics.length === 0 ? (
                        <p className="py-4 text-center text-sm text-ink-tertiary">
                          No topics extracted yet
                        </p>
                      ) : (
                        (() => {
                          const max = Math.max(
                            ...meetingAnalytics!.topTopics.map((t) => t.count),
                            1,
                          );
                          return (
                            <ul className="flex flex-wrap gap-2">
                              {meetingAnalytics!.topTopics.map((t) => {
                                const intensity = t.count / max;
                                // Larger / darker pill for more-frequent topics
                                const opacity =
                                  0.5 + Math.min(intensity, 1) * 0.5;
                                return (
                                  <li key={t.topic}>
                                    <span
                                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-accent"
                                      style={{
                                        backgroundColor: `rgba(99, 102, 241, ${(intensity * 0.18 + 0.06).toFixed(3)})`,
                                        borderColor: `rgba(99, 102, 241, ${(intensity * 0.3 + 0.12).toFixed(3)})`,
                                        borderWidth: 1,
                                        opacity,
                                      }}
                                      title={`${t.topic} mentioned in ${t.count} meeting${t.count === 1 ? "" : "s"}`}
                                    >
                                      <Hash className="h-3 w-3" />
                                      {t.topic}
                                      <span className="font-mono text-[10px] tabular opacity-70">
                                        {t.count}
                                      </span>
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          );
                        })()
                      )}
                    </CardContent>
                  </Card>

                  {/* Recent Meetings Table */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                        Recent Meetings
                      </CardTitle>
                      <CardDescription>
                        Last 10 meetings with key metrics.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {meetingAnalytics!.recentMeetings.length === 0 ? (
                        <p className="py-4 text-center text-sm text-ink-tertiary">
                          No meetings yet
                        </p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {meetingAnalytics!.recentMeetings.map((m) => (
                            <li
                              key={m.id}
                              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-ink">
                                  {m.title}
                                </p>
                                <p className="mt-0.5 font-mono text-[11px] text-ink-tertiary tabular">
                                  {new Date(m.startTime).toLocaleDateString()}
                                  {m.durationSeconds !== null &&
                                    ` · ${formatDuration(m.durationSeconds)}`}
                                  {m.speakerCount > 0 &&
                                    ` · ${m.speakerCount} speaker${m.speakerCount === 1 ? "" : "s"}`}
                                </p>
                              </div>
                              <Badge
                                variant={
                                  m.status === "completed"
                                    ? "success"
                                    : m.status === "failed"
                                      ? "error"
                                      : "default"
                                }
                                className="ml-2 shrink-0 uppercase tracking-[0.08em]"
                              >
                                {m.status}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
