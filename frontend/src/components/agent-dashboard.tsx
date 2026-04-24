"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Plus,
  Loader2,
  Copy,
  Trash2,
  GitBranch,
  Terminal,
  CheckCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentToken {
  id: string;
  name: string;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface AgentStatusInfo {
  agentId: string;
  repos: string[];
  capabilities: string[];
  activeJobs: number;
  maxActiveJobs: number;
  connectedAt: string;
  lastPingAt: string;
}

interface AgentJob {
  id: string;
  action: string;
  status: string;
  targetRepo: string;
  result: unknown;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface AgentDashboardProps {
  onDisconnected: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jobStatusBadge(status: string) {
  switch (status) {
    case "done":
      return (
        <Badge className="bg-emerald-light text-emerald border-0 font-medium">
          Done
        </Badge>
      );
    case "in_progress":
      return (
        <Badge className="bg-amber-light text-amber border-0 font-medium">
          In Progress
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-rose-light text-rose border-0 font-medium">
          Failed
        </Badge>
      );
    default:
      return (
        <Badge variant="default" className="font-medium">
          Pending
        </Badge>
      );
  }
}

function formatAction(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Skeleton helpers ─────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="skeleton w-2 h-2 rounded-full" />
          <div className="skeleton h-4 w-40" />
        </div>
        <div className="skeleton h-3 w-56" />
        <div className="flex gap-2">
          <div className="skeleton h-5 w-16 rounded-full" />
          <div className="skeleton h-5 w-20 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between py-3 border-b border-ink/[0.06] last:border-0">
      <div className="flex items-center gap-3">
        <div className="skeleton h-4 w-28" />
        <div className="skeleton h-4 w-36" />
      </div>
      <div className="skeleton h-4 w-16" />
    </div>
  );
}

// ─── Section 1: Connected Agents ──────────────────────────────────────────────

function ConnectedAgentsSection({ onDisconnected }: { onDisconnected: () => void }) {
  const [agents, setAgents] = useState<AgentStatusInfo[]>([]);
  const [connected, setConnected] = useState(0);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.getAgentStatus();
      if (res.data) {
        setAgents(res.data.agents);
        setConnected(res.data.connected);
        if (res.data.connected === 0) {
          onDisconnectedRef.current();
        }
      }
    } catch {
      // Silently ignore — could be a transient error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    function scheduleNext() {
      // Jitter between 25–35 seconds
      const jitter = 25000 + Math.random() * 10000;
      intervalRef.current = setTimeout(() => {
        fetchStatus().then(scheduleNext);
      }, jitter);
    }

    scheduleNext();

    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [fetchStatus]);

  return (
    <section className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-ink">Connected Agents</h3>
        <Badge variant={connected > 0 ? "success" : "default"} className="font-medium">
          {connected} Online
        </Badge>
      </div>

      {/* Body */}
      {loading ? (
        <SkeletonCard />
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-ink-tertiary">No agents connected.</p>
            <p className="text-xs text-ink-tertiary mt-1">
              Start your agent with a valid token to see it here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <Card key={agent.agentId}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2 min-w-0">
                    {/* Status + repos */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="w-2 h-2 rounded-full bg-emerald flex-shrink-0"
                        aria-label="Connected"
                      />
                      {agent.repos.length > 0 ? (
                        <span className="flex items-center gap-1 text-sm font-medium text-ink truncate">
                          <GitBranch className="w-3.5 h-3.5 text-ink-tertiary flex-shrink-0" />
                          {agent.repos.join(", ")}
                        </span>
                      ) : (
                        <span className="text-sm text-ink-tertiary italic">No repos</span>
                      )}
                    </div>

                    {/* Capabilities */}
                    {agent.capabilities.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Terminal className="w-3.5 h-3.5 text-ink-tertiary flex-shrink-0" />
                        {agent.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-ink/[0.06] text-ink-secondary"
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right side */}
                  <div className="text-right flex-shrink-0 space-y-1">
                    <p className="text-sm font-medium text-ink">
                      {agent.activeJobs > 0
                        ? `${agent.activeJobs} active job${agent.activeJobs !== 1 ? "s" : ""}`
                        : "Idle"}
                    </p>
                    <p className="text-xs text-ink-tertiary">
                      Connected {timeAgo(agent.connectedAt)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Section 2: Agent Tokens ──────────────────────────────────────────────────

function AgentTokensSection() {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Revoke dialog
  const [revokeTarget, setRevokeTarget] = useState<AgentToken | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadTokens = useCallback(async () => {
    try {
      const res = await api.listAgentTokens();
      if (res.data) setTokens(res.data.tokens);
    } catch {
      // Silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  async function handleCreate() {
    if (!newTokenName.trim()) return;
    setCreating(true);
    try {
      const res = await api.createAgentToken(newTokenName.trim());
      if (res.data) {
        setCreatedToken(res.data.token);
        setNewTokenName("");
        await loadTokens();
      }
    } catch {
      // Error handled by leaving dialog open
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.revokeAgentToken(revokeTarget.id);
      setTokens((prev) =>
        prev.map((t) =>
          t.id === revokeTarget.id
            ? { ...t, revokedAt: new Date().toISOString() }
            : t
        )
      );
      setRevokeTarget(null);
    } catch {
      // Silently ignore
    } finally {
      setRevoking(false);
    }
  }

  function handleCopy() {
    if (!createdToken) return;
    navigator.clipboard.writeText(createdToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCreateDialogClose(open: boolean) {
    if (!open) {
      setCreatedToken(null);
      setNewTokenName("");
      setCopied(false);
    }
    setCreateOpen(open);
  }

  return (
    <section className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-ink">Agent Tokens</h3>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          New Token
        </Button>
      </div>

      {/* Token list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-4 py-1">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : tokens.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-ink-tertiary">No tokens yet.</p>
              <p className="text-xs text-ink-tertiary mt-1">
                Create a token and pass it to your agent at startup.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ink/[0.06]">
              {tokens.map((token) => {
                const isRevoked = token.revokedAt !== null;
                return (
                  <li
                    key={token.id}
                    className={`flex items-center justify-between gap-4 px-4 py-3 ${
                      isRevoked ? "opacity-50" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-ink truncate">
                          {token.name}
                        </span>
                        {isRevoked && (
                          <Badge variant="error" className="font-medium">
                            Revoked
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-ink-tertiary font-mono">
                        wf0_&bull;&bull;&bull;{token.tokenHint}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-ink-tertiary hidden sm:block">
                        {token.lastUsedAt
                          ? `Used ${timeAgo(token.lastUsedAt)}`
                          : "Never used"}
                      </span>
                      {!isRevoked && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-rose border-rose/30 hover:bg-rose-light hover:text-rose gap-1.5"
                          onClick={() => setRevokeTarget(token)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Revoke
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Create Token Dialog ── */}
      <Dialog open={createOpen} onOpenChange={handleCreateDialogClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Agent Token</DialogTitle>
          </DialogHeader>

          {createdToken ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-secondary">
                Token created successfully. Copy it now — it will not be shown again.
              </p>
              <div className="relative">
                <pre className="bg-surface-sunken rounded-xl p-3 pr-10 text-xs font-mono text-ink break-all whitespace-pre-wrap">
                  {createdToken}
                </pre>
                <button
                  onClick={handleCopy}
                  className="absolute top-2 right-2 p-1.5 rounded-lg hover:bg-ink/[0.08] transition-colors"
                  aria-label="Copy token"
                >
                  {copied ? (
                    <CheckCircle className="w-4 h-4 text-emerald" />
                  ) : (
                    <Copy className="w-4 h-4 text-ink-tertiary" />
                  )}
                </button>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Done</Button>
                </DialogClose>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Token Name</label>
                <Input
                  placeholder="e.g. Production Agent"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                  }}
                  autoFocus
                />
                <p className="text-xs text-ink-tertiary">
                  Give this token a recognisable name so you can revoke it later.
                </p>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" disabled={creating}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  onClick={handleCreate}
                  disabled={!newTokenName.trim() || creating}
                  className="gap-1.5"
                >
                  {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Create Token
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Revoke Confirmation Dialog ── */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke token &apos;{revokeTarget?.name}&apos;?</DialogTitle>
          </DialogHeader>
          <div className="rounded-xl bg-rose-light/60 border border-rose/20 p-3 text-sm text-rose">
            Any agent currently using this token will be immediately disconnected.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={revoking}
              onClick={() => setRevokeTarget(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRevoke}
              disabled={revoking}
              className="bg-rose hover:bg-rose/90 text-white gap-1.5"
            >
              {revoking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─── Section 3: Recent Jobs ───────────────────────────────────────────────────

function RecentJobsSection() {
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getAgentJobs({ limit: 5 });
        if (res.data) setJobs(res.data);
      } catch {
        // Silently ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-ink">Recent Jobs</h3>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-4 py-1">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-8 text-center px-4">
              <p className="text-sm text-ink-tertiary">No jobs yet</p>
              <p className="text-xs text-ink-tertiary mt-1">
                Jobs will appear here once your agent starts working.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ink/[0.06]">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex items-center gap-3 px-4 py-3 flex-wrap sm:flex-nowrap"
                >
                  {jobStatusBadge(job.status)}
                  <span className="text-sm font-medium text-ink flex-1 min-w-0 truncate">
                    {formatAction(job.action)}
                  </span>
                  <span className="text-xs text-ink-tertiary truncate max-w-[140px] hidden sm:block">
                    {job.targetRepo}
                  </span>
                  <span className="text-xs text-ink-tertiary flex-shrink-0 ml-auto sm:ml-0">
                    {timeAgo(job.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AgentDashboard({ onDisconnected }: AgentDashboardProps) {
  return (
    <div className="space-y-8">
      <ConnectedAgentsSection onDisconnected={onDisconnected} />
      <AgentTokensSection />
      <RecentJobsSection />
    </div>
  );
}
