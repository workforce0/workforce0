"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Header } from "@/components/header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Cpu,
  Clock,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  Timer,
} from "lucide-react";
import { timeAgo } from "@/lib/utils";

interface AgentJob {
  id: string;
  action: string;
  status: string;
  targetRepo: string;
  result: unknown;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

const actionLabels: Record<string, string> = {
  implement_prd: "Implement Feature",
  review_pr: "Review PR",
  run_tests: "Run Tests",
  deploy: "Deploy",
  fix_bug: "Fix Bug",
  refactor: "Refactor Code",
};

function getActionLabel(action: string): string {
  return actionLabels[action] || action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getDuration(createdAt: string, completedAt: string | null): string | null {
  if (!completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export default function AgentJobsPage() {
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    loadJobs();
  }, [filter]);

  async function loadJobs() {
    setLoading(true);
    setError(null);
    try {
      const params: { status?: string; limit?: number } = { limit: 50 };
      if (filter !== "all") params.status = filter;
      const res = await api.getAgentJobs(params);
      if (res.data) setJobs(res.data);
    } catch {
      setError("Unable to load agent jobs. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Header title="Agent Jobs" />

      <div className="space-y-6 p-6 lg:p-8">
        <div className="space-y-2">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
            Agent Jobs
          </h2>
          <p className="max-w-[60ch] text-sm text-ink-secondary">
            Every code-writing action your AI workforce runs. Scoped to the
            agent-side daemon and your connected repos.
          </p>
        </div>

        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="in_progress">Running</TabsTrigger>
            <TabsTrigger value="done">Completed</TabsTrigger>
            <TabsTrigger value="failed">Failed</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-rose/20 bg-rose-light p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose" />
            <p className="flex-1 text-sm font-medium text-rose">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadJobs}
              className="text-rose hover:bg-rose/10"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        )}

        {/* Jobs list */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="skeleton h-20 rounded-[var(--radius-md)]"
              />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <Card className="glass-strong">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-accent-subtle">
                <Cpu className="h-7 w-7 text-accent" />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-[-0.025em] text-ink">
                No agent jobs yet
              </h3>
              <p className="mt-1 max-w-sm text-sm text-ink-secondary">
                Jobs appear here when the AI agent works on approved briefs.
                Approve a brief to get started.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => {
              const duration = getDuration(job.createdAt, job.completedAt);
              const isRunning = job.status === "in_progress";
              return (
                <li key={job.id}>
                  <Link href={`/agent-jobs/${job.id}`} className="block">
                    <Card className="card-interactive cursor-pointer group">
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-accent-subtle text-accent">
                            <Cpu className="h-5 w-5" />
                            {isRunning && (
                              <span
                                className="absolute -right-0.5 -top-0.5 dot-pulse"
                                aria-hidden
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">
                              {getActionLabel(job.action)}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                              <kbd className="kbd font-mono">
                                {job.targetRepo}
                              </kbd>
                              <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                                <Clock className="h-3 w-3" />
                                {timeAgo(job.createdAt)}
                              </span>
                              {duration && (
                                <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                                  <Timer className="h-3 w-3" />
                                  {duration}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <StatusBadge status={job.status} />
                          <ArrowRight className="h-4 w-4 text-ink-faint transition group-hover:text-ink-secondary" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
