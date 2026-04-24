"use client";

/**
 * Code Graph page (PG.12)
 *
 * Browses the project-graph built by `project-graph.service`.
 * The graph itself is a TypeScript-native take on graphify
 * (https://github.com/safishamsi/graphify) — this page is the
 * audit UI on top of the six REST endpoints exposed by
 * `routes/project-graph.routes.ts`.
 *
 * What it shows:
 *   • Summary (node / edge / community / language counts + staleness)
 *   • God-nodes (top symbols by degree) — "where complexity concentrates"
 *   • Symbol explorer — who calls X, who lives in X's community
 *   • Path finder — how is symbol A connected to symbol B
 *
 * The user first runs "Build / refresh graph" with a repo path on
 * the server filesystem. After that, push webhooks keep it fresh
 * automatically (see PG.11).
 */

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertCircle,
  Network,
  RefreshCw,
  Search,
  GitBranch,
  Flame,
  Users,
  ArrowRight,
} from "lucide-react";
import { useProjectContext } from "@/lib/project-context";
import {
  api,
  ApiError,
  type GraphNode,
  type ProjectGraphSummary,
} from "@/lib/api";
import { timeAgo } from "@/lib/utils";

type BuildState = { repoPath: string; repoLabel: string };

const STALE_HOURS = 24;

