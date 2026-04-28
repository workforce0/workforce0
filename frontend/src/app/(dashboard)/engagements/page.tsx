"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useProjectScope } from "@/lib/use-project-scope";
import { Header } from "@/components/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { timeAgo, getConfidenceLabel } from "@/lib/utils";
import {
  Activity,
  Pause,
  Play,
  Clock,
  Loader2,
  Inbox,
  Video,
  Headphones,
  Brain,
  Search,
  CheckCircle,
  Hammer,
  ShieldAlert,
  Rocket,
  GraduationCap,
} from "lucide-react";

const PHASES = [
  { key: "listen", label: "Listen", icon: Headphones, description: "AI joins your meeting and captures everything discussed" },
  { key: "understand", label: "Understand", icon: Brain, description: "AI analyzes the transcript to extract requirements and context" },
  { key: "analyze_ask", label: "Analyze", icon: Search, description: "AI asks clarifying questions if anything is unclear" },
  { key: "approve", label: "Approve", icon: CheckCircle, description: "You review the generated brief and approve or request changes" },
  { key: "build", label: "Build", icon: Hammer, description: "AI creates Jira tickets and starts building the solution" },
  { key: "test", label: "Test", icon: ShieldAlert, description: "QA agent verifies everything works as expected" },
  { key: "ship", label: "Ship", icon: Rocket, description: "Code is submitted for review and merged" },
  { key: "learn", label: "Learn", icon: GraduationCap, description: "AI reviews outcomes to improve for next time" },
];

