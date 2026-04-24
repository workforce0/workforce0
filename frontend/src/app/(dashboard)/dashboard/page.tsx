"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useProjectScope } from "@/lib/use-project-scope";
import { getUser } from "@/lib/auth";
import { Header } from "@/components/header";
import { StatCard } from "@/components/stat-card";
import { ROICard } from "@/components/roi-card";
import { StatusBadge } from "@/components/status-badge";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { GettingStarted, type SetupState } from "@/components/getting-started";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Video,
  FileText,
  Ticket,
  ArrowRight,
  Clock,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Settings,
  MessageCircleQuestion,
  X,
  HandHelping,
  CheckCircle2,
  Hammer,
  Users,
  ChevronRight,
  Code2,
  Play,
} from "lucide-react";
import { timeAgo, getConfidenceLabel } from "@/lib/utils";

interface InAppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  status: string;
  createdAt: string;
}

interface DashboardData {
  overview: {
    meetings: { total: number; completed: number; active: number };
    prds: { total: number; approved: number; pending: number };
    tasks: { total: number; active: number; pendingClarifications: number };
    tickets: { total: number };
  };
  recent: {
    meetings: Array<{ id: string; title: string; status: string; startTime: string; createdAt: string }>;
    prds: Array<{ id: string; title: string; status: string; confidence: number; createdAt: string }>;
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [roiData, setRoiData] = useState<{
    hoursSavedThisWeek: number; meetingsThisWeek: number;
    prdsThisWeek: number; approvalRate: number; weekOverWeekChange: number;
  } | null>(null);
  const [featuresShipped, setFeaturesShipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(false);
  const [userName, setUserName] = useState<string>("");
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [statsRes, notifsRes, roiRes, jobsRes] = await Promise.all([
        api.getDashboardStats(),
        api.getNotifications('pending', 10),
        api.getDashboardROI(),
        api.getAgentJobs({ status: 'done' }),
      ]);
      if (statsRes.data) setData(statsRes.data);
      if (notifsRes.data) setNotifications(notifsRes.data);
      if (roiRes.data) setRoiData(roiRes.data);
      if (jobsRes.data) {
        const shipped = jobsRes.data.filter((j) => j.action === 'implement_prd').length;
        setFeaturesShipped(shipped);
      }
    } catch {
      setError("Unable to load dashboard data. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const user = getUser();
    if (user) setUserName(user.name);

    if (typeof window !== "undefined" && !localStorage.getItem("wf0_onboarding_complete")) {
      setShowOnboarding(true);
    }
    if (typeof window !== "undefined" && localStorage.getItem("wf0_checklist_dismissed")) {
      setChecklistDismissed(true);
    }
    load();
  }, [load]);
  useProjectScope(load);

  const overview = data?.overview;

  const setupState: SetupState = {
    hasIntegration: (overview?.meetings.total ?? 0) > 0 || false,
    hasMeeting: (overview?.meetings.total ?? 0) > 0,
    hasPrd: (overview?.prds.total ?? 0) > 0,
  };
  const isNewUser = !setupState.hasMeeting && !setupState.hasPrd;
  const hasActivity = (overview?.meetings.total ?? 0) > 0 || (overview?.prds.total ?? 0) > 0;

  if (showOnboarding) {
    return (
      <OnboardingWizard
        userName={userName.split(" ")[0]}
        onComplete={() => setShowOnboarding(false)}
      />
    );
  }

  function handleDismissChecklist() {
    setChecklistDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("wf0_checklist_dismissed", "true");
    }
  }

