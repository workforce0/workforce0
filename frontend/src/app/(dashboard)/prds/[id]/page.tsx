"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Header } from "@/components/header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  FileText,
  CheckCircle,
  XCircle,
  Ticket,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Target,
  ListChecks,
  ShieldAlert,
  Clock,
  Sparkles,
  Brain,
  DollarSign,
  Timer,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Download,
} from "lucide-react";
import { cn, confidenceColor, formatDateTime, getConfidenceLabel } from "@/lib/utils";

interface PRDDetail {
  id: string;
  title: string;
  summary: string;
  status: string;
  confidence: number;
  objectives: string[];
  requirements: Array<{
    id: string;
    title: string;
    description: string;
    priority: string;
    type: string;
    acceptanceCriteria: string[];
  }>;
  acceptanceCriteria: string[];
  outOfScope: string[];
  assumptions: string[];
  risks: Array<{ description: string; impact: string; mitigation?: string }>;
  timeline?: string;
  googleDocUrl?: string;
  tickets: Array<{
    id: string;
    externalKey?: string;
    summary: string;
    priority: string;
    status: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

const priorityColors: Record<string, string> = {
  critical: "bg-rose-light text-rose",
  high: "bg-amber-light text-amber",
  medium: "bg-accent-subtle text-accent",
  low: "bg-surface-sunken text-ink-tertiary",
};

export default function PrdDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const toast = useToast();
  const [prd, setPrd] = useState<PRDDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [creatingTickets, setCreatingTickets] = useState(false);
  const [jiraProject, setJiraProject] = useState("");
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [activeTab, setActiveTab] = useState("requirements");
  const [downloading, setDownloading] = useState(false);
  const [council, setCouncil] = useState<{
    taskId: string;
    confidence: number;
    councilDecision: string | null;
    iterations: number;
    council: {
      votes: Array<{ model: string; vote: string; confidence: number; reasoning?: string; concerns?: string[] }>;
      critique: { assessment: string; confidence: number; issues: number; strengths: string[]; missingRisks: string[] } | null;
      consensusReached: boolean;
      outstandingIssues: string[];
      clarificationQuestions: string[];
      estimatedCost: { gemini: number; openai: number; total: number } | null;
      timing: { primaryGeneration: number; critique: number; consensus: number; revision: number; total: number } | null;
    } | null;
    completedAt: string | null;
    startedAt: string;
  } | null>(null);
  const [councilLoading, setCouncilLoading] = useState(false);
  const [councilLoaded, setCouncilLoaded] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPrd = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.getPrd(id);
      if (res.data) setPrd(res.data);
    } catch {
      setLoadError("Unable to load brief details. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadCouncil = useCallback(async () => {
    if (councilLoaded) return;
    setCouncilLoading(true);
    try {
      const res = await api.getPrdCouncil(id);
      if (res.data) setCouncil(res.data);
    } catch {
      // Council data may not exist — not an error
    } finally {
      setCouncilLoading(false);
      setCouncilLoaded(true);
    }
  }, [id, councilLoaded]);

  useEffect(() => {
    loadPrd();
  }, [loadPrd]);

  useEffect(() => {
    if (activeTab === "council") loadCouncil();
  }, [activeTab, loadCouncil]);

  // Eagerly load council data when a PRD needing review is loaded,
  // so open questions and council reasoning appear in the warning card.
  useEffect(() => {
    if (prd && (prd.status === "review" || prd.status === "pending_approval" || prd.status === "draft")) {
      loadCouncil();
    }
  }, [prd, loadCouncil]);

