"use client";

/**
 * Scheduled jobs (cron) management page.
 *
 * Admin page for recurring workflows like "every Monday 9am, post last week's
 * approved briefs to Slack." Backed by /api/cron.
 */

import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { Timer, Plus, Loader2, Trash2, Pause, Play } from "lucide-react";

interface ScheduledJob {
  id: string;
  name: string;
  cronExpression: string;
  timezone: string;
  jobType: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  nextRunAt: string | null;
}

const CRON_PRESETS = [
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at 9 AM", value: "0 9 * * *" },
  { label: "Every Monday at 9 AM", value: "0 9 * * 1" },
  { label: "First day of month at 9 AM", value: "0 9 1 * *" },
  { label: "Custom…", value: "custom" },
];

export default function SchedulesPage() {
  const toast = useToast();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    jobType: "digest_email",
    preset: "0 9 * * 1",
    customCron: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ScheduledJob[]>(`/api/cron`);
      if (res.success && res.data) setJobs(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    const cronExpression = form.preset === "custom" ? form.customCron.trim() : form.preset;
    if (!form.name.trim() || !cronExpression) {
      toast.warning("Missing fields", "Enter a name and cron expression.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post(`/api/cron`, {
        name: form.name,
        cronExpression,
        jobType: form.jobType,
      });
      if (res.success) {
        toast.success("Schedule created");
        setDialogOpen(false);
        setForm({ name: "", jobType: "digest_email", preset: "0 9 * * 1", customCron: "" });
        await load();
      } else {
        toast.error("Couldn't create schedule", res.error?.message ?? "Unknown error");
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggle(job: ScheduledJob) {
    await api.put(`/api/cron/${job.id}`, { enabled: !job.enabled });
    await load();
  }

  async function remove(job: ScheduledJob) {
    if (!confirm(`Delete schedule "${job.name}"?`)) return;
    await api.delete(`/api/cron/${job.id}`);
    await load();
  }

  return (
    <div className="min-h-screen">
      <Header title="Schedules" />
      <div className="max-w-5xl space-y-8 p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
              Scheduled jobs
            </h2>
            <p className="max-w-[58ch] text-sm text-ink-secondary">
              Recurring workflows your AI runs without you asking — weekly
              digests, monthly reports, daily reminders.
            </p>
          </div>
          <Button variant="accent" className="glow" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> New schedule
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="skeleton h-24 rounded-[var(--radius-lg)]"
              />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <Card className="glass-strong">
            <CardContent className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-accent-subtle">
                <Timer className="h-7 w-7 text-accent" />
              </div>
              <h3 className="font-display text-lg font-semibold tracking-[-0.02em] text-ink">
                No schedules yet
              </h3>
              <p className="mt-1 max-w-sm text-sm text-ink-secondary">
                Set something to run on a cron. Weekly digests, monthly
                reports, daily reminders.
              </p>
              <Button
                variant="accent"
                className="glow mt-4"
                onClick={() => setDialogOpen(true)}
              >
                Create your first schedule
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className={`card-interactive flex items-start justify-between gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-5 shadow-[var(--shadow-card)] transition-all duration-[160ms] hover:border-border-strong ${
                  job.enabled ? "" : "opacity-60"
                }`}
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{job.name}</span>
                    {!job.enabled && (
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-ink-tertiary">
                        Paused
                      </span>
                    )}
                    {job.lastStatus === "error" && (
                      <span className="rounded-full bg-rose-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-rose">
                        Last run failed
                      </span>
                    )}
                    {job.lastStatus === "success" && (
                      <span className="rounded-full bg-[color:var(--color-emerald-light)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-emerald)]">
                        Last run OK
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 text-xs text-ink-secondary">
                    <div className="flex items-center gap-2">
                      <kbd className="kbd font-mono">{job.cronExpression}</kbd>
                      <span className="text-ink-tertiary">({job.timezone})</span>
                    </div>
                    <div>
                      Job:{" "}
                      <kbd className="kbd font-mono text-[10px]">
                        {job.jobType}
                      </kbd>
                    </div>
                    <div className="tabular">
                      Next run:{" "}
                      <span className="text-ink">
                        {job.nextRunAt
                          ? new Date(job.nextRunAt).toLocaleString()
                          : "—"}
                      </span>
                    </div>
                    {job.lastRunAt && (
                      <div className="tabular text-ink-tertiary">
                        Last run: {new Date(job.lastRunAt).toLocaleString()}
                      </div>
                    )}
                    {job.lastError && (
                      <div className="text-rose">{job.lastError}</div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => toggle(job)}
                    className="rounded-[var(--radius-sm)] p-1.5 text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink"
                    title={job.enabled ? "Pause" : "Resume"}
                    aria-label={job.enabled ? "Pause schedule" : "Resume schedule"}
                  >
                    {job.enabled ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => remove(job)}
                    className="rounded-[var(--radius-sm)] p-1.5 text-ink-tertiary transition-colors hover:bg-rose-light hover:text-rose"
                    title="Delete"
                    aria-label="Delete schedule"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New scheduled job</DialogTitle>
            <DialogDescription>
              Pick a preset or enter a cron expression. Job types are registered in the backend.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Monday digest to Slack"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>When to run</Label>
              <Select
                value={form.preset}
                onValueChange={(val) => setForm((f) => ({ ...f, preset: val }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.preset === "custom" && (
                <Input
                  placeholder="0 9 * * 1"
                  value={form.customCron}
                  onChange={(e) => setForm((f) => ({ ...f, customCron: e.target.value }))}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jobType">Job type</Label>
              <Input
                id="jobType"
                placeholder="digest_email"
                value={form.jobType}
                onChange={(e) => setForm((f) => ({ ...f, jobType: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Must match a jobType registered in the backend (see services/cron).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