export default function GraphPage() {
  const { current, loading: projectLoading } = useProjectContext();

  const [summary, setSummary] = useState<ProjectGraphSummary | null>(null);
  const [godNodes, setGodNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [buildOpen, setBuildOpen] = useState(false);
  const [build, setBuild] = useState<BuildState>({ repoPath: "", repoLabel: "" });
  const [building, setBuilding] = useState(false);

  // — symbol explorer —
  const [symbolInput, setSymbolInput] = useState("");
  const [symbolQueried, setSymbolQueried] = useState<string | null>(null);
  const [callers, setCallers] = useState<GraphNode[] | null>(null);
  const [community, setCommunity] = useState<GraphNode[] | null>(null);
  const [symbolLoading, setSymbolLoading] = useState(false);

  // — path finder —
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathResult, setPathResult] = useState<string[] | null | undefined>(undefined);
  const [pathLoading, setPathLoading] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const s = await api.getProjectGraph(current.id);
      if (s.data) {
        setSummary(s.data);
        const g = await api.getProjectGraphGodNodes(current.id, 10);
        if (g.data) setGodNodes(g.data);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setSummary(null);
        setGodNodes([]);
        setNotFound(true);
      } else {
        setError((err as Error).message || "Unable to load graph.");
      }
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    if (projectLoading || !current) return;
    setSymbolQueried(null);
    setCallers(null);
    setCommunity(null);
    setPathResult(undefined);
    load();
  }, [current, projectLoading, load]);

  async function handleBuild() {
    if (!current || !build.repoPath.trim()) return;
    setBuilding(true);
    setError(null);
    try {
      await api.buildProjectGraph(current.id, {
        repoPath: build.repoPath.trim(),
        repoLabel: build.repoLabel.trim() || undefined,
      });
      setBuildOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message || "Build failed.");
    } finally {
      setBuilding(false);
    }
  }

  async function handleSymbolLookup() {
    if (!current || !symbolInput.trim()) return;
    const sym = symbolInput.trim();
    setSymbolLoading(true);
    setSymbolQueried(sym);
    try {
      const [c, m] = await Promise.all([
        api.getProjectGraphCallers(current.id, sym),
        api.getProjectGraphCommunity(current.id, sym),
      ]);
      setCallers(c.data ?? []);
      setCommunity(m.data ?? []);
    } catch (err) {
      setError((err as Error).message || "Symbol lookup failed.");
      setCallers([]);
      setCommunity([]);
    } finally {
      setSymbolLoading(false);
    }
  }

  async function handlePathLookup() {
    if (!current || !pathFrom.trim() || !pathTo.trim()) return;
    setPathLoading(true);
    try {
      const r = await api.getProjectGraphPath(current.id, pathFrom.trim(), pathTo.trim());
      setPathResult(r.data ?? null);
    } catch (err) {
      setError((err as Error).message || "Path lookup failed.");
      setPathResult(null);
    } finally {
      setPathLoading(false);
    }
  }

  const staleHours = summary ? hoursSince(summary.updatedAt) : 0;
  const isStale = summary ? staleHours >= STALE_HOURS : false;

  return (
    <div className="min-h-screen">
      <Header title="Code Graph" />

      <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] text-ink-secondary max-w-2xl">
              A map of your codebase — files, classes, functions, and how they call each other.
              The planner reads this to focus briefs on the &quot;god-nodes&quot; where most dependencies
              concentrate, so plans target the parts of the repo that actually change.
            </p>
            <p className="text-[11.5px] text-ink-tertiary mt-1">
              Inspired by{" "}
              <a
                href="https://github.com/safishamsi/graphify"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                safishamsi/graphify
              </a>{" "}
              — reimplemented natively in TypeScript.
            </p>
          </div>
          <Button
            size="sm"
            variant={summary ? "outline" : "default"}
            onClick={() => setBuildOpen((o) => !o)}
            disabled={!current}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            {summary ? "Rebuild" : "Build graph"}
          </Button>
        </div>

        {error && (
          <Card className="border-rose/20 bg-rose/5">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-rose flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-rose">{error}</p>
            </CardContent>
          </Card>
        )}

        {buildOpen && (
          <Card>
            <CardContent className="p-5 space-y-3">
              <div>
                <h2 className="text-[14px] font-semibold text-ink">
                  {summary ? "Rebuild" : "Build"} graph for {current?.name ?? "project"}
                </h2>
                <p className="text-[12px] text-ink-tertiary mt-0.5">
                  Point to a directory on the server filesystem. After the first build, GitHub push
                  webhooks to the same repo will auto-refresh this graph.
                </p>
              </div>
              <div>
                <label className="text-[12px] font-medium text-ink-secondary mb-1 block">
                  Repo path (on the server)
                </label>
                <Input
                  autoFocus
                  value={build.repoPath}
                  onChange={(e) => setBuild({ ...build, repoPath: e.target.value })}
                  placeholder="/srv/repos/acme-app"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-ink-secondary mb-1 block">
                  Repo label{" "}
                  <span className="text-ink-tertiary font-normal">(optional — e.g. acme/app)</span>
                </label>
                <Input
                  value={build.repoLabel}
                  onChange={(e) => setBuild({ ...build, repoLabel: e.target.value })}
                  placeholder="acme/app"
                />
                <p className="text-[11px] text-ink-tertiary mt-1">
                  Use the GitHub <code className="font-mono">owner/name</code> form to enable push-webhook auto-refresh.
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={handleBuild}
                  disabled={building || !build.repoPath.trim()}
                >
                  {building ? "Building..." : summary ? "Rebuild now" : "Build now"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBuildOpen(false)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {projectLoading || loading ? (
          <div className="text-center py-12 text-[13px] text-ink-tertiary">Loading graph...</div>
        ) : !current ? (
          <EmptyCard
            icon={<Network className="w-10 h-10 text-ink-tertiary mx-auto mb-3" />}
            title="Pick a project first"
            body="Switch to a project from the sidebar to browse its code graph."
          />
        ) : notFound || !summary ? (
          <EmptyCard
            icon={<Network className="w-10 h-10 text-ink-tertiary mx-auto mb-3" />}
            title="No graph built yet"
            body="Build the graph from a repository path on the server. Each build takes a few seconds per thousand files."
            action={
              <Button size="sm" onClick={() => setBuildOpen(true)}>
                <RefreshCw className="w-4 h-4 mr-1" /> Build graph
              </Button>
            }
          />
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatTile label="Files / symbols" value={summary.nodeCount.toLocaleString()} />
              <StatTile label="Edges" value={summary.edgeCount.toLocaleString()} />
              <StatTile label="Communities" value={summary.communityCount.toLocaleString()} />
              <StatTile
                label="Languages"
                value={
                  summary.languages.length > 0
                    ? summary.languages.map((l) => humanLang(l)).join(" + ")
                    : "—"
                }
              />
              <StatTile
                label="Last built"
                value={timeAgo(summary.updatedAt)}
                hint={
                  isStale
                    ? { text: "Stale", tone: "warn" }
                    : { text: "Fresh", tone: "ok" }
                }
              />
            </div>

            {summary.repoLabel && (
              <div className="flex items-center gap-2 text-[12.5px] text-ink-tertiary">
                <GitBranch className="w-3.5 h-3.5" />
                <span className="font-mono">{summary.repoLabel}</span>
                <span>· push-webhook auto-refresh enabled</span>
              </div>
            )}

            {/* God-nodes */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Flame className="w-4 h-4 text-amber" />
                  <h2 className="text-[14px] font-semibold text-ink">God-nodes</h2>
                  <Badge className="bg-surface-sunken text-ink-tertiary text-[10px] font-normal">
                    top {godNodes.length} by degree
                  </Badge>
                </div>
                <p className="text-[12px] text-ink-tertiary mb-3">
                  Symbols with the most incoming + outgoing edges. These are where most changes ripple
                  through the repo — the planner pins them at the top of every plan prompt.
                </p>
                {godNodes.length === 0 ? (
                  <p className="text-[12.5px] text-ink-tertiary">No symbols in the graph yet.</p>
                ) : (
                  <ul className="divide-y divide-ink/[0.06]">
                    {godNodes.map((n, i) => (
                      <li
                        key={n.id}
                        className="py-2.5 flex items-center gap-3 cursor-pointer hover:bg-surface-sunken/40 -mx-2 px-2 rounded-md transition-colors"
                        onClick={() => {
                          setSymbolInput(n.name);
                          setSymbolQueried(null);
                        }}
                      >
                        <span className="w-6 text-[11px] text-ink-tertiary font-mono">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <NodeKindBadge kind={n.kind} />
                        <span className="text-[13px] text-ink font-medium truncate">{n.name}</span>
                        <span className="text-[11.5px] text-ink-tertiary font-mono truncate flex-1 min-w-0">
                          {n.file}
                          {n.line ? `:${n.line}` : ""}
                        </span>
                        <span className="text-[11px] text-ink-tertiary flex-shrink-0">
                          degree {n.degree ?? 0}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Symbol explorer */}
            <Card>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-accent" />
                  <h2 className="text-[14px] font-semibold text-ink">Symbol explorer</h2>
                </div>
                <p className="text-[12px] text-ink-tertiary">
                  Enter a class / function / method name to see what calls it and which cluster of
                  related symbols it belongs to.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={symbolInput}
                    onChange={(e) => setSymbolInput(e.target.value)}
                    placeholder="e.g. TaskRepository"
                    onKeyDown={(e) => e.key === "Enter" && handleSymbolLookup()}
                  />
                  <Button
                    size="sm"
                    onClick={handleSymbolLookup}
                    disabled={symbolLoading || !symbolInput.trim()}
                  >
                    {symbolLoading ? "Looking..." : "Look up"}
                  </Button>
                </div>

                {symbolQueried && !symbolLoading && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div>
                      <h3 className="text-[12.5px] font-semibold text-ink mb-2 flex items-center gap-2">
                        <ArrowRight className="w-3.5 h-3.5 text-accent" />
                        Callers of{" "}
                        <span className="font-mono">{symbolQueried}</span>
                        <Badge className="bg-surface-sunken text-ink-tertiary text-[10px] font-normal">
                          {callers?.length ?? 0}
                        </Badge>
                      </h3>
                      <NodeList
                        nodes={callers ?? []}
                        emptyText="No callers found in this graph."
                      />
                    </div>
                    <div>
                      <h3 className="text-[12.5px] font-semibold text-ink mb-2 flex items-center gap-2">
                        <Users className="w-3.5 h-3.5 text-accent" />
                        Community around{" "}
                        <span className="font-mono">{symbolQueried}</span>
                        <Badge className="bg-surface-sunken text-ink-tertiary text-[10px] font-normal">
                          {community?.length ?? 0}
                        </Badge>
                      </h3>
                      <NodeList
                        nodes={community ?? []}
                        emptyText="No Louvain community for this symbol."
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Path finder */}
            <Card>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-accent" />
                  <h2 className="text-[14px] font-semibold text-ink">Path finder</h2>
                </div>
                <p className="text-[12px] text-ink-tertiary">
                  Shortest path between two symbols in the undirected dependency graph.
                </p>
                <div className="flex flex-col md:flex-row gap-2">
                  <Input
                    value={pathFrom}
                    onChange={(e) => setPathFrom(e.target.value)}
                    placeholder="from (e.g. TaskController)"
                  />
                  <Input
                    value={pathTo}
                    onChange={(e) => setPathTo(e.target.value)}
                    placeholder="to (e.g. PrismaClient)"
                    onKeyDown={(e) => e.key === "Enter" && handlePathLookup()}
                  />
                  <Button
                    size="sm"
                    onClick={handlePathLookup}
                    disabled={pathLoading || !pathFrom.trim() || !pathTo.trim()}
                  >
                    {pathLoading ? "Finding..." : "Find path"}
                  </Button>
                </div>

                {pathResult === null && (
                  <p className="text-[12.5px] text-ink-tertiary">
                    No path between these symbols — they&apos;re in disconnected parts of the graph.
                  </p>
                )}
                {Array.isArray(pathResult) && pathResult.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                    {pathResult.map((hop, i) => (
                      <span key={`${hop}-${i}`} className="flex items-center gap-1.5">
                        <span className="font-mono px-2 py-1 rounded-md bg-surface-sunken text-ink">
                          {shortenId(hop)}
                        </span>
                        {i < pathResult.length - 1 && (
                          <ArrowRight className="w-3.5 h-3.5 text-ink-tertiary" />
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: { text: string; tone: "ok" | "warn" };
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] text-ink-tertiary uppercase tracking-wide">{label}</p>
        <p className="text-[18px] font-semibold text-ink mt-1 truncate">{value}</p>
        {hint && (
          <span
            className={
              "inline-block text-[10.5px] font-medium mt-1 px-1.5 py-0.5 rounded " +
              (hint.tone === "ok"
                ? "bg-emerald-500/10 text-emerald-500"
                : "bg-amber-500/10 text-amber-500")
            }
          >
            {hint.text}
          </span>
        )}
      </CardContent>
    </Card>
  );
}

function NodeList({ nodes, emptyText }: { nodes: GraphNode[]; emptyText: string }) {
  if (nodes.length === 0) {
    return <p className="text-[12.5px] text-ink-tertiary">{emptyText}</p>;
  }
  return (
    <ul className="divide-y divide-ink/[0.06] max-h-64 overflow-y-auto">
      {nodes.map((n) => (
        <li key={n.id} className="py-2 flex items-center gap-2">
          <NodeKindBadge kind={n.kind} />
          <span className="text-[12.5px] text-ink truncate">{n.name}</span>
          <span className="text-[11px] text-ink-tertiary font-mono truncate flex-1 min-w-0 text-right">
            {n.file}
            {n.line ? `:${n.line}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function NodeKindBadge({ kind }: { kind: GraphNode["kind"] }) {
  const palette: Record<string, string> = {
    file: "bg-slate-500/10 text-slate-500",
    class: "bg-accent/10 text-accent",
    interface: "bg-blue-500/10 text-blue-500",
    function: "bg-emerald-500/10 text-emerald-600",
    method: "bg-purple-500/10 text-purple-500",
    enum: "bg-pink-500/10 text-pink-500",
    type: "bg-amber-500/10 text-amber-600",
  };
  const cls = palette[kind] ?? "bg-surface-sunken text-ink-tertiary";
  return (
    <span
      className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded ${cls}`}
      aria-label={`Kind: ${kind}`}
    >
      {kind}
    </span>
  );
}

function EmptyCard({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        {icon}
        <h3 className="text-[14px] font-semibold text-ink mb-1">{title}</h3>
        <p className="text-[12.5px] text-ink-tertiary mb-4 max-w-md mx-auto">{body}</p>
        {action}
      </CardContent>
    </Card>
  );
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

function humanLang(l: string): string {
  if (l === "typescript") return "TS";
  if (l === "javascript") return "JS";
  if (l === "python") return "Py";
  return l;
}

function shortenId(id: string): string {
  // Node ids are of the form `<relPath>:<kind>:<name>`. Show `<name>` and keep
  // `<relPath>` as a title tooltip via aria-label on the parent badge.
  const parts = id.split(":");
  return parts[parts.length - 1] ?? id;
}
