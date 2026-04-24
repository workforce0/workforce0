"use client";

/**
 * Library page (M7.3) — audit-only browser for the skills + subagents
 * the chief_of_staff can choose from when decomposing a ticket. Users
 * don't edit from here; the source of truth is the vendored content
 * in vendor/. This page answers "what did it have to work with?".
 */

import { useEffect, useState } from "react";
import { api, type SkillPackage, type SubagentDefinition, type ExecutionPlan } from "@/lib/api";
import { Header } from "@/components/header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sparkles, Bot, Search, Shield, Wrench, ClipboardList } from "lucide-react";
import { timeAgo } from "@/lib/utils";

type Tab = "skills" | "subagents" | "plans";

type PlanWithParent = ExecutionPlan & { parent: { id: string; title: string; status: string } | null };

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>("skills");
  const [skills, setSkills] = useState<SkillPackage[]>([]);
  const [subagents, setSubagents] = useState<SubagentDefinition[]>([]);
  const [plans, setPlans] = useState<PlanWithParent[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, a, p] = await Promise.all([
          api.listSkills(),
          api.listSubagents(),
          api.listRecentPlans(),
        ]);
        if (s.data) setSkills(s.data);
        if (a.data) setSubagents(a.data);
        if (p.data) setPlans(p.data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredSkills = search
    ? skills.filter(
        (s) =>
          s.slug.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase()),
      )
    : skills;

  const filteredSubagents = search
    ? subagents.filter(
        (a) =>
          a.slug.toLowerCase().includes(search.toLowerCase()) ||
          a.description.toLowerCase().includes(search.toLowerCase()) ||
          (a.category ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : subagents;

  const subagentsByCategory = groupByCategory(filteredSubagents);

  return (
    <div className="min-h-screen">
      <Header title="Library" />

      <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
        <div>
          <p className="text-[13px] text-ink-secondary max-w-2xl">
            A catalog the chief-of-staff planner composes from — <strong>not</strong> a persistent
            deployment. Plans cap at 6 steps and typically use 2–4 of these as tools for a single
            ticket. Vendored from{" "}
            <span className="font-mono text-[12px]">anthropics/skills</span> and{" "}
            <span className="font-mono text-[12px]">awesome-claude-code-subagents</span>.
            This page is a receipt — no editing from here.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="skills">
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                Skills <span className="ml-1.5 text-ink-tertiary">{skills.length}</span>
              </TabsTrigger>
              <TabsTrigger value="subagents">
                <Bot className="w-3.5 h-3.5 mr-1.5" />
                Subagents <span className="ml-1.5 text-ink-tertiary">{subagents.length}</span>
              </TabsTrigger>
              <TabsTrigger value="plans">
                <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
                Recent Plans <span className="ml-1.5 text-ink-tertiary">{plans.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input
              placeholder="Search by name or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-[13px] text-ink-tertiary">Loading library…</div>
        ) : tab === "skills" ? (
          filteredSkills.length === 0 ? (
            <EmptyState kind="skills" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredSkills.map((s) => (
                <SkillCard key={s.id} skill={s} />
              ))}
            </div>
          )
        ) : tab === "subagents" ? (
          subagentsByCategory.length === 0 ? (
            <EmptyState kind="subagents" />
          ) : (
            <div className="space-y-6">
              {subagentsByCategory.map(([category, rows]) => (
                <div key={category}>
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary mb-2">
                    {prettifyCategory(category)}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {rows.map((a) => (
                      <SubagentCard key={a.id} subagent={a} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : plans.length === 0 ? (
          <EmptyPlans />
        ) : (
          <div className="space-y-2">
            {plans.map((p) => (
              <PlanCard key={p.id} plan={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanWithParent }) {
  const statusColor: Record<string, string> = {
    active: "bg-accent-subtle text-accent",
    superseded: "bg-surface-sunken text-ink-tertiary",
    done: "bg-emerald-light text-emerald",
    failed: "bg-rose/10 text-rose",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[13.5px] font-semibold text-ink truncate">
                {plan.parent?.title ?? "(unknown ticket)"}
              </h3>
              <Badge className={`text-[10px] ${statusColor[plan.status] ?? "bg-surface-sunken text-ink-tertiary"}`}>
                {plan.status}
              </Badge>
              <span className="text-[11px] text-ink-tertiary">attempt {plan.attempt} of 3</span>
              {/* M8.3: decomposition-quality badges */}
              {typeof plan.critiqueScore === "number" && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    plan.critiqueScore >= 20
                      ? "bg-emerald-light text-emerald"
                      : plan.critiqueScore >= 15
                      ? "bg-amber-light text-amber"
                      : "bg-rose/10 text-rose"
                  }`}
                  title="Critique score (0–25). ≥20 passes on first draft; below triggers a revision."
                >
                  critique {plan.critiqueScore}/25
                </span>
              )}
              {plan.revised && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-surface-sunken text-ink-tertiary"
                  title="Planner revised this after the critic scored below threshold."
                >
                  revised
                </span>
              )}
              {plan.candidateCount && plan.candidateCount > 1 && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-surface-sunken text-ink-tertiary"
                  title="How many parallel candidates self-consistency evaluated before picking a winner."
                >
                  {plan.candidateCount}× consistent
                </span>
              )}
              {/* PG.13: graph-staleness — shown only when we can compare. */}
              {plan.graphStale === true && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-600"
                  title="This plan was built against an earlier project graph. The codebase has changed since — the step targets may reference renamed or removed landmarks."
                >
                  stale graph
                </span>
              )}
              {plan.graphStale === false && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-500/10 text-emerald-600"
                  title="Plan built against the current project graph."
                >
                  fresh graph
                </span>
              )}
            </div>
            <p className="text-[12.5px] text-ink-secondary mt-1 line-clamp-2">{plan.channelSummary}</p>
            {plan.replanReason && (
              <p className="text-[11.5px] text-rose mt-1 line-clamp-2 font-mono">
                replan: {plan.replanReason}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2 text-[11px] text-ink-tertiary">
              <span>{plan.steps?.length ?? 0} step{(plan.steps?.length ?? 0) === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>{timeAgo(plan.createdAt)}</span>
            </div>
          </div>
        </div>
        {plan.steps && plan.steps.length > 0 && (
          <ol className="mt-3 pl-5 list-decimal space-y-1 border-t border-ink/[0.06] pt-3">
            {plan.steps.map((s, i) => (
              <li key={i} className="text-[12px] text-ink-secondary">
                <span className="font-medium text-ink">{s.title}</span>
                <span className="ml-2 text-ink-tertiary text-[11px]">
                  → {s.roleSlug}
                  {s.subagentSlug ? ` · ${s.subagentSlug}` : ""}
                  {s.skills && s.skills.length > 0 ? ` · skills: ${s.skills.join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyPlans() {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <ClipboardList className="w-10 h-10 text-ink-tertiary mx-auto mb-3" />
        <p className="text-[13.5px] font-semibold text-ink mb-1">No plans yet</p>
        <p className="text-[12.5px] text-ink-tertiary">
          The chief of staff hasn&apos;t decomposed any tickets yet. Plans will appear here after the
          first meeting drops a chief_of_staff ticket into the queue.
        </p>
      </CardContent>
    </Card>
  );
}

function SkillCard({ skill }: { skill: SkillPackage }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 text-accent flex-shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[13.5px] font-semibold text-ink truncate">{skill.slug}</h3>
              <SourceBadge source={skill.source} />
              {skill.status !== "active" && (
                <Badge className="bg-amber-light text-amber text-[10px]">
                  {skill.status.replace("_", " ")}
                </Badge>
              )}
            </div>
            {skill.description && (
              <p className="text-[12.5px] text-ink-secondary mt-1 line-clamp-3">
                {skill.description}
              </p>
            )}
            {skill.requiredTools && skill.requiredTools.length > 0 && (
              <div className="flex items-center gap-1 mt-2 flex-wrap">
                <Wrench className="w-3 h-3 text-ink-tertiary" />
                {skill.requiredTools.map((t) => (
                  <span
                    key={t}
                    className="text-[10.5px] font-mono text-ink-tertiary bg-surface-sunken px-1.5 py-0.5 rounded"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SubagentCard({ subagent }: { subagent: SubagentDefinition }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-ink/5 text-ink flex-shrink-0 mt-0.5">
            <Bot className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[13.5px] font-semibold text-ink truncate">{subagent.slug}</h3>
              <SourceBadge source={subagent.source} />
              {subagent.preferredModel && (
                <Badge className="bg-surface-sunken text-ink-secondary text-[10px]">
                  {subagent.preferredModel}
                </Badge>
              )}
            </div>
            {subagent.description && (
              <p className="text-[12.5px] text-ink-secondary mt-1 line-clamp-3">
                {subagent.description}
              </p>
            )}
            {subagent.allowedTools && subagent.allowedTools.length > 0 && (
              <div className="flex items-center gap-1 mt-2 flex-wrap">
                <Shield className="w-3 h-3 text-ink-tertiary" />
                {subagent.allowedTools.slice(0, 6).map((t) => (
                  <span
                    key={t}
                    className="text-[10.5px] font-mono text-ink-tertiary bg-surface-sunken px-1.5 py-0.5 rounded"
                  >
                    {t}
                  </span>
                ))}
                {subagent.allowedTools.length > 6 && (
                  <span className="text-[10.5px] text-ink-tertiary">
                    +{subagent.allowedTools.length - 6}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SourceBadge({ source }: { source: string }) {
  const color =
    source === "vendor"
      ? "bg-emerald-light text-emerald"
      : source === "user"
      ? "bg-accent-subtle text-accent"
      : "bg-surface-sunken text-ink-tertiary";
  return <Badge className={`${color} text-[10px]`}>{source}</Badge>;
}

function EmptyState({ kind }: { kind: "skills" | "subagents" }) {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <p className="text-[13.5px] font-semibold text-ink mb-1">No {kind} found</p>
        <p className="text-[12.5px] text-ink-tertiary">
          Try clearing the search, or check that <span className="font-mono">vendor/</span> was
          seeded at boot.
        </p>
      </CardContent>
    </Card>
  );
}

function groupByCategory(rows: SubagentDefinition[]): Array<[string, SubagentDefinition[]]> {
  const buckets = new Map<string, SubagentDefinition[]>();
  for (const r of rows) {
    const key = r.category ?? "uncategorized";
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function prettifyCategory(category: string): string {
  return category.replace(/^\d+-/, "").replace(/-/g, " ");
}
