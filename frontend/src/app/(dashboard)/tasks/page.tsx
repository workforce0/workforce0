"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Header } from "@/components/header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  Clock,
  TrendingUp,
  AlertCircle,
  RefreshCw,
  Video,
  ChevronDown,
  FileText,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { timeAgo } from "@/lib/utils";

interface Task {
  id: string;
  agentType: string;
  status: string;
  confidence: number;
  createdAt: string;
  completedAt?: string;
  error?: string | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  meetingId?: string | null;
}

/** Short, human label for common statuses — shown above the raw status badge. */
function statusExplanation(status: string, error?: string | null): string {
  if (error) return `The agent hit an error and stopped. See the message below.`;
  switch (status) {
    case "pending":
      return "Waiting in the queue — a worker hasn't picked it up yet.";
    case "processing":
      return "A worker is running this task right now.";
    case "awaiting_clarification":
      return "The agent asked a question and is waiting for a response.";
    case "awaiting_approval":
      return "The agent finished and is waiting for a human to approve or reject.";
    case "completed":
      return "Done. Check the output for what was produced.";
    case "failed":
      return "The agent hit an error and stopped. See the message below.";
    default:
      return `Current status: ${status}.`;
  }
}

const agentLabels: Record<string, { label: string; color: string }> = {
  ba_agent: { label: "Business Analyst", color: "bg-violet-light text-violet" },
  dev_agent: { label: "Developer", color: "bg-sky-light text-sky" },
  qa_agent: { label: "Quality Assurance", color: "bg-emerald-light text-emerald" },
  sales_agent: { label: "Sales", color: "bg-amber-light text-amber" },
  marketing_agent: { label: "Marketing", color: "bg-rose-light text-rose" },
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, [filter]);

  async function loadTasks() {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (filter !== "all") params.status = filter;
      const res = await api.getTasks(params);
      if (res.data) setTasks(res.data);
    } catch {
      setError("Unable to load tasks. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Header title="Team Activity" />

      <div className="space-y-6 p-6 lg:p-8">
        <div className="space-y-2">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
            Team Activity
          </h2>
          <p className="max-w-[58ch] text-sm text-ink-secondary">
            Every action your AI workforce takes, in one place. Legacy view —
            most workflows surface through Approvals and Briefs in v1.
          </p>
        </div>

        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="processing">Active</TabsTrigger>
            <TabsTrigger value="awaiting_clarification">Needs input</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="failed">Failed</TabsTrigger>
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
              onClick={loadTasks}
              className="text-rose hover:bg-rose/10"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="skeleton h-16 rounded-[var(--radius-md)]"
              />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <Card className="glass-strong">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-sky-light">
                <Bot className="h-7 w-7 text-sky" />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-[-0.025em] text-ink">
                No tasks yet
              </h3>
              <p className="mt-1 max-w-sm text-sm text-ink-secondary">
                Activity will appear here as your AI team works on meetings
                and product briefs.
              </p>
              <Button variant="accent" className="glow mt-4" asChild>
                <Link href="/meetings">
                  <Video className="h-4 w-4" />
                  Schedule a meeting
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => {
              const agent =
                agentLabels[task.agentType] || {
                  label: task.agentType,
                  color: "bg-surface-sunken text-ink-secondary",
                };
              const isOpen = expandedId === task.id;
              const input = (task.input ?? {}) as Record<string, unknown>;
              const output = (task.output ?? {}) as Record<string, unknown>;
              const prdId = (output.prdId ?? input.prdId) as string | undefined;
              const meetingId = task.meetingId ?? (input.meetingId as string | undefined);
              const inputType = input.type as string | undefined;
              const hasDetails =
                Boolean(task.error) ||
                Object.keys(input).length > 0 ||
                Object.keys(output).length > 0;
              let durationMs: number | null = null;
              if (task.completedAt) {
                durationMs = new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();
              }
              return (
                <li
                  key={task.id}
                  className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-card)] transition-all duration-[160ms] hover:border-border-strong"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : task.id)}
                    aria-expanded={isOpen}
                    aria-controls={`task-details-${task.id}`}
                    className="flex w-full items-center justify-between gap-4 p-4 text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent-subtle text-accent">
                        <Bot className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={agent.color}>{agent.label}</Badge>
                          <kbd className="kbd font-mono">{task.id.slice(0, 8)}</kbd>
                          {inputType && (
                            <span className="text-[11px] uppercase tracking-wider text-ink-tertiary">
                              {inputType.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3">
                          <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                            <Clock className="h-3 w-3" />
                            {timeAgo(task.createdAt)}
                          </span>
                          {task.confidence > 0 && (
                            <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                              <TrendingUp className="h-3 w-3" />
                              {Math.round(task.confidence * 100)}% quality
                            </span>
                          )}
                          {task.status === "failed" && task.error && (
                            <span className="flex items-center gap-1 text-xs font-medium text-rose">
                              <AlertCircle className="h-3 w-3" />
                              error — expand to see
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={task.status} />
                      <ChevronDown
                        className={`h-4 w-4 text-ink-tertiary transition-transform duration-[160ms] ${
                          isOpen ? "rotate-180" : ""
                        }`}
                        aria-hidden
                      />
                    </div>
                  </button>

                  {isOpen && (
                    <div
                      id={`task-details-${task.id}`}
                      className="space-y-4 border-t border-border bg-surface-sunken/40 p-5"
                    >
                      {/* Plain-English status explanation */}
                      <p className="text-sm text-ink-secondary">
                        {statusExplanation(task.status, task.error)}
                      </p>

                      {/* Error — prominent when present */}
                      {task.error && (
                        <div className="rounded-[var(--radius-sm)] border border-rose/20 bg-rose-light p-3">
                          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-rose">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Error
                          </div>
                          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-rose">
                            {task.error}
                          </pre>
                        </div>
                      )}

                      {/* Linked entities — meeting / PRD */}
                      {(meetingId || prdId) && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-ink-tertiary">Links:</span>
                          {meetingId && (
                            <Link
                              href={`/meetings/${meetingId}`}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 font-medium text-ink hover:border-border-strong"
                            >
                              <Video className="h-3 w-3" />
                              Meeting
                            </Link>
                          )}
                          {prdId && (
                            <Link
                              href={`/prds/${prdId}`}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 font-medium text-ink hover:border-border-strong"
                            >
                              <FileText className="h-3 w-3" />
                              Brief
                            </Link>
                          )}
                        </div>
                      )}

                      {/* Timestamps */}
                      <div className="grid gap-3 text-xs sm:grid-cols-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-ink-tertiary">Created</div>
                          <div className="mt-0.5 text-ink tabular">{new Date(task.createdAt).toLocaleString()}</div>
                        </div>
                        {task.completedAt && (
                          <div>
                            <div className="text-[11px] uppercase tracking-wider text-ink-tertiary">Completed</div>
                            <div className="mt-0.5 text-ink tabular">{new Date(task.completedAt).toLocaleString()}</div>
                          </div>
                        )}
                        {durationMs !== null && (
                          <div>
                            <div className="text-[11px] uppercase tracking-wider text-ink-tertiary">Duration</div>
                            <div className="mt-0.5 text-ink tabular">
                              {durationMs < 60_000
                                ? `${Math.round(durationMs / 1000)}s`
                                : `${Math.round(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Input + output payloads — collapsed-by-default JSON */}
                      {hasDetails && (
                        <div className="grid gap-3 md:grid-cols-2">
                          {Object.keys(input).length > 0 && (
                            <details className="rounded-[var(--radius-sm)] border border-border bg-surface p-3">
                              <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
                                <Wrench className="h-3.5 w-3.5" />
                                Input
                              </summary>
                              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-ink">
                                {JSON.stringify(input, null, 2)}
                              </pre>
                            </details>
                          )}
                          {Object.keys(output).length > 0 && (
                            <details className="rounded-[var(--radius-sm)] border border-border bg-surface p-3">
                              <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
                                <TrendingUp className="h-3.5 w-3.5" />
                                Output
                              </summary>
                              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-ink">
                                {JSON.stringify(output, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
