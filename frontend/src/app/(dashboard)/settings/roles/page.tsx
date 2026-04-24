"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Header } from "@/components/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Bot, Coins, Save, Settings2, Sparkles } from "lucide-react";

interface Role {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  systemPromptTemplate: string | null;
  allowedTools: string[];
  monthlyBudgetTokens: number | null;
  defaultConcurrency: number;
  parentRoleSlug: string | null;
  isBuiltin: boolean;
  isActive: boolean;
  isOverride: boolean;
}

/** Build a parent→children map and root list from a flat role list. */
function buildTree(roles: Role[]): { roots: Role[]; childrenBy: Map<string, Role[]> } {
  const bySlug = new Map(roles.map((r) => [r.slug, r] as const));
  const childrenBy = new Map<string, Role[]>();
  const roots: Role[] = [];
  for (const role of roles) {
    if (role.parentRoleSlug && bySlug.has(role.parentRoleSlug)) {
      const siblings = childrenBy.get(role.parentRoleSlug) ?? [];
      siblings.push(role);
      childrenBy.set(role.parentRoleSlug, siblings);
    } else {
      roots.push(role);
    }
  }
  // Sort alphabetically within each level for stable UI.
  roots.sort((a, b) => a.displayName.localeCompare(b.displayName));
  for (const arr of childrenBy.values()) arr.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { roots, childrenBy };
}

function RoleNode({
  role,
  childrenBy,
  depth,
}: {
  role: Role;
  childrenBy: Map<string, Role[]>;
  depth: number;
}) {
  const kids = childrenBy.get(role.slug) ?? [];
  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-sm"
        style={{ marginLeft: depth * 20 }}
      >
        {depth > 0 && <span className="text-ink-tertiary">↳</span>}
        <span className="font-medium text-ink">{role.displayName}</span>
        <span className="text-[11px] text-ink-tertiary">
          {role.category}
          {!role.isActive && ' · disabled'}
        </span>
      </div>
      {kids.map((k) => (
        <RoleNode key={k.slug} role={k} childrenBy={childrenBy} depth={depth + 1} />
      ))}
    </div>
  );
}

