"use client";

import { useState } from "react";
import { Phone, Loader2, Volume2, VolumeX, FileText, PhoneOff } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type VoiceMode = "silent" | "active" | "note_taker";
type CallStatus = "idle" | "connecting" | "in-call" | "ended";

interface VoiceDialInModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  meetingId?: string;
}

const modes: Array<{
  value: VoiceMode;
  label: string;
  description: string;
  icon: typeof Volume2;
}> = [
  {
    value: "silent",
    label: "Silent Observer",
    description: "AI listens and transcribes only",
    icon: VolumeX,
  },
  {
    value: "active",
    label: "Active Participant",
    description: "AI can ask clarifying questions",
    icon: Volume2,
  },
  {
    value: "note_taker",
    label: "Note Taker",
    description: "Captures key points and action items in real-time",
    icon: FileText,
  },
];

export function VoiceDialInModal({
  open,
  onClose,
  onSuccess,
  meetingId,
}: VoiceDialInModalProps) {
  const toast = useToast();
  const [dialInNumber, setDialInNumber] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [mode, setMode] = useState<VoiceMode>("silent");
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [activeCallSid, setActiveCallSid] = useState<string | null>(null);
  const [hangingUp, setHangingUp] = useState(false);

  const joining = callStatus === "connecting";

  function resetForm() {
    setDialInNumber("");
    setAccessCode("");
    setMode("silent");
    setCallStatus("idle");
    setActiveCallSid(null);
  }

  function handleClose() {
    if (callStatus !== "connecting") {
      resetForm();
      onClose();
    }
  }

  async function handleJoin() {
    if (!meetingId || !dialInNumber.trim()) return;

    setCallStatus("connecting");
    try {
      const res = await api.voiceJoinMeeting(meetingId, {
        dialInNumber: dialInNumber.trim(),
        accessCode: accessCode.trim() || undefined,
        mode: mode === "note_taker" ? "silent" : mode,
      });

      if (res.data?.callSid) {
        setActiveCallSid(res.data.callSid);
      }

      setCallStatus("in-call");

      const modeDescription =
        mode === "silent"
          ? "Listening and transcribing in the background"
          : mode === "active"
          ? "Ready to respond when directly addressed"
          : "Capturing key points and action items";

      toast.success("AI is joining the call", modeDescription);
      onSuccess();
    } catch (err) {
      setCallStatus("idle");
      const message =
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.";
      toast.error("Failed to join call", message);
    }
  }

  async function handleHangup() {
    if (!meetingId) return;

    setHangingUp(true);
    try {
      await api.voiceLeaveMeeting(meetingId);
      setCallStatus("ended");
      toast.success("Call ended", "The AI has left the meeting.");
      setTimeout(() => {
        resetForm();
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to end call.";
      toast.error("Hangup failed", message);
    } finally {
      setHangingUp(false);
    }
  }

  if (callStatus === "in-call" || callStatus === "ended") {
    return (
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className={cn("h-5 w-5", callStatus === "in-call" ? "text-emerald animate-pulse" : "text-ink-faint")} />
              {callStatus === "in-call" ? "AI is on the call" : "Call ended"}
            </DialogTitle>
            <DialogDescription>
              {callStatus === "in-call"
                ? `Mode: ${modes.find((m) => m.value === mode)?.label ?? mode} — AI is actively participating.`
                : "The AI has left the meeting. Transcript and notes will be processed shortly."}
            </DialogDescription>
          </DialogHeader>

          {callStatus === "in-call" && (
            <div className="flex items-center justify-center py-6">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-emerald-light flex items-center justify-center">
                  <Phone className="w-7 h-7 text-emerald animate-pulse" />
                </div>
                <p className="text-sm text-ink-tertiary">Connected to {dialInNumber}</p>
              </div>
            </div>
          )}

          <DialogFooter>
            {callStatus === "in-call" ? (
              <Button
                variant="destructive"
                onClick={handleHangup}
                disabled={hangingUp}
                className="w-full"
              >
                {hangingUp ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PhoneOff className="h-4 w-4" />
                )}
                Hang Up
              </Button>
            ) : (
              <Button variant="outline" onClick={handleClose} className="w-full">
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-accent" />
            Voice Dial-In
          </DialogTitle>
          <DialogDescription>
            Have the AI join your meeting by dialing in to the conference call.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Dial-in Number */}
          <div className="space-y-1.5">
            <label
              htmlFor="dial-in-number"
              className="text-sm font-medium text-ink"
            >
              Dial-in Number <span className="text-rose">*</span>
            </label>
            <Input
              id="dial-in-number"
              type="tel"
              placeholder="+1 (555) 123-4567"
              value={dialInNumber}
              onChange={(e) => setDialInNumber(e.target.value)}
              disabled={joining}
            />
          </div>

          {/* Access Code */}
          <div className="space-y-1.5">
            <label
              htmlFor="access-code"
              className="text-sm font-medium text-ink"
            >
              Access Code{" "}
              <span className="text-ink-tertiary font-normal">(optional)</span>
            </label>
            <Input
              id="access-code"
              type="text"
              placeholder="Meeting pin or access code"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              disabled={joining}
            />
          </div>

          {/* Mode Selection */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-ink">
              Participation Mode
            </span>
            <div className="grid grid-cols-3 gap-2">
              {modes.map((m) => {
                const Icon = m.icon;
                const selected = mode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    disabled={joining}
                    onClick={() => setMode(m.value)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-200 cursor-pointer",
                      selected
                        ? "border-accent bg-accent/[0.06] ring-1 ring-accent/20"
                        : "border-ink-faint/50 bg-surface hover:border-ink-faint hover:bg-surface-hover"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-5 w-5",
                        selected ? "text-accent" : "text-ink-tertiary"
                      )}
                    />
                    <div>
                      <p
                        className={cn(
                          "text-xs font-semibold",
                          selected ? "text-accent" : "text-ink"
                        )}
                      >
                        {m.label}
                      </p>
                      <p className="text-xs text-ink-tertiary mt-0.5 leading-snug">
                        {m.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={joining}
          >
            Cancel
          </Button>
          <Button
            variant="accent"
            onClick={handleJoin}
            disabled={joining || !dialInNumber.trim() || !meetingId}
          >
            {joining ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Phone className="h-4 w-4" />
                Join Call
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
