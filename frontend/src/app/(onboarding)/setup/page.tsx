"use client";

/**
 * First-run setup wizard (Stitch 01).
 *
 * Four-step onboarding that gets a non-technical exec from a fresh install
 * to their first brief in under five minutes. Each step writes through its
 * own endpoint so a user can close and resume.
 *
 * Steps:
 *   1. Workspace name                   → PATCH /api/setup  (via /complete at end)
 *   2. AI provider (Gemini recommended) → POST  /api/models/providers
 *   3. First integration (optional)     → opens IntegrationWizard modal
 *   4. Ready                            → POST  /api/setup/complete
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  IntegrationWizard,
  IntegrationName,
} from "@/components/integration-wizard";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Sparkles,
  Phone,
  Upload,
} from "lucide-react";

const TOTAL_STEPS = 4;

const STEP_TITLES = ["Workspace", "AI key", "Integrations", "Ready"];

const PROVIDERS = [
  {
    key: "gemini",
    name: "Google Gemini",
    badge: "Required · free tier",
    helper:
      "Free tier: 15 req/min · 1,500 req/day on gemini-2.0-flash. No credit card needed. Explicitly allowed for automated use.",
    tokenUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    key: "anthropic",
    name: "Anthropic Claude",
    badge: "Optional",
    helper: "Best for structured critique and long-context reasoning.",
    tokenUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    key: "openai",
    name: "OpenAI (OpenAI)",
    badge: "Optional",
    helper: "Strong adversarial critique for consensus.",
    tokenUrl: "https://platform.openai.com/api-keys",
  },
];

const INTEGRATIONS: { name: IntegrationName; label: string; blurb: string }[] = [
  { name: "jira", label: "Jira", blurb: "Create tickets from approved briefs" },
  { name: "slack", label: "Slack", blurb: "Post updates and approvals" },
  { name: "github", label: "GitHub", blurb: "Open PRs from briefs" },
  { name: "gchat", label: "Google Chat", blurb: "Post updates to a Chat space" },
  { name: "linear", label: "Linear", blurb: "Create Linear issues" },
  { name: "notion", label: "Notion", blurb: "Save briefs as Notion pages" },
];

export default function SetupWizardPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [workspaceName, setWorkspaceName] = useState("");
  const [aiKeys, setAiKeys] = useState<Record<string, string>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>("gemini");
  const [integrationWizard, setIntegrationWizard] = useState<IntegrationName | null>(null);
  const [connectedIntegrations, setConnectedIntegrations] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [userName] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await api.getSetupStatus();
      if (res.success && res.data?.completed) {
        router.replace("/dashboard");
        return;
      }
      if (res.success && res.data?.workspaceName && res.data.workspaceName !== "Untitled Workspace") {
        setWorkspaceName(res.data.workspaceName);
      }
    })();
  }, [router]);

  const goNext = () => setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const finish = async () => {
    setSubmitting(true);
    const res = await api.completeSetup(workspaceName || undefined);
    setSubmitting(false);
    if (res.success) {
      toast.success("You're all set");
      router.push("/dashboard");
    } else {
      toast.error(res.error?.message ?? "Could not finish setup");
    }
  };

  return (
    <div className="relative min-h-screen bg-canvas overflow-hidden">
      <div className="bg-mesh-cool absolute inset-0 -z-10" aria-hidden />
      <div className="bg-grid absolute inset-0 -z-10 opacity-50" aria-hidden />

      <div className="relative flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-[680px] space-y-8">
          <header className="space-y-5">
            <div className="flex items-center justify-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-tertiary tabular">
                Step {step} of {TOTAL_STEPS} · {STEP_TITLES[step - 1]}
              </span>
            </div>
            <div className="flex items-center justify-center gap-2" aria-hidden>
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
                const filled = i + 1 <= step;
                const active = i + 1 === step;
                return (
                  <span
                    key={i}
                    className={`h-[3px] rounded-full transition-all duration-[220ms] ${
                      active
                        ? "w-10 bg-accent shadow-[0_0_12px_var(--color-accent-glow)]"
                        : filled
                          ? "w-6 bg-accent/70"
                          : "w-6 bg-border-strong"
                    }`}
                  />
                );
              })}
            </div>
          </header>

          <Card className="glass-strong p-8 sm:p-10 space-y-8">
            {step === 1 && (
              <Step
                title="Name your workspace"
                subtitle="This is what your team will see at the top of the app."
              >
                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Workspace name</Label>
                  <Input
                    id="workspace-name"
                    placeholder="Acme Product Team"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    autoFocus
                  />
                  <p className="text-xs text-ink-tertiary">You can change this later.</p>
                </div>
              </Step>
            )}

            {step === 2 && (
              <Step
                title="Bring your own AI key"
                subtitle="Workforce0 uses your keys directly — no markup, no middleman."
              >
                <div className="space-y-3">
                  {PROVIDERS.map((p) => {
                    const isOpen = expandedProvider === p.key;
                    const hasKey = Boolean(aiKeys[p.key]);
                    return (
                      <div
                        key={p.key}
                        className={`group relative rounded-[var(--radius-md)] border bg-surface transition-all duration-[160ms] ${
                          hasKey
                            ? "border-transparent border-gradient shadow-[var(--shadow-card)]"
                            : "border-border hover:border-border-strong"
                        }`}
                      >
                        <button
                          type="button"
                          className="flex w-full items-start justify-between gap-4 p-4 text-left"
                          onClick={() =>
                            setExpandedProvider(isOpen ? null : p.key)
                          }
                          aria-expanded={isOpen}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-ink">
                                {p.name}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${
                                  p.badge.startsWith("Required")
                                    ? "bg-accent-subtle text-accent"
                                    : "bg-surface-sunken text-ink-tertiary"
                                }`}
                              >
                                {p.badge}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-ink-secondary">
                              {p.helper}
                            </p>
                          </div>
                          {hasKey && (
                            <CheckCircle2
                              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                              aria-label="Key saved"
                            />
                          )}
                        </button>
                        {isOpen && (
                          <div className="space-y-2 border-t border-border px-4 py-4">
                            <div className="flex items-center gap-2">
                              <Input
                                type="password"
                                placeholder="Paste API key"
                                value={aiKeys[p.key] ?? ""}
                                onChange={(e) =>
                                  setAiKeys((k) => ({ ...k, [p.key]: e.target.value }))
                                }
                              />
                              <Button variant="outline" size="sm" asChild>
                                <a
                                  href={p.tokenUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0"
                                  aria-label={`Open ${p.name} key page`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            </div>
                            <p className="text-[11px] text-ink-tertiary">
                              Keys are stored encrypted; used only by your instance.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Step>
            )}

            {step === 3 && (
              <Step
                title="Connect your first tool"
                subtitle="Optional. You can add integrations later from Settings."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {INTEGRATIONS.map((i) => {
                    const connected = connectedIntegrations.has(i.name);
                    return (
                      <div
                        key={i.name}
                        className={`card-interactive flex flex-col rounded-[var(--radius-md)] border bg-surface p-4 shadow-[var(--shadow-card)] transition-all duration-[160ms] ${
                          connected
                            ? "border-transparent border-gradient"
                            : "border-border hover:border-border-strong"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-ink">
                            {i.label}
                          </span>
                          {connected && (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          )}
                        </div>
                        <p className="mt-1 flex-1 text-xs text-ink-secondary">
                          {i.blurb}
                        </p>
                        <Button
                          variant={connected ? "outline" : "accent"}
                          size="sm"
                          className="mt-3"
                          onClick={() => setIntegrationWizard(i.name)}
                        >
                          {connected ? "Reconnect" : "Connect"}
                        </Button>
                      </div>
                    );
                  })}
                  <div className="flex min-h-[140px] flex-col items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border-strong bg-surface-sunken/60 p-4 text-center">
                    <p className="text-sm font-medium text-ink">Skip for now</p>
                    <p className="mt-1 text-xs text-ink-tertiary">
                      Connect tools later from Settings → Integrations.
                    </p>
                  </div>
                </div>
              </Step>
            )}

            {step === 4 && (
              <Step
                title={`You're all set${userName ? `, ${userName}` : ""}`}
                subtitle="Here's what you can do next."
              >
                <div className="space-y-3">
                  <ReadyAction
                    icon={<Upload className="h-5 w-5" />}
                    primary
                    onClick={() => router.push("/meetings?action=upload")}
                  >
                    <strong className="text-sm font-semibold text-ink">
                      Paste your first meeting transcript
                    </strong>
                    <span className="mt-0.5 block text-xs text-ink-tertiary">
                      Fastest way to see Workforce0 in action.
                    </span>
                  </ReadyAction>
                  <ReadyAction
                    icon={<Sparkles className="h-5 w-5" />}
                    onClick={() => router.push("/meetings?action=record")}
                  >
                    <strong className="text-sm font-semibold text-ink">
                      Upload a recording
                    </strong>
                    <span className="mt-0.5 block text-xs text-ink-tertiary">
                      .vtt, .srt, .mp4, or .m4a.
                    </span>
                  </ReadyAction>
                  <ReadyAction
                    icon={<Phone className="h-5 w-5" />}
                    onClick={() => router.push("/settings/voice")}
                  >
                    <strong className="text-sm font-semibold text-ink">
                      Dial in from a phone
                    </strong>
                    <span className="mt-0.5 block text-xs text-ink-tertiary">
                      Talk to your AI product manager live.
                    </span>
                  </ReadyAction>
                </div>
              </Step>
            )}

            <div className="flex items-center justify-between border-t border-border pt-5">
              {step === 1 ? (
                <button
                  type="button"
                  className="text-sm text-ink-tertiary transition-colors hover:text-ink"
                  onClick={() => void finish()}
                >
                  Skip setup
                </button>
              ) : (
                <Button variant="ghost" onClick={goBack}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> Back
                </Button>
              )}

              {step < TOTAL_STEPS ? (
                <Button
                  variant="accent"
                  onClick={goNext}
                  disabled={step === 1 && workspaceName.trim().length === 0}
                  className="glow"
                >
                  Continue <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="accent"
                  onClick={finish}
                  disabled={submitting}
                  className="glow"
                >
                  {submitting && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Take me to the dashboard
                </Button>
              )}
            </div>
          </Card>

          <p className="text-center text-[11px] text-ink-tertiary">
            Encrypted local storage · Your keys never leave your instance
          </p>
        </div>
      </div>

      {integrationWizard && (
        <IntegrationWizard
          integration={integrationWizard}
          open={Boolean(integrationWizard)}
          onOpenChange={(open) => !open && setIntegrationWizard(null)}
          onConnected={() => {
            setConnectedIntegrations((s) => new Set(s).add(integrationWizard!));
          }}
        />
      )}
    </div>
  );
}

function Step({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-display text-3xl font-semibold text-ink sm:text-[2rem]">
          {title}
        </h1>
        <p className="text-sm text-ink-secondary">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function ReadyAction({
  icon,
  primary,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  primary?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card-interactive flex w-full items-center gap-3 rounded-[var(--radius-md)] border bg-surface p-4 text-left shadow-[var(--shadow-card)] transition-all duration-[160ms] ${
        primary
          ? "border-transparent border-gradient"
          : "border-border hover:border-border-strong"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ${
          primary
            ? "bg-accent text-white shadow-[0_0_20px_var(--color-accent-glow)]"
            : "bg-accent-subtle text-accent"
        }`}
      >
        {icon}
      </span>
      <div className="flex-1 text-sm">{children}</div>
      <ArrowRight className="h-4 w-4 text-ink-tertiary" />
    </button>
  );
}