const categoryBadge: Record<string, string> = {
  consultant: "bg-violet-light text-violet",
  execution: "bg-sky-light text-sky",
  meta: "bg-amber-light text-amber",
};

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    monthlyBudgetTokens: string;
    defaultConcurrency: string;
    isActive: boolean;
    systemPromptTemplate: string;
    parentRoleSlug: string;
  }>({ monthlyBudgetTokens: "", defaultConcurrency: "2", isActive: true, systemPromptTemplate: "", parentRoleSlug: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAgentRoles();
      if (res.data) setRoles(res.data);
    } catch {
      setError("Unable to load agent roles.");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(role: Role) {
    setEditingSlug(role.slug);
    setDraft({
      monthlyBudgetTokens: role.monthlyBudgetTokens?.toString() ?? "",
      defaultConcurrency: role.defaultConcurrency.toString(),
      isActive: role.isActive,
      systemPromptTemplate: role.systemPromptTemplate ?? "",
      parentRoleSlug: role.parentRoleSlug ?? "",
    });
  }

  async function save(slug: string) {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        defaultConcurrency: parseInt(draft.defaultConcurrency, 10) || 2,
        isActive: draft.isActive,
      };
      const budget = draft.monthlyBudgetTokens.trim();
      patch.monthlyBudgetTokens = budget === "" ? null : parseInt(budget, 10);
      const prompt = draft.systemPromptTemplate.trim();
      patch.systemPromptTemplate = prompt === "" ? null : prompt;
      const parent = draft.parentRoleSlug.trim();
      patch.parentRoleSlug = parent === "" ? null : parent;
      await api.patchAgentRole(slug, patch);
      setEditingSlug(null);
      await load();
    } catch {
      setError("Save failed — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function resetOverride(slug: string) {
    if (!confirm(`Reset "${slug}" to the global built-in defaults?`)) return;
    await api.deleteAgentRoleOverride(slug);
    await load();
  }

  return (
    <div className="min-h-screen">
      <Header title="Agent Roles" />

      <div className="max-w-5xl space-y-6 p-6 lg:p-8">
        <div className="space-y-2">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
            Agent Roles
          </h2>
          <p className="max-w-[68ch] text-sm text-ink-secondary">
            Every agent in your workforce has a role — a slot with its own
            budget, prompt template, and allowed tools. Ship with six
            built-ins; add your own from the API and they show up here.
            Overrides are tenant-scoped and never touch the global defaults.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-rose/20 bg-rose-light p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose" />
            <p className="flex-1 text-sm font-medium text-rose">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton h-28 rounded-[var(--radius-md)]" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Org chart — tree of roles by parent/child */}
            <Card>
              <CardContent className="p-5">
                <h3 className="mb-3 font-semibold text-ink">Org chart</h3>
                <p className="mb-4 text-xs text-ink-tertiary">
                  Change a role's reporting line by clicking Edit → Parent. The
                  tree drives the UI grouping only — routing is still role-keyed
                  via the pull queue.
                </p>
                {(() => {
                  const { roots, childrenBy } = buildTree(roles);
                  return (
                    <div className="space-y-1.5">
                      {roots.map((r) => (
                        <RoleNode key={r.slug} role={r} childrenBy={childrenBy} depth={0} />
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Per-role edit cards */}
            {roles.map((role) => {
              const isEditing = editingSlug === role.slug;
              return (
                <Card key={role.slug} className={role.isActive ? "" : "opacity-60"}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent-subtle text-accent">
                          <Bot className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-ink">{role.displayName}</h3>
                            <kbd className="kbd font-mono">{role.slug}</kbd>
                            <Badge className={categoryBadge[role.category] ?? "bg-surface-sunken text-ink-secondary"}>
                              {role.category}
                            </Badge>
                            {role.isBuiltin && !role.isOverride && (
                              <Badge className="bg-surface-sunken text-ink-tertiary">built-in</Badge>
                            )}
                            {role.isOverride && (
                              <Badge className="bg-amber-light text-amber">tenant override</Badge>
                            )}
                            {!role.isActive && (
                              <Badge className="bg-rose-light text-rose">disabled</Badge>
                            )}
                          </div>
                          <p className="mt-1 max-w-[64ch] text-sm text-ink-secondary">
                            {role.description}
                          </p>
                          {!isEditing && (
                            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-tertiary tabular">
                              <span className="flex items-center gap-1">
                                <Coins className="h-3 w-3" />
                                {role.monthlyBudgetTokens === null
                                  ? "unlimited"
                                  : `${role.monthlyBudgetTokens.toLocaleString()} tok/mo`}
                              </span>
                              <span>·</span>
                              <span>concurrency {role.defaultConcurrency}</span>
                              {role.allowedTools.length > 0 && (
                                <>
                                  <span>·</span>
                                  <span>{role.allowedTools.length} tools</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {!isEditing && (
                        <div className="flex gap-2">
                          {role.isOverride && (
                            <Button variant="ghost" size="sm" onClick={() => resetOverride(role.slug)}>
                              Reset
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => startEdit(role)}>
                            <Settings2 className="h-4 w-4" />
                            Edit
                          </Button>
                        </div>
                      )}
                    </div>

                    {isEditing && (
                      <div className="mt-5 grid gap-4 border-t border-border pt-5 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                            Monthly token budget
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={draft.monthlyBudgetTokens}
                            placeholder="leave blank = unlimited"
                            onChange={(e) => setDraft((d) => ({ ...d, monthlyBudgetTokens: e.target.value }))}
                            className="w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-sm"
                          />
                          <p className="mt-1 text-[11px] text-ink-tertiary">
                            Pre-flight check. 0 or blank = no cap.
                          </p>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                            Default concurrency
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={32}
                            value={draft.defaultConcurrency}
                            onChange={(e) => setDraft((d) => ({ ...d, defaultConcurrency: e.target.value }))}
                            className="w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                            <Sparkles className="h-3 w-3" />
                            System prompt template (optional)
                          </label>
                          <textarea
                            rows={4}
                            value={draft.systemPromptTemplate}
                            placeholder="Leave blank to keep the in-code default for built-ins."
                            onChange={(e) => setDraft((d) => ({ ...d, systemPromptTemplate: e.target.value }))}
                            className="w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 font-mono text-xs"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                            Reports to
                          </label>
                          <select
                            value={draft.parentRoleSlug}
                            onChange={(e) => setDraft((d) => ({ ...d, parentRoleSlug: e.target.value }))}
                            className="w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-sm"
                          >
                            <option value="">(top level — no parent)</option>
                            {roles
                              .filter((r) => r.slug !== role.slug) // a role can't be its own parent
                              .map((r) => (
                                <option key={r.slug} value={r.slug}>
                                  {r.displayName}
                                </option>
                              ))}
                          </select>
                          <p className="mt-1 text-[11px] text-ink-tertiary">
                            Used for the org-chart view. Routing is unaffected — every role
                            still pulls from its own ticket queue.
                          </p>
                        </div>
                        <div className="md:col-span-2 flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`active-${role.slug}`}
                            checked={draft.isActive}
                            onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                          />
                          <label htmlFor={`active-${role.slug}`} className="text-sm text-ink">
                            Active (disabled roles don't receive new work)
                          </label>
                        </div>
                        <div className="md:col-span-2 flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setEditingSlug(null)} disabled={saving}>
                            Cancel
                          </Button>
                          <Button variant="accent" size="sm" onClick={() => save(role.slug)} disabled={saving}>
                            <Save className="h-4 w-4" />
                            {saving ? "Saving…" : "Save override"}
                          </Button>
                        </div>
                      </div>
                    )}
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
