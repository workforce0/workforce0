"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  Sparkles,
  Video,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  Loader2,
  CheckCircle,
  Rocket,
  HelpCircle,
  Hash,
  Ticket,
  Github,
  Mail,
  Phone,
  Users,
  FileText,
  MessageSquare,
  ChevronRight,
  Upload,
} from "lucide-react";

interface OnboardingWizardProps {
  onComplete: () => void;
  userName?: string;
}

const TOTAL_STEPS = 5;

interface ToolCard {
  name: string;
  icon: typeof Video;
  badge: "Essential" | "Recommended" | "Optional";
  badgeColor: string;
  value: string;
  settingsKey: string;
}

const TOOL_CARDS: ToolCard[] = [
  {
    name: "Upload Recordings",
    icon: Upload,
    badge: "Essential",
    badgeColor: "bg-emerald-light text-emerald",
    value: "Upload meeting recordings for AI-powered transcription",
    settingsKey: "upload",
  },
  {
    name: "Google Meet",
    icon: Video,
    badge: "Recommended",
    badgeColor: "bg-violet-light text-violet",
    value: "Auto-detect recordings from your Google Meet calls",
    settingsKey: "google-meet",
  },
  {
    name: "Jira",
    icon: Ticket,
    badge: "Recommended",
    badgeColor: "bg-violet-light text-violet",
    value: "Auto-create tickets from approved product briefs",
    settingsKey: "jira",
  },
  {
    name: "Slack",
    icon: Hash,
    badge: "Recommended",
    badgeColor: "bg-violet-light text-violet",
    value: "Get real-time updates from your AI team in Slack",
    settingsKey: "slack",
  },
  {
    name: "GitHub",
    icon: Github,
    badge: "Recommended",
    badgeColor: "bg-violet-light text-violet",
    value: "AI dev agent creates pull requests in your repo",
    settingsKey: "github",
  },
  {
    name: "Google Chat",
    icon: MessageSquare,
    badge: "Optional",
    badgeColor: "bg-surface-sunken text-ink-tertiary",
    value: "Alternative to Slack for team notifications",
    settingsKey: "gchat",
  },
  {
    name: "Google Docs",
    icon: FileText,
    badge: "Optional",
    badgeColor: "bg-surface-sunken text-ink-tertiary",
    value: "Save product briefs to Drive for easy sharing",
    settingsKey: "gdocs",
  },
  {
    name: "SendGrid",
    icon: Mail,
    badge: "Optional",
    badgeColor: "bg-surface-sunken text-ink-tertiary",
    value: "Email notifications and status reports",
    settingsKey: "sendgrid",
  },
  {
    name: "Twilio",
    icon: Phone,
    badge: "Optional",
    badgeColor: "bg-surface-sunken text-ink-tertiary",
    value: "SMS and WhatsApp messages from your AI team",
    settingsKey: "twilio",
  },
  {
    name: "Microsoft Teams",
    icon: Users,
    badge: "Optional",
    badgeColor: "bg-surface-sunken text-ink-tertiary",
    value: "Get updates in your Teams channels",
    settingsKey: "teams",
  },
];

