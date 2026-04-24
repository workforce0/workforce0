"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  FolderKanban,
  Plus,
  Archive,
  ArchiveRestore,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { useProjectContext } from "@/lib/project-context";
import { api, type Project } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

const SWATCHES = ["#c2710c", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#64748b"];

export default function ProjectsPage() {
  const searchParams = useSearchParams();
  const { refresh, current, setCurrent } = useProjectContext();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", color: SWATCHES[0] });

  useEffect(() => {
    if (searchParams?.get("new") === "1") setCreating(true);
  }, [searchParams]);

  useEffect(() => {
    load();
  }, [includeArchived]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listProjects({ includeArchived });
      if (res.data) setProjects(res.data);
    } catch {
      setError("Unable to load projects.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      const res = await api.createProject({
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        color: draft.color,
      });
      setDraft({ name: "", description: "", color: SWATCHES[0] });
      setCreating(false);
      await load();
      await refresh();
      if (res.data) setCurrent(res.data.id);
    } catch {
      setError("Create failed — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(p: Project) {
    try {
      await api.updateProject(p.id, { isArchived: !p.isArchived });
      await load();
      await refresh();
    } catch {
      setError("Update failed — try again.");
    }
  }

  async function handleDelete(p: Project) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone. Projects with meetings, briefs, or tickets cannot be deleted — archive them instead.`)) return;
    try {
      await api.deleteProject(p.id);
      await load();
      await refresh();
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Delete failed.";
      setError(msg);
    }
  }

  return (
    <div className="min-h-screen">
      <Header title="Projects" />

      <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] text-ink-secondary max-w-xl">
              Projects are the container every meeting, brief, and ticket belongs to.
              Switch projects from the sidebar to focus the whole dashboard on one piece of work.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-tertiary cursor-pointer">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
                className="rounded accent-accent"
              />
              Show archived
            </label>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="w-4 h-4 mr-1" />
              New Project
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-rose/20 bg-rose/5">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-rose flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-rose">{error}</p>
            </CardContent>
          </Card>
        )}

        {creating && (
          <Card>
            <CardContent className="p-5 space-y-3">
              <h2 className="text-[14px] font-semibold text-ink">New Project</h2>
              <div>
                <label className="text-[12px] font-medium text-ink-secondary mb-1 block">Name</label>
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="e.g. Mobile App Redesign"
                  className="w-full h-10 px-3 rounded-lg border border-ink/10 bg-surface text-[13.5px] text-ink focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-ink-secondary mb-1 block">
                  Description <span className="text-ink-tertiary font-normal">(optional)</span>
                </label>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Short summary — what's this project for?"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-ink/10 bg-surface text-[13.5px] text-ink focus:border-accent focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-ink-secondary mb-1.5 block">Color</label>
                <div className="flex gap-2">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDraft({ ...draft, color: c })}
                      aria-label={`Color ${c}`}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        draft.color === c ? "border-ink scale-110" : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={handleCreate} disabled={saving || !draft.name.trim()}>
                  <Check className="w-4 h-4 mr-1" />
                  {saving ? "Creating..." : "Create"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setCreating(false); setDraft({ name: "", description: "", color: SWATCHES[0] }); }}>
                  <X className="w-4 h-4 mr-1" />
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="text-center py-12 text-[13px] text-ink-tertiary">Loading projects...</div>
        ) : projects.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <FolderKanban className="w-10 h-10 text-ink-tertiary mx-auto mb-3" />
              <h3 className="text-[14px] font-semibold text-ink mb-1">No projects yet</h3>
              <p className="text-[12.5px] text-ink-tertiary mb-4">Create your first project to scope meetings and briefs.</p>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="w-4 h-4 mr-1" />
                New Project
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {projects.map((p) => {
              const isCurrent = current?.id === p.id;
              return (
                <Card key={p.id} className={isCurrent ? "border-accent/30 bg-accent-subtle/20" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0 mt-1.5"
                        style={{ backgroundColor: p.color ?? "#c2710c" }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-[14px] font-semibold text-ink truncate">{p.name}</h3>
                          {isCurrent && <Badge className="bg-accent text-white text-[10px]">Active</Badge>}
                          {p.isArchived && <Badge className="bg-surface-sunken text-ink-tertiary text-[10px]">Archived</Badge>}
                        </div>
                        <p className="text-[11.5px] text-ink-tertiary font-mono mt-0.5">{p.slug}</p>
                        {p.description && (
                          <p className="text-[12.5px] text-ink-secondary mt-2 line-clamp-2">{p.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-3 text-[11px] text-ink-tertiary">
                          <span>Updated {timeAgo(p.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-3 pt-3 border-t border-ink/[0.06]">
                      {!isCurrent && !p.isArchived && (
                        <Button size="sm" variant="ghost" onClick={() => setCurrent(p.id)}>
                          Switch to
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => toggleArchive(p)}>
                        {p.isArchived ? (
                          <><ArchiveRestore className="w-3.5 h-3.5 mr-1" /> Restore</>
                        ) : (
                          <><Archive className="w-3.5 h-3.5 mr-1" /> Archive</>
                        )}
                      </Button>
                      <div className="ml-auto">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(p)}
                          className="text-rose hover:bg-rose/5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
