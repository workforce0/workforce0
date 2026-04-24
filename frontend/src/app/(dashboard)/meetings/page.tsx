"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useProjectScope } from "@/lib/use-project-scope";
import { useToast } from "@/components/ui/toast";
import { Header } from "@/components/header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Video,
  Plus,
  Search,
  Clock,
  Users,
  ArrowRight,
  Loader2,
  Calendar,
  AlertCircle,
  RefreshCw,
  Upload,
  Phone,
  FileText,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { UploadRecordingModal } from "@/components/upload-recording-modal";
import { UploadTranscriptModal } from "@/components/upload-transcript-modal";
import { VoiceDialInModal } from "@/components/voice-dialin-modal";

interface Meeting {
  id: string;
  title: string;
  status: string;
  source?: string; // 'upload' | 'google_meet' | 'voice_dialin'
  meetingUrl: string;
  startTime: string;
  endTime?: string;
  participants: unknown[];
  createdAt: string;
}

function getSourceIcon(source?: string) {
  switch (source) {
    case "upload":
      return Upload;
    case "google_meet":
      return Video;
    case "voice_dialin":
      return Phone;
    default:
      return Video;
  }
}

function getSourceLabel(source?: string): string {
  switch (source) {
    case "upload":
      return "Uploaded";
    case "google_meet":
      return "Google Meet";
    case "voice_dialin":
      return "Voice Dial-In";
    default:
      return "Meeting";
  }
}

export default function MeetingsPage() {
  const toast = useToast();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showVoiceDialIn, setShowVoiceDialIn] = useState(false);

  const loadMeetings = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.getMeetings({ limit: 50 });
      if (res.data) setMeetings(res.data);
    } catch {
      setError("Unable to load meetings. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);
  useProjectScope(loadMeetings);


  const filteredMeetings = searchQuery
    ? meetings.filter((m) => m.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : meetings;

  return (
    <div className="min-h-screen">
      <Header title="Meetings" />

      <div className="space-y-6 p-6 lg:p-8">
        {/* Actions bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative w-full max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input
              placeholder="Search meetings…"
              className="pl-9 pr-14"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
              <kbd className="kbd">⌘</kbd>
              <kbd className="kbd">K</kbd>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setShowVoiceDialIn(true)}>
              <Phone className="h-4 w-4" />
              Voice Dial-In
            </Button>
            <Button variant="outline" onClick={() => setShowTranscript(true)}>
              <FileText className="h-4 w-4" />
              Paste Transcript
            </Button>
            <Button
              variant="accent"
              className="glow"
              onClick={() => setShowUpload(true)}
            >
              <Plus className="h-4 w-4" />
              New Meeting
            </Button>
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
              onClick={loadMeetings}
              className="text-rose hover:bg-rose/10"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        )}

        {/* Meetings list */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="skeleton h-20 rounded-[var(--radius-md)]"
              />
            ))}
          </div>
        ) : filteredMeetings.length === 0 && meetings.length > 0 ? (
          <Card className="glass-strong">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="mb-2 h-8 w-8 text-ink-faint" />
              <p className="text-sm text-ink-secondary">
                No meetings match &ldquo;{searchQuery}&rdquo;
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
        ) : filteredMeetings.length === 0 ? (
          <Card className="glass-strong">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-accent-subtle">
                <Calendar className="h-7 w-7 text-accent" />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-[-0.025em] text-ink">
                No meetings yet
              </h3>
              <p className="mt-1 max-w-sm text-sm text-ink-secondary">
                Upload a recording, use voice dial-in, or connect Google Meet
                to get started. AI will transcribe and generate a brief
                automatically.
              </p>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" onClick={() => setShowVoiceDialIn(true)}>
                  <Phone className="h-4 w-4" />
                  Voice Dial-In
                </Button>
                <Button
                  variant="accent"
                  className="glow"
                  onClick={() => setShowUpload(true)}
                >
                  <Upload className="h-4 w-4" />
                  Upload Recording
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {filteredMeetings.map((meeting) => {
              const SourceIcon = getSourceIcon(meeting.source);
              const sourceLabel = getSourceLabel(meeting.source);
              return (
                <li key={meeting.id}>
                  <Link href={`/meetings/${meeting.id}`} className="block">
                    <Card className="card-interactive cursor-pointer group">
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-accent-subtle text-accent">
                            <SourceIcon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">
                              {meeting.title}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                                <Clock className="h-3 w-3" />
                                {formatDateTime(meeting.startTime)}
                              </span>
                              <span className="flex items-center gap-1 text-xs text-ink-tertiary tabular">
                                <Users className="h-3 w-3" />
                                {Array.isArray(meeting.participants)
                                  ? meeting.participants.length
                                  : 0}{" "}
                                participants
                              </span>
                              <span className="flex items-center gap-1 text-xs text-ink-tertiary">
                                <SourceIcon className="h-3 w-3" />
                                {sourceLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <StatusBadge status={meeting.status} />
                          <ArrowRight className="h-4 w-4 text-ink-faint transition group-hover:text-ink-secondary" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <UploadRecordingModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onSuccess={loadMeetings}
      />
      <UploadTranscriptModal
        open={showTranscript}
        onClose={() => setShowTranscript(false)}
        onSuccess={loadMeetings}
      />
      <VoiceDialInModal
        open={showVoiceDialIn}
        onClose={() => setShowVoiceDialIn(false)}
        onSuccess={loadMeetings}
      />
    </div>
  );
}
