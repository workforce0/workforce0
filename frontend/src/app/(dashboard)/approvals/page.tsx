"use client";

/**
 * Approval queue (Stitch 07).
 *
 * Responsive triage inbox:
 *   - **lg+**: classic two-pane — list on the left, detail on the right.
 *              J/K to navigate, A to approve, R to reject, E to edit.
 *   - **<lg (phones, tablets-portrait)**: single-pane. Default shows the
 *              list; tapping an item swaps to the detail view with a
 *              back-to-queue button at the top and a sticky bottom action
 *              bar sized for thumbs (min 44×44pt hit areas per Apple HIG).
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/header";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import {
  CheckCircle2,
  ThumbsDown,
  Pencil,
  FileText,
  Ticket,
  GitPullRequest,
  Loader2,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";

type QueueItemType = "brief" | "ticket" | "pull_request";

interface QueueItem {
  id: string;
  type: QueueItemType;
  title: string;
  source: string;
  createdAt: string;
  confidence: number;
  preview?: string;
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  /** `null` on mobile means "no item selected → showing the list". */
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  /** Track whether the viewport is wide enough for the two-pane layout. */
  const [isDesktop, setIsDesktop] = useState(false);
  const toast = useToast();

  // Detect viewport width so we know when to auto-select the first item.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Array<{
        id: string;
        title: string;
        status: string;
        confidence: number;
        createdAt: string;
        meetingTitle?: string;
      }>>("/api/agents/prds?status=pending_review");
      if (res.success && res.data) {
        const mapped: QueueItem[] = res.data.map((p) => ({
          id: p.id,
          type: "brief",
          title: p.title,
          source: p.meetingTitle ? `from "${p.meetingTitle}"` : "Meeting brief",
          createdAt: p.createdAt,
          confidence: p.confidence ?? 0.8,
        }));
        setItems(mapped);
        // On desktop, keep the selection (or reset if out of bounds).
        // On mobile, reset to list view.
        if (isDesktop) {
          setSelectedIdx((prev) => {
            if (prev === null) return mapped.length > 0 ? 0 : null;
            if (prev >= mapped.length) return mapped.length > 0 ? 0 : null;
            return prev;
          });
        } else {
          setSelectedIdx(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Desktop: default to first item. Mobile: list-first, null.
  useEffect(() => {
    if (isDesktop && selectedIdx === null && items.length > 0) {
      setSelectedIdx(0);
    }
  }, [isDesktop, selectedIdx, items.length]);

  const active = selectedIdx !== null ? items[selectedIdx] : undefined;

  const approve = useCallback(async () => {
    if (!active) return;
    setSubmitting(true);
    try {
      const res = await api.post(`/api/agents/prds/${active.id}/approve`);
      if (res.success) {
        toast.success("Approved");
        await refresh();
      } else {
        toast.error(res.error?.message ?? "Approve failed");
      }
    } finally {
      setSubmitting(false);
    }
  }, [active, refresh, toast]);

  const reject = useCallback(async () => {
    if (!active) return;
    setSubmitting(true);
    try {
      const res = await api.post(`/api/agents/prds/${active.id}/reject`, { reason: "Needs revision" });
      if (res.success) {
        toast.success("Sent back for revision");
        await refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }, [active, refresh, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (submitting) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "j") setSelectedIdx((i) => Math.min(items.length - 1, (i ?? -1) + 1));
      if (e.key === "k") setSelectedIdx((i) => Math.max(0, (i ?? 0) - 1));
      if (e.key === "a") void approve();
      if (e.key === "r") void reject();
      if (e.key === "Escape" && !isDesktop) setSelectedIdx(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, approve, reject, submitting, isDesktop]);

  if (loading) {
    return (
      <>
        <Header title="Approvals" />
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[36%_1fr]">
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="skeleton h-16 rounded-[var(--radius-md)]"
                />
              ))}
            </div>
            <div className="skeleton hidden min-h-[60vh] rounded-[var(--radius-lg)] lg:block" />
          </div>
        </div>
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <Header title="Approvals" />
        <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20">
          <Card className="glass-strong flex flex-col items-center gap-4 p-8 text-center sm:p-12">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--color-emerald-light)] text-[var(--color-emerald)]">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <div className="space-y-1.5">
              <h1 className="font-display text-2xl font-semibold tracking-[-0.025em] text-ink">
                All clear
              </h1>
              <p className="text-sm text-ink-secondary">
                Your AI workforce is caught up. Enjoy the break.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild className="mt-2">
              <Link href="/dashboard">
                Back to dashboard
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </Card>
        </div>
      </>
    );
  }

  /** On mobile, showing the detail hides the list. */
  const showList = isDesktop || selectedIdx === null;
  const showDetail = isDesktop || selectedIdx !== null;

  return (
    <>
      <Header title="Approvals" />
      <div className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 sm:py-6 lg:pb-6">
        {/* Page header. Hidden on mobile detail view so the back-button can own the row. */}
        {showList && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-semibold tracking-[-0.025em] text-ink">
                Approvals
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent border-gradient bg-accent-subtle px-2.5 py-0.5 text-xs font-medium text-accent tabular">
                <span className="dot-pulse" aria-hidden />
                {items.length} waiting
              </span>
            </div>
            <div
              className="hidden items-center gap-1.5 text-[11px] text-ink-tertiary sm:flex"
              aria-label="Keyboard shortcuts"
            >
              <kbd className="kbd">J</kbd>
              <kbd className="kbd">K</kbd>
              <span className="ml-1">navigate</span>
              <kbd className="kbd ml-3">A</kbd>
              <span>approve</span>
              <kbd className="kbd ml-3">R</kbd>
              <span>reject</span>
            </div>
          </div>
        )}

        {/* Mobile back-to-queue bar — sits above the detail card. */}
        {!isDesktop && selectedIdx !== null && (
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIdx(null)}
              className="flex h-11 items-center gap-2 rounded-[var(--radius-md)] px-3 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-sunken active:bg-surface-hover"
              aria-label="Back to queue"
            >
              <ArrowLeft className="h-4 w-4" />
              Queue
            </button>
            <span className="text-xs text-ink-tertiary tabular">
              {selectedIdx + 1} of {items.length}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[36%_1fr]">
          {/* Queue list */}
          {showList && (
            <aside className="space-y-2 lg:space-y-1.5" aria-label="Approval queue">
              {items.map((item, idx) => {
                const selected = idx === selectedIdx;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedIdx(idx)}
                    className={`relative w-full rounded-[var(--radius-md)] border p-4 text-left transition-all duration-[160ms] lg:p-3 ${
                      selected
                        ? "border-border-strong bg-accent-subtle/60 shadow-[var(--shadow-card)]"
                        : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover active:bg-surface-sunken"
                    }`}
                    aria-pressed={selected}
                  >
                    {selected && (
                      <span
                        className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent shadow-[0_0_8px_var(--color-accent-glow)]"
                        aria-hidden
                      />
                    )}
                    <div className="flex items-start gap-3">
                      <TypeIcon type={item.type} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {item.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-tertiary">
                          {item.source}
                        </p>
                      </div>
                      <ConfidencePill value={item.confidence} />
                      <ChevronRight
                        className="ml-1 h-4 w-4 shrink-0 text-ink-faint lg:hidden"
                        aria-hidden
                      />
                    </div>
                  </button>
                );
              })}
            </aside>
          )}

          {/* Detail pane */}
          {showDetail && (
            <main>
              {active && (
                <Card className="flex min-h-[60vh] flex-col p-5 sm:p-6 lg:p-8">
                  <header className="mb-5 border-b border-border pb-5">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-accent">
                        Brief
                      </span>
                      <span className="truncate text-[11px] text-ink-tertiary">
                        {active.source}
                      </span>
                    </div>
                    <h2 className="font-display text-xl font-semibold tracking-[-0.025em] text-ink sm:text-2xl">
                      {active.title}
                    </h2>
                  </header>

                  <div className="flex-1 space-y-4 text-sm text-ink-secondary">
                    <p>
                      Review the brief in detail, then use the approve/reject actions below or the
                      keyboard shortcuts on desktop to move quickly.
                    </p>

                    <div className="rounded-[var(--radius-md)] border border-border bg-surface-sunken/60 p-4">
                      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-tertiary">
                        AI confidence
                      </p>
                      <div className="mt-2 flex items-center gap-3">
                        <div
                          className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
                          role="progressbar"
                          aria-valuenow={Math.round(active.confidence * 100)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full bg-accent transition-all duration-[420ms]"
                            style={{ width: `${Math.round(active.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="font-display text-lg font-semibold tabular text-ink">
                          {Math.round(active.confidence * 100)}%
                        </span>
                      </div>
                    </div>

                    <Link
                      href={`/prds/${active.id}`}
                      className="inline-flex h-11 items-center gap-1.5 text-sm font-medium text-accent hover:text-[var(--color-accent-hover)]"
                    >
                      Open full brief
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>

                  {/*
                    Action bar. On lg it's a sticky footer inside the card.
                    On mobile it becomes a fixed bottom bar (thumb-reachable,
                    safe-area-aware) so the user never has to scroll to
                    approve/reject.
                  */}
                  <footer
                    className={
                      /* lg+: sticky-in-card */
                      "sticky bottom-0 -mx-5 -mb-5 mt-6 hidden items-center justify-end gap-2 border-t border-border bg-surface/95 px-5 py-4 backdrop-blur-sm sm:-mx-6 sm:-mb-6 sm:px-6 lg:flex lg:-mx-8 lg:-mb-8 lg:px-8"
                    }
                  >
                    <Button variant="ghost" onClick={reject} disabled={submitting}>
                      <ThumbsDown className="h-4 w-4" /> Reject
                    </Button>
                    <Button variant="outline" asChild>
                      <Link href={`/prds/${active.id}`}>
                        <Pencil className="h-4 w-4" /> Edit
                      </Link>
                    </Button>
                    <Button
                      variant="accent"
                      onClick={approve}
                      disabled={submitting}
                      className="glow"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Approve
                    </Button>
                  </footer>
                </Card>
              )}
            </main>
          )}
        </div>
      </div>

      {/* Mobile-only fixed bottom action bar. Safe-area-inset aware for phones
          with home-indicator chrome. Min 44pt touch targets per Apple HIG. */}
      {!isDesktop && active && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 shadow-[0_-6px_24px_rgba(5,5,9,0.08)] backdrop-blur-md"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <div className="mx-auto flex max-w-md items-center gap-2">
            <Button
              variant="outline"
              onClick={reject}
              disabled={submitting}
              className="h-12 flex-1"
            >
              <ThumbsDown className="h-4 w-4" /> Reject
            </Button>
            <Button
              variant="accent"
              onClick={approve}
              disabled={submitting}
              className="glow h-12 flex-[1.5]"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Approve
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function TypeIcon({ type }: { type: QueueItemType }) {
  const map = {
    brief: { Icon: FileText, bg: "bg-accent-subtle text-accent" },
    ticket: { Icon: Ticket, bg: "bg-amber-light text-amber" },
    pull_request: { Icon: GitPullRequest, bg: "bg-violet-light text-violet" },
  } as const;
  const { Icon, bg } = map[type];
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] lg:h-7 lg:w-7 ${bg}`}
    >
      <Icon className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
    </span>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  let color = "bg-[color:var(--color-emerald-light)] text-[var(--color-emerald)]";
  if (pct < 70) color = "bg-rose-light text-rose";
  else if (pct < 90) color = "bg-amber-light text-amber";
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular ${color}`}
    >
      {pct}%
    </span>
  );
}
