"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  GitPullRequest,
  Mail,
  Phone,
  Users,
  FileText,
  MessageSquare,
  ChevronRight,
  Upload,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  HardwareCheck,
  type HardwareProfile,
} from "@/components/wizard/hardware-check";
import {
  LocalModelsToggle,
  type LocalTier,
} from "@/components/wizard/local-models-toggle";
import {
  MeetingCapturePicker,
  type MeetingBotChoice,
} from "@/components/wizard/meeting-capture-picker";
import {
  VoiceIntake,
  type VoiceIntakeConfig,
} from "@/components/wizard/voice-intake";

interface OnboardingWizardProps {
  onComplete: () => void;
  userName?: string;
}

// Plan 3 Step 0: 3 new screens (hardware, local models, meeting capture)
// inserted between Welcome and the existing 4 steps. Voice intake (Plan
// "voice-intake-pipecat") adds a 4th screen after meeting capture, so the
// total is 5 + 3 + 1 = 9.
const TOTAL_STEPS = 9;

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
    icon: GitPullRequest,
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
  const searchParams = useSearchParams();
  // `?step0=1` from the Step0MigrationBanner deep-links existing installs
  // straight into the hardware check (step 2), skipping the welcome screen.
  const [step, setStep] = useState(() => {
    const step0 = searchParams.get("step0");
    return step0 === "1" ? 2 : 1;
  });

  // Plan 3 Step 0 wizard state
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null);
  const [localTier, setLocalTier] = useState<LocalTier>("none");
  const [meetingBotProvider, setMeetingBotProvider] =
    useState<MeetingBotChoice>("vexa");
  const [vexaApiUrl, setVexaApiUrl] = useState<string>("");
  const [voiceIntake, setVoiceIntake] = useState<VoiceIntakeConfig>({
    enabled: false,
    twilioNumber: "",
    callerAllowlist: [],
    pin: undefined,
  });
  const [envHints, setEnvHints] = useState<Record<string, string> | null>(null);
  const [savingStep0, setSavingStep0] = useState(false);
  const [step0Error, setStep0Error] = useState<string | null>(null);

  // Stable callback for HardwareCheck so its useEffect doesn't loop on every
  // render of the parent.
  const handleHardwareDetected = useCallback((p: HardwareProfile) => {
    setHardwareProfile(p);
    // Default the local-tier choice to the recommendation when the user
    // hasn't picked one yet.
    setLocalTier((prev) => (prev === "none" ? p.recommendedTier : prev));
  }, []);

  async function saveStep0(): Promise<boolean> {
    setSavingStep0(true);
    setStep0Error(null);
    try {
      const res = await fetch("/api/setup/save-step0", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingBotProvider,
          vexaApiUrl:
            meetingBotProvider === "vexa" && vexaApiUrl ? vexaApiUrl : undefined,
          localTier,
          voiceIntake: voiceIntake.enabled ? voiceIntake : undefined,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: { envHints?: Record<string, string>; profiles?: string[] };
        error?: { message?: string };
      };
      if (!res.ok || !json.success) {
        setStep0Error(json.error?.message ?? "Could not save your setup choices.");
        return false;
      }
      setEnvHints(json.data?.envHints ?? {});
      return true;
    } catch (err) {
      setStep0Error((err as Error).message);
      return false;
    } finally {
      setSavingStep0(false);
    }
  }

  async function handleFinish() {
    // POST the wizard's Step 0 choices on completion. Failure is non-fatal:
    // we still advance to dashboard since the rest of the install is fine
    // and the migration banner will keep prompting.
    await saveStep0();
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

  function copyEnv() {
    if (!envHints) return;
    const text = Object.entries(envHints)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => toast.success("Copied .env keys to clipboard"),
        () => toast.error("Couldn't copy — select and copy manually."),
      );
    }
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
                  <BrandMark size={64} priority className="shadow-[0_0_32px_rgba(124,58,237,0.25)]" />
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

            {/* Step 2: Hardware check (Plan 3 Step 0) */}
            {step === 2 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-violet-light flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-violet" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-ink">Hardware check</h2>
                      <p className="text-sm text-ink-tertiary">
                        We&apos;ll size local AI for your machine.
                      </p>
                    </div>
                  </div>
                </div>

                <HardwareCheck onDetected={handleHardwareDetected} />

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

            {/* Step 3: Local models toggle (Plan 3 Step 0) */}
            {step === 3 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-ink">Local models</h2>
                      <p className="text-sm text-ink-tertiary">
                        Pick a tier or skip — BYOK keys also work.
                      </p>
                    </div>
                  </div>
                </div>

                <LocalModelsToggle
                  value={localTier}
                  onChange={setLocalTier}
                  recommended={hardwareProfile?.recommendedTier ?? "default"}
                />

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

            {/* Step 4: Meeting capture picker (Plan 3 Step 0) */}
            {step === 4 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center">
                      <Video className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-ink">Meeting capture</h2>
                      <p className="text-sm text-ink-tertiary">
                        Choose how the AI joins your meetings.
                      </p>
                    </div>
                  </div>
                </div>

                <MeetingCapturePicker
                  value={meetingBotProvider}
                  onChange={setMeetingBotProvider}
                  onVexaUrl={setVexaApiUrl}
                />

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

            {/* Step 5: Voice intake (Plan voice-intake-pipecat) */}
            {step === 5 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center">
                      <Phone className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-ink">Voice intake</h2>
                      <p className="text-sm text-ink-tertiary">
                        Optional inbound phone hotline via Twilio.
                      </p>
                    </div>
                  </div>
                </div>

                <VoiceIntake value={voiceIntake} onChange={setVoiceIntake} />

                <div className="flex items-center justify-between pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(4)}>
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button size="sm" onClick={() => setStep(6)}>
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 6: Connect meeting tools (was step 5 before voice intake) */}
            {step === 6 && (
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
                  <Button variant="ghost" size="sm" onClick={() => setStep(5)}>
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button size="sm" onClick={() => setStep(7)}>
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 7: How meetings work (was step 6 before voice intake) */}
            {step === 7 && (
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
                  <Button variant="ghost" size="sm" onClick={() => setStep(6)}>
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button size="sm" onClick={() => setStep(8)}>
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 8: Connect More Tools (was step 7 before voice intake) */}
            {step === 8 && (
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
                  <Button variant="ghost" size="sm" onClick={() => setStep(7)}>
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button size="sm" onClick={() => setStep(9)}>
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 9: All set (was step 8 before voice intake) */}
            {step === 9 && (
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

                {/* Plan 3 Step 0: env hints + apply guidance. Surfaced once
                    the wizard saves; the operator copies these into .env and
                    runs ./bin/setup-finish.sh on their host. */}
                {envHints && Object.keys(envHints).length > 0 && (
                  <div className="text-left bg-surface-sunken rounded-xl p-4 space-y-2">
                    <p className="text-sm font-medium text-ink-secondary">
                      Next: paste these into your <code>.env</code>:
                    </p>
                    <pre className="text-xs bg-canvas/50 p-3 rounded overflow-x-auto whitespace-pre-wrap break-all">
{Object.entries(envHints).map(([k, v]) => `${k}=${v}`).join("\n")}
                    </pre>
                    <Button size="sm" variant="ghost" onClick={copyEnv}>
                      Copy to clipboard
                    </Button>
                    <p className="text-xs text-ink-faint">
                      Then run{" "}
                      <code className="text-accent">./bin/setup-finish.sh</code>{" "}
                      to bring up the bundled services.
                    </p>
                  </div>
                )}

                {step0Error && (
                  <p className="text-xs text-rose">
                    Couldn&apos;t save Step 0: {step0Error} — you can configure later in Settings.
                  </p>
                )}

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
                <Button variant="accent" size="lg" className="w-full" onClick={handleFinish} disabled={savingStep0}>
                  {savingStep0 ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <>Go to Dashboard <ArrowRight className="w-4 h-4" /></>}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