export function OnboardingWizard({ onComplete, userName }: OnboardingWizardProps) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(1);


  function handleFinish() {
    if (typeof window !== "undefined") {
      localStorage.setItem("wf0_onboarding_complete", "true");
    }
    onComplete();
    router.push("/dashboard");
  }

  function handleSkipSetup() {
    if (typeof window !== "undefined") {
      localStorage.setItem("wf0_onboarding_complete", "true");
    }
    onComplete();
  }

  const progressPercent = (step / TOTAL_STEPS) * 100;

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-xl animate-fade-in-up">
        {/* Progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-ink-tertiary">Step {step} of {TOTAL_STEPS}</span>
            <button
              onClick={handleSkipSetup}
              className="text-xs text-ink-faint hover:text-ink-secondary transition-colors"
            >
              Skip setup
            </button>
          </div>
          <Progress value={progressPercent} />
        </div>

        <Card>
          <CardContent className="p-8">
            {/* Step 1: Welcome */}
            {step === 1 && (
              <div className="text-center space-y-6 animate-fade-in">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-amber flex items-center justify-center shadow-[0_0_32px_rgba(194,113,12,0.2)]">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-ink">
                    Welcome{userName ? `, ${userName}` : ""}!
                  </h2>
                  <p className="text-ink-tertiary mt-2 max-w-sm mx-auto">
                    Let&apos;s set up your AI team. This takes about 2 minutes.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-4 pt-2">
                  {[
                    { icon: Video, label: "Connect meeting tool", bg: "bg-accent-subtle", color: "text-accent" },
                    { icon: Sparkles, label: "AI creates briefs", bg: "bg-violet-light", color: "text-violet" },
                    { icon: Rocket, label: "Ship faster", bg: "bg-emerald-light", color: "text-emerald" },
                  ].map((item) => (
                    <div key={item.label} className="text-center">
                      <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center mx-auto mb-2`}>
                        <item.icon className={`w-5 h-5 ${item.color}`} />
                      </div>
                      <p className="text-xs text-ink-tertiary">{item.label}</p>
                    </div>
                  ))}
                </div>
                <Button variant="accent" size="lg" className="w-full" onClick={() => setStep(2)}>
                  Get Started
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Step 2: Connect meeting tools */}
            {step === 2 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center">
                      <Video className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-ink">How to get meetings in</h2>
                      <p className="text-sm text-ink-tertiary">Three ways to feed meetings to your AI team</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {[
                    { icon: Video, label: "Google Meet", desc: "Connect Google account to auto-detect recordings" },
                    { icon: Upload, label: "Upload Recording", desc: "Upload any audio/video file for transcription" },
                    { icon: Phone, label: "Voice Dial-In", desc: "AI dials into your call via Twilio" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-3 p-3 rounded-xl border border-border">
                      <div className="w-9 h-9 rounded-lg bg-surface-sunken flex items-center justify-center flex-shrink-0">
                        <item.icon className="w-4 h-4 text-ink-secondary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-ink">{item.label}</span>
                        <p className="text-xs text-ink-tertiary">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-ink-faint">
                  You can set these up now in{" "}
                  <button onClick={() => { handleSkipSetup(); router.push("/settings"); }} className="text-accent underline hover:opacity-80">
                    Settings
                  </button>{" "}
                  or continue and do it later.
                </p>

                <div className="flex items-center justify-between pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button size="sm" onClick={() => setStep(3)}>
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: How meetings work */}
            {step === 3 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-violet-light flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-violet" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-ink">How meetings work</h2>
                      <p className="text-sm text-ink-tertiary">Three ways to get meeting intelligence</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-4 rounded-xl border border-ink/[0.08]">
                    <Upload className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-ink">Upload a recording</p>
                      <p className="text-xs text-ink-tertiary">Upload audio or video files from any meeting platform</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 rounded-xl border border-ink/[0.08]">
                    <Phone className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-ink">Voice dial-in</p>
                      <p className="text-xs text-ink-tertiary">AI joins your call via phone and participates in real-time</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 rounded-xl border border-ink/[0.08]">
                    <Video className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-ink">Google Meet</p>
                      <p className="text-xs text-ink-tertiary">Connect Google Meet in Settings to auto-detect recordings</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button size="sm" onClick={() => setStep(4)}>
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 4: Connect More Tools */}
            {step === 4 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-ink">Supercharge your AI team</h2>
                      <p className="text-sm text-ink-tertiary">Connect more tools to unlock the full workflow</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {TOOL_CARDS.map((tool) => (
                    <button
                      key={tool.name}
                      onClick={() => {
                        handleSkipSetup();
                        router.push("/settings");
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-accent/40 hover:bg-surface-raised transition-all text-left group"
                    >
                      <div className="w-9 h-9 rounded-lg bg-surface-sunken flex items-center justify-center flex-shrink-0">
                        <tool.icon className="w-4 h-4 text-ink-secondary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink">{tool.name}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${tool.badgeColor}`}>
                            {tool.badge}
                          </span>
                        </div>
                        <p className="text-xs text-ink-tertiary truncate">{tool.value}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-accent transition-colors flex-shrink-0" />
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(3)}>
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button size="sm" onClick={() => setStep(5)}>
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 5: All set */}
            {step === 5 && (
              <div className="text-center space-y-6 animate-fade-in">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-light flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-emerald" />
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-ink">You&apos;re all set!</h2>
                  <p className="text-ink-tertiary mt-2 max-w-sm mx-auto">
                    Your AI team is ready. After your meeting, we&apos;ll automatically create a product brief for you to review.
                  </p>
                </div>
                <div className="space-y-2 text-left bg-surface-sunken rounded-xl p-4">
                  <p className="text-sm font-medium text-ink-secondary mb-3">What happens next:</p>
                  {[
                    "AI assistant joins your meeting and takes notes",
                    "A product brief is created from the discussion",
                    "You review, approve, and tasks are sent to Jira",
                  ].map((text, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-ink text-ink-inverse flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {i + 1}
                      </div>
                      <p className="text-sm text-ink-secondary">{text}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-ink-faint">
                  You can always connect more tools from{" "}
                  <button onClick={() => { handleFinish(); router.push("/settings"); }} className="text-accent underline hover:opacity-80">
                    Settings
                  </button>
                </p>
                <Button variant="accent" size="lg" className="w-full" onClick={handleFinish}>
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
