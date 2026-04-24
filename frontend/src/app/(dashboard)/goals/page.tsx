"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useProjectScope } from "@/lib/use-project-scope";
import { Header } from "@/components/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Target, Plus, Check, X } from "lucide-react";
import { timeAgo } from "@/lib/utils";

interface Goal {
  id: string;
  title: string;
  description: string;
  outcome: string;
  parentGoalId: string | null;
  status: string;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
}

const statusBadge: Record<string, string> = {
  active: "bg-accent-subtle text-accent",
  achieved: "bg-emerald-light text-emerald",
  abandoned: "bg-surface-sunken text-ink-tertiary",
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: "", outcome: "", description: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getGoals();
      if (res.data) setGoals(res.data);
    } catch {
      setError("Unable to load goals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useProjectScope(load);

  async function createGoal() {
    if (!draft.title.trim()) return;
    setSaving(true);
    try {
      await api.createGoal({
        title: draft.title.trim(),
        outcome: draft.outcome.trim() || undefined,
        description: draft.description.trim() || undefined,
      });
      setDraft({ title: "", outcome: "", description: "" });
      setCreating(false);
      await load();
    } catch {
      setError("Create failed — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, status: "active" | "achieved" | "abandoned") {
    await api.updateGoal(id, { status });
    await load();
  }

  return (
    <div className="min-h-screen">
      <Header title="Goals" />

      <div className="max-w-5xl space-y-6 p-6 lg:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
              Goals
            </h2>
            <p className="max-w-[68ch] text-sm text-ink-secondary">
              Every piece of agent work should know the "why." Goals get
              threaded into agent prompts ("Working toward: [title] —
              [outcome]") so briefs and code produced by the workforce
              stay aligned with what you actually want.
            </p>
          </div>
          {!creating && (
            <Button variant="accent" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New goal
            </Button>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-rose/20 bg-rose-light p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose" />
            <p className="flex-1 text-sm font-medium text-rose">{error}</p>
          </div>
        )}

        {creating && (
          <Card>
            <CardContent className="p-5">
              <h3 className="mb-4 font-semibold text-ink">New goal</h3>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">Title</label>
                  <input
                    autoFocus
                    value={draft.title}
                    placeholder="e.g. Ship voice onboarding by end of Q2"
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    className="w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">Outcome — what does "done" look like?</label>
                  <input
                    value={draft.outcome}
                    placeholder="e.g. A prospect can call our number and start a brief by voice"
                    onChange={(e) => setDraft((d) => ({ ...d, outcome: e.target.value }))}
                    className="w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-ink-tertiary">
                    This line goes into every agent prompt, so keep it short and concrete.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">Description (optional)</label>
                  <textarea
                    rows={3}
                    value={draft.description}
                    placeholder="Background, constraints, stakeholders…"
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    className="w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={saving}>Cancel</Button>
                  <Button variant="accent" size="sm" onClick={createGoal} disabled={saving || !draft.title.trim()}>
                    {saving ? "Creating…" : "Create goal"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton h-24 rounded-[var(--radius-md)]" />
            ))}
          </div>
        ) : goals.length === 0 && !creating ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-accent-subtle">
                <Target className="h-7 w-7 text-accent" />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-[-0.025em] text-ink">
                No goals yet
              </h3>
              <p className="mt-1 max-w-sm text-sm text-ink-secondary">
                Goals get auto-created from meeting titles when you ingest a meeting — or you can define them up front here.
              </p>
              <Button variant="accent" className="mt-4" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                Define your first goal
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {goals.map((goal) => (
              <li key={goal.id}>
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent-subtle text-accent">
                          <Target className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-ink">{goal.title}</h3>
                            <Badge className={statusBadge[goal.status] ?? ""}>
                              {goal.status}
                            </Badge>
                            <span className="text-xs text-ink-tertiary tabular">created {timeAgo(goal.createdAt)}</span>
                          </div>
                          {goal.outcome && (
                            <p className="mt-1 max-w-[72ch] text-sm text-ink-secondary">
                              <span className="text-ink-tertiary">Outcome: </span>{goal.outcome}
                            </p>
                          )}
                          {goal.description && (
                            <p className="mt-1 max-w-[72ch] text-xs text-ink-tertiary">{goal.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {goal.status === "active" && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => changeStatus(goal.id, "achieved")}>
                              <Check className="h-4 w-4" />
                              Achieved
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => changeStatus(goal.id, "abandoned")}>
                              <X className="h-4 w-4" />
                              Abandon
                            </Button>
                          </>
                        )}
                        {goal.status !== "active" && (
                          <Button variant="ghost" size="sm" onClick={() => changeStatus(goal.id, "active")}>
                            Reactivate
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