interface Engagement {
  id: string;
  tenantId: string;
  title: string;
  status: string;
  phase: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

function PhaseProgress({ currentPhase, status }: { currentPhase: string; status: string }) {
  const currentIndex = PHASES.findIndex((p) => p.key === currentPhase);

  return (
    <div className="relative w-full">
      <div
        className="absolute left-0 right-0 top-[7px] h-[2px] bg-border"
        aria-hidden
      />
      <div
        className="absolute left-0 top-[7px] h-[2px] bg-accent transition-all duration-[420ms]"
        style={{
          width: `${
            currentIndex <= 0
              ? 0
              : ((currentIndex + 0.5) / (PHASES.length - 1)) * 100
          }%`,
        }}
        aria-hidden
      />
      <div className="relative flex items-start gap-1">
        {PHASES.map((phase, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPaused = isCurrent && status === "paused";
          const Icon = phase.icon;

          return (
            <div
              key={phase.key}
              className="group relative flex flex-1 flex-col items-center gap-1.5"
              title={phase.description}
            >
              <span
                className={cn(
                  "relative z-10 flex h-4 w-4 items-center justify-center rounded-full border-2 transition-colors",
                  isCompleted &&
                    "border-accent bg-accent",
                  isCurrent &&
                    !isPaused &&
                    "border-accent bg-surface shadow-[0_0_10px_var(--color-accent-glow)]",
                  isPaused && "border-amber bg-surface",
                  !isCompleted &&
                    !isCurrent &&
                    "border-border bg-surface",
                )}
              >
                {isCurrent && !isPaused && (
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </span>
              <div className="mt-1 flex items-center gap-1">
                <Icon
                  className={cn(
                    "h-3 w-3",
                    isCompleted && "text-accent",
                    isCurrent && !isPaused && "text-accent",
                    isPaused && "text-amber",
                    !isCompleted && !isCurrent && "text-ink-faint",
                  )}
                />
                <span
                  className={cn(
                    "text-[10px] font-medium leading-none",
                    isCompleted && "text-ink-secondary",
                    isCurrent && !isPaused && "text-ink",
                    isPaused && "text-amber",
                    !isCompleted && !isCurrent && "text-ink-tertiary",
                  )}
                >
                  {phase.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function statusBadgeVariant(status: string): "success" | "info" | "warning" | "default" {
  switch (status) {
    case "active":
      return "info";
    case "completed":
      return "success";
    case "paused":
      return "warning";
    default:
      return "default";
  }
}

function EmptyState() {
  return (
    <Card className="glass-strong">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-accent-subtle">
          <Inbox className="h-7 w-7 text-accent" />
        </div>
        <h3 className="font-display text-xl font-semibold tracking-[-0.025em] text-ink">
          No engagements yet
        </h3>
        <p className="mt-1 max-w-sm text-sm text-ink-secondary">
          Engagements are created automatically when your AI team processes a
          meeting.
        </p>
        <Button variant="accent" className="glow mt-4" asChild>
          <Link href="/meetings">
            <Video className="h-4 w-4" />
            Schedule a meeting
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function EngagementsPage() {
  const toast = useToast();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");

  const loadEngagements = useCallback(async () => {
    try {
      const statusFilter = activeTab === "all" ? undefined : activeTab;
      const res = await api.getEngagements(statusFilter);
      setEngagements(res.data || []);
    } catch {
      toast.error("Failed to load engagements", "Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setLoading(true);
    loadEngagements();
  }, [loadEngagements]);
  useProjectScope(loadEngagements);

  async function handlePause(id: string) {
    setActionLoading(id);
    try {
      await api.pauseEngagement(id);
      toast.success("Engagement paused");
      await loadEngagements();
    } catch (err) {
      toast.error("Failed to pause", (err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResume(id: string) {
    setActionLoading(id);
    try {
      await api.resumeEngagement(id);
      toast.success("Engagement resumed");
      await loadEngagements();
    } catch (err) {
      toast.error("Failed to resume", (err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header title="Engagements" />
        <div className="p-6 lg:p-8 max-w-5xl space-y-4">
          <div className="skeleton h-10 w-80" />
          <div className="skeleton h-36" />
          <div className="skeleton h-36" />
          <div className="skeleton h-36" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Engagements" />

      <div className="max-w-5xl space-y-6 p-6 lg:p-8">
        <div data-tour="engagements-header" className="space-y-2">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
            Project Pipeline
          </h2>
          <p className="max-w-[58ch] text-sm text-ink-secondary">
            Track how your AI team progresses through each project phase.
          </p>
        </div>

        <Tabs data-tour="engagements-list" value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="paused">Paused</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="space-y-4">
            {engagements.length === 0 ? (
              <EmptyState />
            ) : (
              engagements.map((engagement) => (
                <Card key={engagement.id}>
                  <CardContent className="space-y-5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent-subtle text-accent">
                          <Activity className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate font-display text-base font-semibold tracking-[-0.02em] text-ink">
                            {engagement.title}
                          </h3>
                          <div className="mt-1.5 flex flex-wrap items-center gap-3">
                            <Badge variant={statusBadgeVariant(engagement.status)}>
                              {engagement.status.charAt(0).toUpperCase() +
                                engagement.status.slice(1)}
                            </Badge>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                getConfidenceLabel(engagement.confidence).color,
                              )}
                              title={
                                getConfidenceLabel(engagement.confidence).description
                              }
                            >
                              {getConfidenceLabel(engagement.confidence).label}
                              <span className="ml-1 text-[10px] tabular opacity-60">
                                {Math.round(engagement.confidence * 100)}%
                              </span>
                            </span>
                            <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                              <Clock className="h-3 w-3" />
                              Started {timeAgo(engagement.createdAt)}
                            </span>
                          </div>
                          {engagement.status === "paused" && (
                            <p className="mt-1.5 text-xs text-amber">
                              This engagement is paused.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {engagement.status === "active" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={actionLoading === engagement.id}
                            onClick={() => handlePause(engagement.id)}
                          >
                            {actionLoading === engagement.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Pause className="h-3.5 w-3.5" />
                            )}
                            Pause
                          </Button>
                        )}
                        {engagement.status === "paused" && (
                          <Button
                            variant="accent"
                            size="sm"
                            className="glow"
                            disabled={actionLoading === engagement.id}
                            onClick={() => handleResume(engagement.id)}
                          >
                            {actionLoading === engagement.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                            Resume
                          </Button>
                        )}
                      </div>
                    </div>

                    <PhaseProgress
                      currentPhase={engagement.phase}
                      status={engagement.status}
                    />
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
