"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useProjectScope } from "@/lib/use-project-scope";
import { Header } from "@/components/header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Search,
  ArrowRight,
  Clock,
  ExternalLink,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { timeAgo, getConfidenceLabel } from "@/lib/utils";

interface PRD {
  id: string;
  title: string;
  summary: string;
  status: string;
  confidence: number;
  requirements: unknown[];
  createdAt: string;
  googleDocUrl?: string;
}

export default function PrdsPage() {
  const [prds, setPrds] = useState<PRD[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const loadPrds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { limit: 50 };
      if (filter !== "all") params.status = filter;
      const res = await api.getPrds(params as any);
      if (res.data) setPrds(res.data);
    } catch {
      setError("Unable to load briefs. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadPrds();
  }, [loadPrds]);
  useProjectScope(loadPrds);

  const filteredPrds = searchQuery
    ? prds.filter((p) =>
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.summary.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : prds;

  const needsAttention = prds.filter(
    (p) => p.status === "review" || p.status === "pending_approval" || p.status === "needs_clarification"
  );

  return (
    <div className="min-h-screen">
      <Header title="Briefs" />

      <div className="space-y-6 p-6 lg:p-8">
        {/* Needs Attention Banner */}
        {needsAttention.length > 0 && (
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-transparent border-gradient bg-accent-subtle/40 p-4 shadow-[var(--shadow-card)]">
            <span className="dot-pulse" aria-hidden />
            <AlertCircle className="h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {needsAttention.length} brief
                {needsAttention.length > 1 ? "s" : ""} need your attention
              </p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                Review and approve to create Jira tickets.
              </p>
            </div>
            <Button variant="accent" size="sm" className="ml-auto glow" asChild>
              <Link href="/approvals">
                Open approvals
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="review">Needs Review</TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input
              placeholder="Search briefs…"
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-rose/20 bg-rose-light p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose" />
            <p className="flex-1 text-sm font-medium text-rose">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadPrds}
              className="text-rose hover:bg-rose/10"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        )}

        {/* Brief List */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="skeleton h-24 rounded-[var(--radius-md)]"
              />
            ))}
          </div>
        ) : filteredPrds.length === 0 && prds.length > 0 ? (
          <Card className="glass-strong">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="mb-2 h-8 w-8 text-ink-faint" />
              <p className="text-sm text-ink-secondary">
                No briefs match &ldquo;{searchQuery}&rdquo;
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setSearchQuery("")}
              >
                Clear search
              </Button>
            </CardContent>
          </Card>
        ) : filteredPrds.length === 0 ? (
          <Card className="glass-strong">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-violet-light">
                <FileText className="h-7 w-7 text-violet" />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-[-0.025em] text-ink">
                No briefs yet
              </h3>
              <p className="mt-1 max-w-sm text-sm text-ink-secondary">
                Briefs are created automatically after meetings complete.
              </p>
              <Button variant="accent" className="glow mt-4" asChild>
                <Link href="/meetings">Go to Meetings</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {filteredPrds.map((prd) => (
              <li key={prd.id}>
                <Link href={`/prds/${prd.id}`} className="block">
                  <Card className="card-interactive cursor-pointer group">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-4">
                          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-violet-light text-violet">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">
                              {prd.title}
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs text-ink-secondary">
                              {prd.summary}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              <Badge
                                className={getConfidenceLabel(prd.confidence).color}
                                title={getConfidenceLabel(prd.confidence).description}
                              >
                                {getConfidenceLabel(prd.confidence).label}
                                <span className="ml-1 text-[10px] tabular opacity-60">
                                  {Math.round(prd.confidence * 100)}%
                                </span>
                              </Badge>
                              <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                                <Clock className="h-3 w-3" />
                                {timeAgo(prd.createdAt)}
                              </span>
                              {Array.isArray(prd.requirements) && (
                                <span className="text-xs text-ink-tertiary tabular">
                                  {prd.requirements.length} requirements
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {prd.googleDocUrl && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.preventDefault();
                                window.open(prd.googleDocUrl!, "_blank");
                              }}
                              aria-label="Open Google Doc"
                            >
                              <ExternalLink className="h-4 w-4 text-ink-faint" />
                            </Button>
                          )}
                          <StatusBadge status={prd.status} />
                          <ArrowRight className="h-4 w-4 text-ink-faint transition group-hover:text-ink-secondary" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
