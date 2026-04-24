"use client";

/**
 * Skills management page.
 *
 * Admin page that lets a workspace manage markdown playbook skills
 * invoked as `/slug` from meetings. Backed by /api/skills.
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
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { Sparkles, Plus, Loader2, Trash2, Pause, Play, FileText } from "lucide-react";

interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  disabled: boolean;
  createdAt: string;
}

const EXAMPLE_SOURCE = `---
name: Investor Update
description: Draft our monthly investor update.
---

Write an investor update using the tone and format from past updates.
Focus on wins, misses, and next month's goals. Keep it under 400 words.`;

export default function SkillsPage() {
  const toast = useToast();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [source, setSource] = useState(EXAMPLE_SOURCE);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Skill[]>(`/api/skills?includeDisabled=true`);
      if (res.success && res.data) setSkills(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    setSaving(true);
    try {
      const res = await api.post(`/api/skills`, { source });
      if (res.success) {
        toast.success("Skill created");
        setDialogOpen(false);
        setSource(EXAMPLE_SOURCE);
        await load();
      } else {
        toast.error("Couldn't create skill", res.error?.message ?? "Unknown error");
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleDisabled(skill: Skill) {
    await api.put(`/api/skills/${skill.id}`, { disabled: !skill.disabled });
    await load();
  }

  async function remove(skill: Skill) {
    if (!confirm(`Delete skill "${skill.name}"?`)) return;
    await api.delete(`/api/skills/${skill.id}`);
    toast.success("Skill deleted");
    await load();
  }

  return (
    <div className="min-h-screen">
      <Header title="Skills" />
      <div className="max-w-5xl space-y-8 p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
              Skills
            </h2>
            <p className="max-w-[58ch] text-sm text-ink-secondary">
              Markdown playbooks your AI workforce can invoke with{" "}
              <kbd className="kbd">/slug</kbd> from any meeting. Write once,
              reuse forever.
            </p>
          </div>
          <Button variant="accent" className="glow" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> New skill
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="skeleton h-20 rounded-[var(--radius-lg)]"
              />
            ))}
          </div>
        ) : skills.length === 0 ? (
          <Card className="glass-strong">
            <CardContent className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-accent-subtle">
                <Sparkles className="h-7 w-7 text-accent" />
              </div>
              <h3 className="font-display text-lg font-semibold tracking-[-0.02em] text-ink">
                No skills yet
              </h3>
              <p className="mt-1 max-w-sm text-sm text-ink-secondary">
                Skills are reusable playbooks your AI uses when you invoke
                them.
              </p>
              <Button
                variant="accent"
                className="glow mt-4"
                onClick={() => setDialogOpen(true)}
              >
                Create your first skill
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className={`card-interactive flex items-start justify-between gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-5 shadow-[var(--shadow-card)] transition-all duration-[160ms] hover:border-border-strong ${
                  skill.disabled ? "opacity-60" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <kbd className="kbd font-mono">/{skill.slug}</kbd>
                    <span className="font-semibold text-ink">{skill.name}</span>
                    {skill.disabled && (
                      <Badge
                        variant="default"
                        className="uppercase tracking-[0.08em]"
                      >
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-ink-secondary">
                    {skill.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => toggleDisabled(skill)}
                    className="rounded-[var(--radius-sm)] p-1.5 text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink"
                    title={skill.disabled ? "Enable" : "Disable"}
                    aria-label={skill.disabled ? "Enable skill" : "Disable skill"}
                  >
                    {skill.disabled ? (
                      <Play className="h-4 w-4" />
                    ) : (
                      <Pause className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => remove(skill)}
                    className="rounded-[var(--radius-sm)] p-1.5 text-ink-tertiary transition-colors hover:bg-rose-light hover:text-rose"
                    title="Delete"
                    aria-label="Delete skill"
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
            <DialogDescription>
              Paste a markdown playbook. YAML frontmatter with{" "}
              <code className="px-1 rounded bg-muted">name</code> and{" "}
              <code className="px-1 rounded bg-muted">description</code> is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="source">Markdown source</Label>
            <textarea
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              rows={18}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" /> Save skill
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