  async function handleDismissNotification(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.dismissNotification(id);
    } catch {
      // Notification already removed from UI; no need to restore
    }
  }

  const meetingsCount = overview?.meetings.total ?? 0;
  const prdsCount = overview?.prds.total ?? 0;
  const hoursSaved = (prdsCount * 4) + (featuresShipped * 40);
  const moneySaved = (prdsCount * 200) + (featuresShipped * 4000);
  const pendingApprovals = overview?.prds.pending ?? 0;

  return (
    <div className="min-h-screen">
      <Header title="Dashboard" />

      <div className="space-y-6 p-6 lg:p-8">
        {/* Hero — cinematic, calm, with live indicator and single primary CTA */}
        <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-border-strong bg-ink text-white shadow-[var(--shadow-card)]">
          <div className="bg-mesh-cool absolute inset-0 opacity-[0.35]" aria-hidden />
          <div className="bg-grid absolute inset-0 opacity-40" aria-hidden />

          <div className="relative z-10 grid gap-6 p-6 lg:grid-cols-[1.1fr_1fr] lg:p-10">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 backdrop-blur-sm">
                <span className="dot-pulse" aria-hidden />
                <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/70">
                  {hasActivity ? "AI Workforce Active" : "Getting Started"}
                </span>
              </div>
              <h2 className="font-display text-[2rem] font-semibold leading-[1.1] tracking-[-0.035em] text-white sm:text-[2.5rem]">
                {isNewUser
                  ? `Welcome${userName ? `, ${userName.split(" ")[0]}` : ""}.`
                  : pendingApprovals
                    ? `${pendingApprovals} brief${pendingApprovals > 1 ? "s" : ""} ready for review`
                    : "Your AI workforce is running"}
              </h2>
              <p className="max-w-[46ch] text-[15px] leading-relaxed text-white/60">
                {isNewUser
                  ? "Connect your meeting tool and capture your first conversation to see AI ship from transcript to PR."
                  : pendingApprovals
                    ? "Review and approve briefs — we'll automatically open tickets, draft designs, and push code."
                    : "Schedule a meeting or review pending briefs to keep things moving."}
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                {isNewUser ? (
                  <>
                    <Button variant="accent" size="default" className="glow" asChild>
                      <Link href="/settings">
                        <Settings className="h-4 w-4" />
                        Connect Meeting Tool
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="default"
                      className="text-white hover:bg-white/10"
                      asChild
                    >
                      <Link href="/meetings">
                        Schedule Meeting
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="accent" size="default" className="glow" asChild>
                      <Link href={pendingApprovals ? "/approvals" : "/meetings"}>
                        {pendingApprovals ? (
                          <>
                            <HandHelping className="h-4 w-4" />
                            Review Approvals
                          </>
                        ) : (
                          <>
                            <Video className="h-4 w-4" />
                            Schedule Meeting
                          </>
                        )}
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="default"
                      className="text-white hover:bg-white/10"
                      asChild
                    >
                      <Link href="/prds">
                        View Briefs
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Live impact panel */}
            <div className="glass-dark rounded-[var(--radius-lg)] p-5 lg:p-6">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/50">
                  AI Workforce Impact
                </span>
                <Sparkles className="h-4 w-4 text-white/40" />
              </div>
              {meetingsCount === 0 && prdsCount === 0 && featuresShipped === 0 ? (
                <p className="mt-4 text-sm text-white/60">
                  Process your first meeting to see your impact compound.
                </p>
              ) : (
                <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.12em] text-white/50">
                      Meetings
                    </dt>
                    <dd className="font-display mt-0.5 text-2xl font-semibold tabular text-white">
                      {meetingsCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.12em] text-white/50">
                      Briefs
                    </dt>
                    <dd className="font-display mt-0.5 text-2xl font-semibold tabular text-white">
                      {prdsCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.12em] text-white/50">
                      Features shipped
                    </dt>
                    <dd className="font-display mt-0.5 text-2xl font-semibold tabular text-accent">
                      {featuresShipped}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.12em] text-white/50">
                      Hours saved
                    </dt>
                    <dd className="font-display mt-0.5 text-2xl font-semibold tabular text-[var(--color-emerald)]">
                      {hoursSaved}
                      <span className="ml-1 text-sm font-medium text-white/50">hrs</span>
                    </dd>
                    <p className="mt-1 text-[11px] text-white/50 tabular">
                      ≈ ${moneySaved.toLocaleString()} saved
                    </p>
                  </div>
                </dl>
              )}
            </div>
          </div>
        </section>

        {/* Getting Started Checklist */}
        {!loading && !checklistDismissed && (
          <GettingStarted setup={setupState} onDismiss={handleDismissChecklist} />
        )}

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-rose/20 bg-rose-light p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose" />
            <p className="flex-1 text-sm font-medium text-rose">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                setLoading(true);
                window.location.reload();
              }}
              className="text-rose hover:bg-rose/10"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        )}

        {/* Needs your approval — accent-subtle banner with border-gradient */}
        {notifications.length > 0 && (
          <section
            aria-label="Pending clarifications"
            className="overflow-hidden rounded-[var(--radius-lg)] border border-transparent border-gradient bg-accent-subtle/40 shadow-[var(--shadow-card)]"
          >
            <header className="flex items-center gap-3 border-b border-border px-5 py-3">
              <span className="dot-pulse" aria-hidden />
              <MessageCircleQuestion className="h-4 w-4 text-accent" />
              <p className="text-sm font-semibold text-ink">
                {notifications.length} question{notifications.length !== 1 ? "s" : ""} from your AI team
              </p>
              <span className="ml-auto hidden text-[11px] text-ink-tertiary sm:inline">
                Your input helps deliver better results
              </span>
            </header>
            <ul className="divide-y divide-border">
              {notifications.map((notif) => (
                <li
                  key={notif.id}
                  className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-surface-hover"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent-subtle">
                    <MessageCircleQuestion className="h-[18px] w-[18px] text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{notif.title}</p>
                    <p className="mt-1 whitespace-pre-line text-sm text-ink-secondary">
                      {notif.message}
                    </p>
                    {!!(notif.metadata as Record<string, unknown> | null)?.referenceId && (
                      <Button variant="accent" size="sm" className="mt-3" asChild>
                        <Link
                          href={`/prds?clarification=${
                            (notif.metadata as Record<string, unknown>)?.referenceId
                          }`}
                        >
                          Respond to questions
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                  </div>
                  <button
                    onClick={() => handleDismissNotification(notif.id)}
                    className="shrink-0 rounded-[var(--radius-xs)] p-1 text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink"
                    aria-label="Dismiss notification"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ROI Hero Card — shown for returning users with data */}
        {!loading && roiData && hasActivity && <ROICard data={roiData} />}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-28 rounded-[var(--radius-lg)]" />
            ))
          ) : (
            <>
              <StatCard
                title="Meetings Processed"
                value={overview?.meetings.total ?? 0}
                subtitle={`${overview?.meetings.active ?? 0} being analyzed`}
                icon={Video}
              />
              <StatCard
                title="Product Briefs"
                value={overview?.prds.total ?? 0}
                subtitle={`${overview?.prds.approved ?? 0} approved, ${overview?.prds.pending ?? 0} need${
                  (overview?.prds.pending ?? 0) === 1 ? "s" : ""
                } review`}
                icon={CheckCircle2}
                iconColor="text-violet"
                iconBg="bg-violet-light"
              />
              <StatCard
                title="Needs Your Input"
                value={overview?.tasks.pendingClarifications ?? 0}
                subtitle={`${overview?.tasks.active ?? 0} tasks in progress`}
                icon={HandHelping}
                iconColor="text-amber"
                iconBg="bg-amber-light"
              />
              <StatCard
                title="Work Items Created"
                value={overview?.tickets.total ?? 0}
                subtitle={`From ${overview?.prds.approved ?? 0} approved brief${
                  (overview?.prds.approved ?? 0) === 1 ? "" : "s"
                }`}
                icon={Hammer}
                iconColor="text-emerald"
                iconBg="bg-emerald-light"
              />
            </>
          )}
        </div>

        {/* See How It Works — Sample Data for New Users */}
        {!loading && isNewUser && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="font-display text-lg font-semibold tracking-[-0.02em] text-ink">
                See how it works
              </h3>
              <Badge variant="purple">Sample</Badge>
            </div>
            <p className="-mt-2 text-sm text-ink-tertiary">
              Here is what your dashboard looks like once your AI workforce is running.
            </p>

            <Card className="border-dashed">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {[
                    { icon: Video, label: "Meeting", color: "bg-accent-subtle text-accent" },
                    { icon: FileText, label: "Brief", color: "bg-violet-light text-violet" },
                    { icon: Ticket, label: "Tickets", color: "bg-sky-light text-sky" },
                    { icon: Code2, label: "Code", color: "bg-emerald-light text-emerald" },
                  ].map((step, i) => (
                    <div key={step.label} className="flex items-center gap-2">
                      <div className="flex flex-col items-center gap-1.5">
                        <div
                          className={`flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] ${step.color}`}
                        >
                          <step.icon className="h-5 w-5" />
                        </div>
                        <span className="text-xs font-medium text-ink-secondary">
                          {step.label}
                        </span>
                      </div>
                      {i < 3 && (
                        <ChevronRight className="mt-[-18px] h-4 w-4 text-ink-faint" />
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-center text-xs text-ink-faint">
                  Your AI workforce listens to meetings, writes product briefs, creates tickets, and
                  ships code.
                </p>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="relative overflow-hidden border-dashed">
                <div className="absolute right-3 top-3">
                  <Badge variant="purple" className="text-[10px]">
                    Sample
                  </Badge>
                </div>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-accent-subtle text-accent">
                      <Video className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        Product Roadmap Discussion
                      </p>
                      <div className="mt-1.5 flex items-center gap-3">
                        <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                          <Clock className="h-3 w-3" />
                          45 min
                        </span>
                        <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                          <Users className="h-3 w-3" />4 participants
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-ink-faint">
                        The AI joins your meeting, listens, and creates a product brief
                        automatically.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden border-dashed">
                <div className="absolute right-3 top-3">
                  <Badge variant="purple" className="text-[10px]">
                    Sample
                  </Badge>
                </div>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-violet-light text-violet">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        Q3 Feature Prioritization
                      </p>
                      <div className="mt-1.5 flex items-center gap-3">
                        <Badge className="bg-emerald-light text-emerald">
                          Ready to Approve
                        </Badge>
                        <span className="text-xs text-ink-tertiary tabular">
                          3 requirements
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-ink-faint">
                        Review the brief, approve it, and Jira tickets are created instantly.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-center pt-2">
              <Button variant="accent" size="default" className="glow" asChild>
                <Link href="/meetings">
                  <Play className="h-4 w-4" />
                  Try it with your first meeting
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* Recent Activity Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                Recent Meetings
              </CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/meetings">
                  View all
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="skeleton h-14 rounded-[var(--radius-md)]"
                    />
                  ))}
                </div>
              ) : data?.recent.meetings.length === 0 ? (
                <div className="py-8 text-center">
                  <Video className="mx-auto mb-2 h-8 w-8 text-ink-faint" />
                  <p className="text-sm text-ink-tertiary">No meetings yet</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    Schedule a meeting to get started
                  </p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {data?.recent.meetings.map((meeting) => (
                    <li key={meeting.id}>
                      <Link
                        href={`/meetings/${meeting.id}`}
                        className="group flex items-center justify-between rounded-[var(--radius-md)] p-3 transition-colors hover:bg-surface-hover"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent-subtle text-accent">
                            <Video className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {meeting.title}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <Clock className="h-3 w-3 text-ink-faint" />
                              <p className="text-xs text-ink-tertiary tabular">
                                {timeAgo(meeting.createdAt)}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={meeting.status} />
                          <ArrowRight className="h-4 w-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                Recent Briefs
              </CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/prds">
                  View all
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="skeleton h-14 rounded-[var(--radius-md)]"
                    />
                  ))}
                </div>
              ) : data?.recent.prds.length === 0 ? (
                <div className="py-8 text-center">
                  <FileText className="mx-auto mb-2 h-8 w-8 text-ink-faint" />
                  <p className="text-sm text-ink-tertiary">No briefs yet</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    Briefs are created after meetings
                  </p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {data?.recent.prds.map((prd) => (
                    <li key={prd.id}>
                      <Link
                        href={`/prds/${prd.id}`}
                        className="group flex items-center justify-between rounded-[var(--radius-md)] p-3 transition-colors hover:bg-surface-hover"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-violet-light text-violet">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {prd.title}
                            </p>
                            <div className="mt-0.5 flex items-center gap-2">
                              <Badge
                                className={getConfidenceLabel(prd.confidence).color}
                                variant="default"
                                title={getConfidenceLabel(prd.confidence).description}
                              >
                                {getConfidenceLabel(prd.confidence).label}
                                <span className="ml-1 text-[10px] tabular opacity-60">
                                  {Math.round(prd.confidence * 100)}%
                                </span>
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={prd.status} />
                          <ArrowRight className="h-4 w-4 text-ink-faint opacity-0 transition group-hover:opacity-100" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
