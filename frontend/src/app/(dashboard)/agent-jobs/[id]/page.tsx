"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Header } from "@/components/header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Cpu,
  Clock,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitPullRequest,
  FileCode,
  CheckCircle,
  XCircle,
  Timer,
} from "lucide-react";
import { formatDateTime, timeAgo } from "@/lib/utils";

interface AgentJob {
  id: string;
  action: string;
  status: string;
  targetRepo: string;
  result: Record<string, unknown> | null;
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

type TimelineStep = {
  key: string;
  label: string;
  timestamp: string | null;
  done: boolean;
};

function buildTimeline(job: AgentJob): TimelineStep[] {
  const steps: TimelineStep[] = [
    { key: "created", label: "Job Created", timestamp: job.createdAt, done: true },
    {
      key: "dispatched",
      label: "Dispatched to Agent",
      timestamp: job.status !== "pending" ? job.createdAt : null,
      done: job.status !== "pending",
    },
    {
      key: "in_progress",
      label: "In Progress",
      timestamp: job.status === "in_progress" || job.status === "done" || job.status === "failed"
        ? job.createdAt
        : null,
      done: job.status === "in_progress" || job.status === "done" || job.status === "failed",
    },
    {
      key: "finished",
      label: job.status === "failed" ? "Failed" : "Completed",
      timestamp: job.completedAt,
      done: !!job.completedAt,
    },
  ];
  return steps;
}

export default function AgentJobDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [job, setJob] = useState<AgentJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payloadOpen, setPayloadOpen] = useState(false);

  useEffect(() => {
    loadJob();
  }, [id]);

  async function loadJob() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAgentJob(id);
      if (res.data) setJob(res.data as AgentJob);
    } catch {
      setError("Unable to load job details. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const timeline = job ? buildTimeline(job) : [];
  const duration = job ? getDuration(job.createdAt, job.completedAt) : null;
  const result = job?.result as Record<string, unknown> | null;

  return (
    <div className="min-h-screen">
      <Header title="Job Detail" />

      <div className="max-w-4xl space-y-6 p-6 lg:p-8">
        {/* Back button */}
        <Button variant="ghost" size="sm" className="-ml-2" asChild>
          <Link href="/agent-jobs">
            <ArrowLeft className="h-4 w-4" />
            Agent Jobs
          </Link>
        </Button>

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-rose/20 bg-rose-light p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose" />
            <p className="flex-1 text-sm font-medium text-rose">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadJob}
              className="text-rose hover:bg-rose/10"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <div className="skeleton h-28 rounded-[var(--radius-lg)]" />
            <div className="skeleton h-40 rounded-[var(--radius-lg)]" />
            <div className="skeleton h-24 rounded-[var(--radius-lg)]" />
          </div>
        ) : job ? (
          <>
            {/* Header card */}
            <Card>
              <CardContent className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-accent-subtle text-accent">
                      <Cpu className="h-7 w-7" />
                    </div>
                    <div>
                      <h1 className="font-display text-2xl font-semibold tracking-[-0.025em] text-ink">
                        {getActionLabel(job.action)}
                      </h1>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <kbd className="kbd font-mono">{job.targetRepo}</kbd>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                          <Clock className="h-3 w-3" />
                          Created {timeAgo(job.createdAt)}
                        </span>
                        {duration && (
                          <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                            <Timer className="h-3 w-3" />
                            Took {duration}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={job.status} />
                </div>
              </CardContent>
            </Card>

            {/* Timeline */}
            <Card>
              <CardContent className="p-6">
                <h2 className="mb-4 font-display text-sm font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
                  Timeline
                </h2>
                <ol className="relative border-l border-border ml-3 space-y-6">
                  {timeline.map((step, idx) => (
                    <li key={step.key} className="ml-6">
                      <span className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ring-4 ring-surface ${
                        step.done
                          ? idx === timeline.length - 1 && job.status === "failed"
                            ? "bg-rose text-white"
                            : "bg-emerald text-white"
                          : "bg-surface-sunken text-ink-faint"
                      }`}>
                        {step.done ? (
                          idx === timeline.length - 1 && job.status === "failed" ? (
                            <XCircle className="w-3.5 h-3.5" />
                          ) : (
                            <CheckCircle className="w-3.5 h-3.5" />
                          )
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-ink-faint" />
                        )}
                      </span>
                      <div>
                        <p className={`text-sm font-medium ${step.done ? "text-ink" : "text-ink-tertiary"}`}>
                          {step.label}
                        </p>
                        {step.timestamp && (
                          <p className="text-xs text-ink-tertiary mt-0.5">
                            {formatDateTime(step.timestamp)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            {/* Failed: error card */}
            {job.status === "failed" && job.error && (
              <Card className="border-rose/30">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose" />
                    <div>
                      <h2 className="mb-1 font-display text-sm font-semibold text-rose">
                        Error
                      </h2>
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-secondary">
                        {job.error}
                      </pre>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Done: result card */}
            {(job.status === "done" || job.status === "completed") && result && (
              <Card>
                <CardContent className="space-y-4 p-6">
                  <h2 className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
                    Results
                  </h2>

                  {/* PR URL */}
                  {typeof result.prUrl === "string" && result.prUrl && (
                    <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface-sunken p-3">
                      <GitPullRequest className="h-4 w-4 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-tertiary">
                          Pull request
                        </p>
                        <a
                          href={result.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 truncate font-mono text-sm text-accent hover:underline"
                        >
                          {result.prUrl}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Files changed */}
                  {Array.isArray(result.filesChanged) && result.filesChanged.length > 0 && (
                    <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface-sunken p-3">
                      <FileCode className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" />
                      <div>
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-ink-tertiary">
                          Files changed ({(result.filesChanged as string[]).length})
                        </p>
                        <ul className="space-y-0.5">
                          {(result.filesChanged as string[]).slice(0, 10).map((f) => (
                            <li
                              key={f}
                              className="font-mono text-xs text-ink-secondary"
                            >
                              {f}
                            </li>
                          ))}
                          {(result.filesChanged as string[]).length > 10 && (
                            <li className="text-xs text-ink-tertiary tabular">
                              +{(result.filesChanged as string[]).length - 10} more
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Tests run */}
                  {typeof result.testsRun === "number" && (
                    <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface-sunken p-3">
                      <CheckCircle className="h-4 w-4 shrink-0 text-emerald" />
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-tertiary">
                          Tests
                        </p>
                        <p className="text-sm text-ink tabular">
                          {result.testsRun} run
                          {typeof result.testsPassed === "number" &&
                            ` · ${result.testsPassed} passed`}
                          {typeof result.testsFailed === "number" &&
                            result.testsFailed > 0 &&
                            ` · ${result.testsFailed} failed`}
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Payload (collapsible) */}
            <Card>
              <CardContent className="p-0">
                <button
                  onClick={() => setPayloadOpen(!payloadOpen)}
                  className="flex w-full items-center justify-between rounded-[var(--radius-md)] p-5 text-left transition hover:bg-surface-hover"
                  aria-expanded={payloadOpen}
                >
                  <span className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
                    Job payload
                  </span>
                  {payloadOpen ? (
                    <ChevronUp className="h-4 w-4 text-ink-tertiary" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-ink-tertiary" />
                  )}
                </button>
                {payloadOpen && (
                  <div className="px-5 pb-5">
                    <pre className="max-h-80 overflow-x-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-border bg-surface-sunken p-4 font-mono text-xs text-ink-secondary">
                      {JSON.stringify(result, null, 2) ||
                        "No payload data available."}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
