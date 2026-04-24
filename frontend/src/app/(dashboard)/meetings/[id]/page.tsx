"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Header } from "@/components/header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Video,
  Clock,
  Users,
  FileText,
  MessageSquare,
  ExternalLink,
  Loader2,
  Sparkles,
  AlertCircle,
  Phone,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";

interface MeetingDetail {
  id: string;
  title: string;
  status: string;
  source?: string;
  meetingUrl: string;
  startTime: string;
  endTime?: string;
  participants: Array<{ name: string; email?: string; role: string }>;
}

interface Transcript {
  id: string;
  fullText: string;
  segments: Array<{ speaker: string; text: string; startTime: number; endTime: number }>;
  duration: number;
  wordCount: number;
}

export default function MeetingDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const toast = useToast();
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processingBrief, setProcessingBrief] = useState(false);

  useEffect(() => {
    async function load() {
      setLoadError(null);
      try {
        const [meetingRes, transcriptRes] = await Promise.allSettled([
          api.getMeeting(id),
          api.getTranscript(id),
        ]);

        if (meetingRes.status === "fulfilled" && meetingRes.value.data) {
          setMeeting(meetingRes.value.data as unknown as MeetingDetail);
        } else if (meetingRes.status === "rejected") {
          setLoadError("Unable to load meeting details. Please try again.");
        }
        if (transcriptRes.status === "fulfilled" && transcriptRes.value.data) {
          setTranscript(transcriptRes.value.data);
        }
      } catch {
        setLoadError("Something went wrong loading meeting data.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const [briefGenerated, setBriefGenerated] = useState(false);

  async function handleGenerateBrief() {
    setProcessingBrief(true);
    try {
      await api.generateBrief(id);
      toast.success("Brief generation started", "The AI agent is analyzing the transcript.");
      setBriefGenerated(true);
    } catch {
      toast.error("Failed to generate brief", "Something went wrong. Please try again.");
    } finally {
      setProcessingBrief(false);
    }
  }

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header />
        <div className="p-6 lg:p-8 max-w-5xl space-y-4">
          <div className="skeleton h-8 w-64" />
          <div className="skeleton h-48" />
          <div className="skeleton h-96" />
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="min-h-screen">
        <Header />
        <div className="p-6 lg:p-8 flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-surface-sunken flex items-center justify-center mb-4">
            {loadError ? (
              <AlertCircle className="w-6 h-6 text-rose" />
            ) : (
              <Video className="w-6 h-6 text-ink-faint" />
            )}
          </div>
          <h3 className="text-lg font-semibold text-ink mb-1">
            {loadError ? "Failed to load meeting" : "Meeting not found"}
          </h3>
          <p className="text-sm text-ink-tertiary mb-4 text-center max-w-sm">
            {loadError || "This meeting may have been deleted or you may not have access."}
          </p>
          <Button variant="outline" asChild>
            <Link href="/meetings">
              <ArrowLeft className="w-4 h-4" />
              Back to Meetings
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header />

      <div className="max-w-5xl space-y-6 p-6 lg:p-8">
        {/* Back button + title */}
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
            <Link href="/meetings">
              <ArrowLeft className="h-4 w-4" />
              Meetings
            </Link>
          </Button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-accent">
                  Meeting
                </span>
                <StatusBadge status={meeting.status} />
              </div>
              <h1 className="font-display text-3xl font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[2.25rem]">
                {meeting.title}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-tertiary">
                <span className="flex items-center gap-1 tabular">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTime(meeting.startTime)}
                </span>
                {meeting.participants?.length > 0 && (
                  <span className="flex items-center gap-1 tabular">
                    <Users className="h-3.5 w-3.5" />
                    {meeting.participants.length} participants
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              {briefGenerated ? (
                <Button variant="accent" className="glow" asChild>
                  <Link href="/prds">
                    <FileText className="h-4 w-4" />
                    View Briefs
                  </Link>
                </Button>
              ) : transcript && meeting.status === "completed" ? (
                <Button
                  variant="accent"
                  className="glow"
                  onClick={handleGenerateBrief}
                  disabled={processingBrief}
                >
                  {processingBrief ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate Brief
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Metadata cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-accent-subtle">
                <Clock className="h-4 w-4 text-accent" />
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-tertiary">
                  Duration
                </p>
                <p className="font-display text-lg font-semibold tabular text-ink">
                  {transcript ? formatDuration(transcript.duration) : "—"}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-violet-light">
                <MessageSquare className="h-4 w-4 text-violet" />
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-tertiary">
                  Words
                </p>
                <p className="font-display text-lg font-semibold tabular text-ink">
                  {transcript ? transcript.wordCount.toLocaleString() : "—"}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-emerald-light">
                <Users className="h-4 w-4 text-emerald" />
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-tertiary">
                  Participants
                </p>
                <p className="font-display text-lg font-semibold tabular text-ink">
                  {meeting.participants?.length ?? 0}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Voice AI status banner */}
        {meeting.source === "voice_dialin" && (
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-transparent border-gradient bg-violet-light px-4 py-3">
            <span className="dot-pulse" aria-hidden />
            <Phone className="h-4 w-4 text-violet" />
            <span className="text-sm font-medium text-violet">
              Voice AI is participating in this meeting
            </span>
          </div>
        )}

        {/* Transcript */}
        {transcript ? (
          <Card>
            <Tabs defaultValue="segments">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                    Transcript
                  </CardTitle>
                  <TabsList>
                    <TabsTrigger value="segments">By Speaker</TabsTrigger>
                    <TabsTrigger value="full">Full Text</TabsTrigger>
                  </TabsList>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <TabsContent value="segments" className="mt-0">
                  <div className="max-h-[600px] space-y-3 overflow-y-auto rounded-[var(--radius-md)] bg-surface-sunken/40 p-4 pr-2">
                    {transcript.segments.map((seg, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface text-xs font-semibold text-ink-secondary">
                          {seg.speaker.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex items-center gap-2">
                            <span className="text-sm font-medium text-ink">
                              {seg.speaker}
                            </span>
                            <span className="font-mono text-[11px] text-ink-tertiary tabular">
                              {Math.floor(seg.startTime / 60)}:
                              {String(Math.floor(seg.startTime % 60)).padStart(
                                2,
                                "0",
                              )}
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed text-ink-secondary">
                            {seg.text}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="full" className="mt-0">
                  <div className="max-h-[600px] overflow-y-auto rounded-[var(--radius-md)] bg-surface-sunken/40 p-4">
                    <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink-secondary">
                      {transcript.fullText}
                    </p>
                  </div>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        ) : meeting.status === "completed" ? (
          <Card className="glass-strong">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="mb-2 h-8 w-8 animate-spin text-accent" />
              <p className="text-sm font-medium text-ink">
                Transcript processing…
              </p>
              <p className="mt-1 text-xs text-ink-tertiary">
                This usually takes a few minutes after the meeting ends.
              </p>
              <Button variant="outline" size="sm" asChild className="mt-4">
                <Link href="/meetings">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Meetings
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