  async function handleApprove() {
    setApproving(true);
    try {
      await api.approvePrd(id);
      toast.success("Brief approved", "Create Jira tickets to start work on this brief.");
      await loadPrd();
      setShowTicketForm(true);
    } catch {
      toast.error("Failed to approve brief", "Something went wrong. Please try again.");
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    setRejecting(true);
    try {
      await api.rejectPrd(id, rejectReason);
      toast.warning("Brief rejected", "Schedule another meeting or review other briefs.");
      setShowRejectForm(false);
      await loadPrd();
    } catch {
      toast.error("Failed to reject brief", "Something went wrong. Please try again.");
    } finally {
      setRejecting(false);
    }
  }

  async function handleCreateTickets(e: React.FormEvent) {
    e.preventDefault();
    setCreatingTickets(true);
    try {
      await api.createTickets(id, jiraProject);
      toast.success("Tickets created", "Jira tickets have been created from the brief requirements.");
      setShowTicketForm(false);
      await loadPrd();
      setActiveTab("tickets");
    } catch {
      toast.error("Failed to create tickets", "Check your Jira integration settings and try again.");
    } finally {
      setCreatingTickets(false);
    }
  }

  async function handleDownload() {
    if (!prd) return;
    setDownloading(true);
    try {
      await api.downloadPrd(id, prd.title);
    } catch {
      toast.error("Download failed", "Could not download the brief. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  function generateOpenQuestions(prd: PRDDetail): string[] {
    const questions: string[] = [];

    const reqCount = Array.isArray(prd.requirements) ? prd.requirements.length : 0;
    if (reqCount < 5) {
      questions.push("The brief has few requirements. Was everything discussed in the meeting captured?");
    }

    if (!prd.outOfScope || (Array.isArray(prd.outOfScope) && prd.outOfScope.length === 0)) {
      questions.push("No out-of-scope items defined. What should explicitly NOT be included?");
    }

    if (!prd.assumptions || (Array.isArray(prd.assumptions) && prd.assumptions.length === 0)) {
      questions.push("No assumptions listed. What dependencies or prerequisites exist?");
    }

    const reqs = Array.isArray(prd.requirements) ? prd.requirements : [];
    const reqsWithoutCriteria = reqs.filter((r) => !r.acceptanceCriteria || r.acceptanceCriteria.length === 0);
    if (reqsWithoutCriteria.length > 0) {
      questions.push(`${reqsWithoutCriteria.length} requirement${reqsWithoutCriteria.length === 1 ? "" : "s"} lack specific acceptance criteria. How will completion be verified?`);
    }

    const title = (prd.title || "").toLowerCase();
    const summary = (prd.summary || "").toLowerCase();
    if (title.includes("auth") || title.includes("login") || summary.includes("security")) {
      if (!summary.includes("password") && !summary.includes("reset")) {
        questions.push("Authentication feature: Is a forgot/reset password flow needed?");
      }
      if (!summary.includes("signup") && !summary.includes("registration")) {
        questions.push("Authentication feature: How do new users register/sign up?");
      }
      if (!summary.includes("email verification")) {
        questions.push("Authentication feature: Is email verification required?");
      }
      if (!summary.includes("lockout")) {
        questions.push("Authentication feature: Should accounts lock after failed attempts?");
      }
    }

    if (prd.confidence && prd.confidence < 0.85) {
      questions.push("The AI had moderate confidence in this brief. A quick review of the requirements against the original meeting discussion is recommended.");
    }

    return questions;
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header />
        <div className="p-6 lg:p-8 max-w-5xl space-y-4">
          <div className="skeleton h-8 w-96" />
          <div className="skeleton h-48" />
          <div className="skeleton h-96" />
        </div>
      </div>
    );
  }

  if (!prd) {
    return (
      <div className="min-h-screen">
        <Header />
        <div className="p-6 lg:p-8 flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-surface-sunken flex items-center justify-center mb-4">
            {loadError ? (
              <AlertTriangle className="w-6 h-6 text-rose" />
            ) : (
              <FileText className="w-6 h-6 text-ink-faint" />
            )}
          </div>
          <h3 className="text-lg font-semibold text-ink mb-1">
            {loadError ? "Failed to load brief" : "Brief not found"}
          </h3>
          <p className="text-sm text-ink-tertiary mb-4 text-center max-w-sm">
            {loadError || "This brief may have been deleted or you may not have access."}
          </p>
          <Button variant="outline" asChild>
            <Link href="/prds">
              <ArrowLeft className="w-4 h-4" />
              Back to Briefs
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const needsReview = prd.status === "review" || prd.status === "pending_approval" || prd.status === "draft";
  const isApproved = prd.status === "approved";

  return (
    <div className="min-h-screen">
      <Header />

      <div className="max-w-5xl space-y-6 p-6 pb-28 lg:p-8 lg:pb-32">
        {/* Header */}
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
            <Link href="/prds">
              <ArrowLeft className="h-4 w-4" />
              Briefs
            </Link>
          </Button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-accent">
                  Brief
                </span>
                <StatusBadge status={prd.status} />
              </div>
              <h1 className="font-display text-3xl font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[2.25rem]">
                {prd.title}
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  className={getConfidenceLabel(prd.confidence).color}
                  title={getConfidenceLabel(prd.confidence).description}
                >
                  {getConfidenceLabel(prd.confidence).label}
                  <span className="ml-1 text-[10px] tabular opacity-60">
                    {Math.round(prd.confidence * 100)}%
                  </span>
                </Badge>
                <span className="flex items-center gap-1 text-sm text-ink-tertiary tabular">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTime(prd.createdAt)}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Download
              </Button>
              {prd.googleDocUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={prd.googleDocUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Google Docs
                  </a>
                </Button>
              )}
              {isApproved && (
                <Button
                  variant="accent"
                  size="sm"
                  className="glow"
                  onClick={() => setShowTicketForm(true)}
                >
                  <Ticket className="h-4 w-4" />
                  Create Jira Tickets
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Rejected banner with next steps */}
        {prd.status === "rejected" && (
          <div className="flex items-center gap-3 p-4 bg-rose-light rounded-xl animate-fade-in">
            <XCircle className="w-5 h-5 text-rose flex-shrink-0" />
            <p className="text-sm text-rose flex-1">This brief was rejected.</p>
            <Button variant="ghost" size="sm" className="text-rose hover:bg-rose/10" asChild>
              <Link href="/meetings">Schedule New Meeting</Link>
            </Button>
            <Button variant="ghost" size="sm" className="text-rose hover:bg-rose/10" asChild>
              <Link href="/prds">View Other Briefs</Link>
            </Button>
          </div>
        )}

        {/* Reject form */}
        {showRejectForm && (
          <Card className="animate-scale-in">
            <CardContent className="p-4">
              <div className="space-y-3">
                <p className="text-sm font-medium text-ink">Reject Brief</p>
                <Input
                  placeholder="Reason for rejection (optional)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" onClick={handleReject} disabled={rejecting}>
                    {rejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm Reject"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowRejectForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Create tickets form */}
        {showTicketForm && (
          <Card className="animate-scale-in">
            <CardContent className="p-4">
              <form onSubmit={handleCreateTickets} className="space-y-3">
                <p className="text-sm font-medium text-ink">Create Jira Tickets</p>
                <p className="text-xs text-ink-tertiary">
                  This will create {prd.requirements.length} tickets in your Jira project.
                </p>
                <Input
                  placeholder="Jira Project Key (e.g., PROJ)"
                  value={jiraProject}
                  onChange={(e) => setJiraProject(e.target.value.toUpperCase())}
                  required
                />
                <div className="flex gap-2">
                  <Button size="sm" type="submit" disabled={creatingTickets}>
                    {creatingTickets ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
                    Create {prd.requirements.length} Tickets
                  </Button>
                  <Button variant="outline" size="sm" type="button" onClick={() => setShowTicketForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Red Flags / Open Questions — shown when PRD needs review */}
        {needsReview && (() => {
          const openQuestions = generateOpenQuestions(prd);
          // Merge in council clarification questions (deduplicated)
          const councilQuestions = council?.council?.clarificationQuestions ?? [];
          const councilOutstanding = council?.council?.outstandingIssues ?? [];
          const allCouncilItems = [...councilOutstanding, ...councilQuestions].filter(Boolean);
          const allQuestions = [...openQuestions, ...allCouncilItems];
          // Only show if there is something to surface
          if (allQuestions.length === 0) return null;
          const confidencePct = Math.round(prd.confidence * 100);
          // Pick the most informative council vote reasoning to show (prefer critique/consensus model)
          const councilVotes = council?.council?.votes ?? [];
          const summaryVote = councilVotes.find(v => v.model.includes("consensus") || v.model.includes("critique"))
            ?? councilVotes[councilVotes.length - 1];
          const councilReasoning = summaryVote?.reasoning;
          return (
            <Card className="border-[color:var(--color-amber)]/25 bg-[color:var(--color-amber-light)]/40">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-amber)]" />
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold tracking-[-0.02em] text-ink">
                      Review recommended — open questions
                    </h3>
                    <p className="mt-1 text-sm text-ink-secondary">
                      The AI generated this brief with{" "}
                      <span className="font-semibold tabular">{confidencePct}%</span>{" "}
                      confidence. Consider these before approving:
                    </p>
                    <ul className="mt-3 space-y-2">
                      {allQuestions.map((q, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-ink-secondary">
                          <span className="mt-0.5 shrink-0 font-mono text-[var(--color-amber)]">
                            ?
                          </span>
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                    {councilReasoning && (
                      <div className="mt-4 rounded-[var(--radius-md)] border border-border bg-surface p-3">
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-ink-tertiary">
                          AI Council assessment
                        </p>
                        <p className="text-xs text-ink-secondary leading-relaxed">
                          {councilReasoning}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Confidence bar */}
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-tertiary">
              AI Confidence
            </span>
            <div className="flex items-center gap-2">
              <Badge className={getConfidenceLabel(prd.confidence).color}>
                {getConfidenceLabel(prd.confidence).label}
              </Badge>
              <span
                className={cn(
                  "font-display text-lg font-semibold tabular",
                  confidenceColor(prd.confidence),
                )}
              >
                {Math.round(prd.confidence * 100)}%
              </span>
            </div>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuenow={Math.round(prd.confidence * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-accent transition-all duration-[420ms]"
              style={{ width: `${Math.round(prd.confidence * 100)}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-ink-tertiary">
            {getConfidenceLabel(prd.confidence).description}
          </p>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-base font-semibold tracking-[-0.02em]">
              <Sparkles className="h-4 w-4 text-violet" />
              Executive Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-ink-secondary">{prd.summary}</p>
          </CardContent>
        </Card>

        {/* Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in-up delay-4">
          <TabsList>
            <TabsTrigger value="requirements">Requirements ({prd.requirements.length})</TabsTrigger>
            <TabsTrigger value="objectives">Objectives</TabsTrigger>
            <TabsTrigger value="risks">Risks ({prd.risks.length})</TabsTrigger>
            {prd.tickets.length > 0 && (
              <TabsTrigger value="tickets">Tickets ({prd.tickets.length})</TabsTrigger>
            )}
            <TabsTrigger value="council">
              <Brain className="w-3.5 h-3.5 mr-1" />
              AI Council
            </TabsTrigger>
          </TabsList>

          <TabsContent value="requirements" className="space-y-3">
            {prd.requirements.map((req, i) => (
              <Card key={req.id || i}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-ink-faint">{req.id}</span>
                        <Badge className={priorityColors[req.priority] || priorityColors.medium}>
                          {req.priority}
                        </Badge>
                        <Badge variant="default">{req.type}</Badge>
                      </div>
                      <p className="text-sm font-semibold text-ink">{req.title}</p>
                      <p className="text-sm text-ink-secondary mt-1">{req.description}</p>
                      {req.acceptanceCriteria.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-ink-tertiary mb-1">Acceptance Criteria:</p>
                          <ul className="space-y-1">
                            {req.acceptanceCriteria.map((ac, j) => (
                              <li key={j} className="flex items-start gap-2 text-xs text-ink-secondary">
                                <ListChecks className="w-3.5 h-3.5 text-emerald flex-shrink-0 mt-0.5" />
                                {ac}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="objectives">
            <Card>
              <CardContent className="p-4">
                {prd.objectives.length > 0 ? (
                  <ul className="space-y-2">
                    {prd.objectives.map((obj, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <Target className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-ink-secondary">{obj}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-tertiary">No objectives specified.</p>
                )}

                {prd.outOfScope.length > 0 && (
                  <>
                    <Separator className="my-4" />
                    <h4 className="text-sm font-medium text-ink-secondary mb-2">Out of Scope</h4>
                    <ul className="space-y-1">
                      {prd.outOfScope.map((item, i) => (
                        <li key={i} className="text-sm text-ink-tertiary flex items-start gap-2">
                          <XCircle className="w-3.5 h-3.5 text-ink-faint flex-shrink-0 mt-0.5" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {prd.assumptions.length > 0 && (
                  <>
                    <Separator className="my-4" />
                    <h4 className="text-sm font-medium text-ink-secondary mb-2">Assumptions</h4>
                    <ul className="space-y-1">
                      {prd.assumptions.map((item, i) => (
                        <li key={i} className="text-sm text-ink-tertiary">{item}</li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="risks" className="space-y-3">
            {prd.risks.map((risk, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className={cn(
                      "w-5 h-5 flex-shrink-0 mt-0.5",
                      risk.impact === "high" ? "text-rose" : risk.impact === "medium" ? "text-amber" : "text-ink-faint"
                    )} />
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={
                          risk.impact === "high" ? "bg-rose-light text-rose"
                          : risk.impact === "medium" ? "bg-amber-light text-amber"
                          : "bg-surface-sunken text-ink-tertiary"
                        }>
                          {risk.impact} impact
                        </Badge>
                      </div>
                      <p className="text-sm text-ink-secondary">{risk.description}</p>
                      {risk.mitigation && (
                        <p className="text-xs text-ink-tertiary mt-1">
                          <span className="font-medium">Mitigation:</span> {risk.mitigation}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {prd.tickets.length > 0 && (
            <TabsContent value="tickets" className="space-y-2">
              {prd.tickets.map((ticket) => (
                <Card key={ticket.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <Ticket className="w-4 h-4 text-accent" />
                      <div>
                        {ticket.externalKey && (
                          <span className="text-xs font-mono text-accent mr-2">{ticket.externalKey}</span>
                        )}
                        <span className="text-sm text-ink-secondary">{ticket.summary}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={priorityColors[ticket.priority.toLowerCase()] || ""}>{ticket.priority}</Badge>
                      <StatusBadge status={ticket.status} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          )}

          <TabsContent value="council" className="space-y-4">
            {councilLoading ? (
              <Card>
                <CardContent className="p-8 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-ink-faint mr-2" />
                  <span className="text-sm text-ink-tertiary">Loading council data…</span>
                </CardContent>
              </Card>
            ) : !council?.council ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Brain className="w-8 h-8 text-ink-faint mx-auto mb-2" />
                  <p className="text-sm text-ink-tertiary">No AI Council data available for this brief.</p>
                  <p className="text-xs text-ink-faint mt-1">Council data is generated during the AI review process.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Council Decision Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Brain className="w-4 h-4 text-violet" />
                      Council Decision
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Badge className={council.council.consensusReached ? "bg-emerald-light text-emerald" : "bg-amber-light text-amber"}>
                        {council.council.consensusReached ? "Consensus Reached" : "No Consensus"}
                      </Badge>
                      {council.councilDecision && (
                        <span className="text-sm text-ink-secondary capitalize">{council.councilDecision}</span>
                      )}
                    </div>
                    {council.council.outstandingIssues.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-ink-tertiary mb-1">Outstanding Issues</p>
                        <ul className="space-y-1">
                          {council.council.outstandingIssues.map((issue, i) => (
                            <li key={i} className="text-xs text-ink-secondary flex items-start gap-2">
                              <AlertTriangle className="w-3 h-3 text-amber flex-shrink-0 mt-0.5" />
                              {issue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Model Votes */}
                {council.council.votes.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Model Votes</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {council.council.votes.map((vote, i) => (
                        <div key={i} className="p-3 rounded-lg bg-surface-sunken">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-ink">{vote.model}</span>
                              <Badge className={
                                vote.vote === "approve" ? "bg-emerald-light text-emerald"
                                : vote.vote === "reject" ? "bg-rose-light text-rose"
                                : "bg-surface-sunken text-ink-tertiary"
                              }>
                                {vote.vote === "approve" ? <ThumbsUp className="w-3 h-3 mr-1" /> :
                                 vote.vote === "reject" ? <ThumbsDown className="w-3 h-3 mr-1" /> :
                                 <Minus className="w-3 h-3 mr-1" />}
                                {vote.vote}
                              </Badge>
                            </div>
                            <span className={cn("text-sm font-bold", confidenceColor(vote.confidence / 100))}>
                              {vote.confidence}%
                            </span>
                          </div>
                          {vote.reasoning && (
                            <p className="text-xs text-ink-secondary mb-1">{vote.reasoning}</p>
                          )}
                          {vote.concerns && vote.concerns.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-ink-faint mb-1">Concerns:</p>
                              <ul className="space-y-0.5">
                                {vote.concerns.map((c, j) => (
                                  <li key={j} className="text-xs text-ink-tertiary">• {c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Critique */}
                {council.council.critique && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">AI Critique</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-ink-secondary">{council.council.critique.assessment}</p>
                      <div className="flex items-center gap-3">
                        <Badge variant="default">Confidence: {council.council.critique.confidence}%</Badge>
                        <Badge className={council.council.critique.issues > 0 ? "bg-amber-light text-amber" : "bg-emerald-light text-emerald"}>
                          {council.council.critique.issues} issue{council.council.critique.issues !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                      {council.council.critique.strengths.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-ink-tertiary mb-1">Strengths</p>
                          <ul className="space-y-0.5">
                            {council.council.critique.strengths.map((s, i) => (
                              <li key={i} className="text-xs text-ink-secondary flex items-start gap-2">
                                <CheckCircle className="w-3 h-3 text-emerald flex-shrink-0 mt-0.5" />
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {council.council.critique.missingRisks.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-ink-tertiary mb-1">Missing Risks</p>
                          <ul className="space-y-0.5">
                            {council.council.critique.missingRisks.map((r, i) => (
                              <li key={i} className="text-xs text-ink-secondary flex items-start gap-2">
                                <ShieldAlert className="w-3 h-3 text-rose flex-shrink-0 mt-0.5" />
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Cost & Timing */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {council.council.estimatedCost && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-emerald" />
                          Cost Breakdown
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-ink-tertiary">Gemini</span>
                            <span className="text-ink font-mono">${council.council.estimatedCost.gemini.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-ink-tertiary">OpenAI</span>
                            <span className="text-ink font-mono">${council.council.estimatedCost.openai.toFixed(4)}</span>
                          </div>
                          <Separator />
                          <div className="flex justify-between text-xs font-medium">
                            <span className="text-ink-secondary">Total</span>
                            <span className="text-ink font-mono">${council.council.estimatedCost.total.toFixed(4)}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {council.council.timing && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Timer className="w-4 h-4 text-accent" />
                          Timing
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-ink-tertiary">Generation</span>
                            <span className="text-ink font-mono">{(council.council.timing.primaryGeneration / 1000).toFixed(1)}s</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-ink-tertiary">Critique</span>
                            <span className="text-ink font-mono">{(council.council.timing.critique / 1000).toFixed(1)}s</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-ink-tertiary">Consensus</span>
                            <span className="text-ink font-mono">{(council.council.timing.consensus / 1000).toFixed(1)}s</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-ink-tertiary">Revision</span>
                            <span className="text-ink font-mono">{(council.council.timing.revision / 1000).toFixed(1)}s</span>
                          </div>
                          <Separator />
                          <div className="flex justify-between text-xs font-medium">
                            <span className="text-ink-secondary">Total</span>
                            <span className="text-ink font-mono">{(council.council.timing.total / 1000).toFixed(1)}s</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {needsReview && (
        <div className="sticky bottom-0 z-20 -mx-6 mt-6 border-t border-border bg-surface/90 px-6 py-3 backdrop-blur-md lg:-mx-8 lg:px-8">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-ink-tertiary">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span>
                Confidence{" "}
                <span className="tabular font-semibold text-ink">
                  {Math.round(prd.confidence * 100)}%
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRejectForm(true)}
                disabled={rejecting}
              >
                <XCircle className="h-4 w-4" />
                Reject
              </Button>
              <Button
                variant="accent"
                size="sm"
                className="glow"
                onClick={handleApprove}
                disabled={approving}
              >
                {approving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                Approve brief
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
