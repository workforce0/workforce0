"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  Loader2,
  CheckCircle,
  Key,
  Terminal,
  Wifi,
  Shield,
} from "lucide-react";

interface AgentSetupWizardProps {
  onAgentConnected: () => void;
}

type StepStatus = "pending" | "active" | "completed";

const MAX_POLLS = 60; // 5 minutes at 5s intervals

function StepIndicator({
  number,
  status,
}: {
  number: number;
  status: StepStatus;
}) {
  if (status === "completed") {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald text-white flex-shrink-0">
        <Check className="w-4 h-4" />
      </div>
    );
  }
  if (status === "active") {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent text-white flex-shrink-0">
        <span className="text-sm font-bold">{number}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-sunken text-ink-faint flex-shrink-0">
      <span className="text-sm font-medium">{number}</span>
    </div>
  );
}

async function copyToClipboard(text: string, onSuccess: () => void) {
  await navigator.clipboard.writeText(text);
  onSuccess();
}

export function AgentSetupWizard({ onAgentConnected }: AgentSetupWizardProps) {
  const toast = useToast();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [generatingToken, setGeneratingToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Step 2 state
  const [installMethod, setInstallMethod] = useState<"docker" | "npx">("docker");
  const [commandCopied, setCommandCopied] = useState(false);

  // Step 3 state
  const [pollCount, setPollCount] = useState(0);
  const [polling, setPolling] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    setPolling(true);
    setTimedOut(false);
    setPollCount(0);

    pollIntervalRef.current = setInterval(async () => {
      setPollCount((prev) => {
        const next = prev + 1;
        if (next >= MAX_POLLS) {
          stopPolling();
          setTimedOut(true);
        }
        return next;
      });

      try {
        const res = await api.getAgentStatus();
        if (res.data && res.data.connected > 0) {
          stopPolling();
          onAgentConnected();
        }
      } catch {
        // Silently continue polling on network errors
      }
    }, 5000);
  }, [stopPolling, onAgentConnected]);

  // Start polling when we reach step 3
  useEffect(() => {
    if (step === 3) {
      startPolling();
    }
    return () => {
      if (step !== 3) {
        stopPolling();
      }
    };
  }, [step, startPolling, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  async function handleGenerateToken() {
    setGeneratingToken(true);
    try {
      const res = await api.createAgentToken("Default Agent");
      if (res.data?.token) {
        setGeneratedToken(res.data.token);
      }
    } catch {
      toast.error("Failed to generate token", "Please try again.");
    } finally {
      setGeneratingToken(false);
    }
  }

  async function handleCopyToken() {
    if (!generatedToken) return;
    try {
      await copyToClipboard(generatedToken, () => {
        setTokenCopied(true);
        toast.success("Copied", "Token copied to clipboard");
        setTimeout(() => setTokenCopied(false), 2000);
      });
    } catch {
      toast.error("Copy failed", "Please copy the token manually.");
    }
  }

  async function handleCopyCommand() {
    const command =
      installMethod === "docker"
        ? `docker run -d --name workforce0-agent \\\n  -e WF0_TOKEN=${generatedToken ?? "{your-token}"} \\\n  -e WF0_SERVER=ws://localhost:8005/agent/ws \\\n  -v ~/code/myrepo:/workspace/myrepo \\\n  workforce0/agent --repos myorg/myrepo:/workspace/myrepo`
        : `export WF0_TOKEN=${generatedToken ?? "{your-token}"}\nnpx workforce0-agent --repos your-org/repo:/path/to/repo`;
    try {
      await copyToClipboard(command, () => {
        setCommandCopied(true);
        toast.success("Copied", "Command copied to clipboard");
        setTimeout(() => setCommandCopied(false), 2000);
      });
    } catch {
      toast.error("Copy failed", "Please copy the command manually.");
    }
  }

  function handleRestartPolling() {
    startPolling();
  }

  const stepStatus = (n: number): StepStatus => {
    if (n < step) return "completed";
    if (n === step) return "active";
    return "pending";
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {[
          { n: 1, label: "Generate Token", icon: Key },
          { n: 2, label: "Install Agent", icon: Terminal },
          { n: 3, label: "Connect", icon: Wifi },
        ].map((s, idx) => (
          <div key={s.n} className="flex items-center gap-2 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <StepIndicator number={s.n} status={stepStatus(s.n)} />
              <span
                className={`text-xs font-medium truncate ${
                  stepStatus(s.n) === "active"
                    ? "text-ink"
                    : stepStatus(s.n) === "completed"
                    ? "text-emerald"
                    : "text-ink-faint"
                }`}
              >
                {s.label}
              </span>
            </div>
            {idx < 2 && (
              <div className="flex-1 h-px bg-ink-faint/30 mx-1 min-w-[12px]" />
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">
          {/* ── Step 1: Generate Token ─────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center flex-shrink-0">
                  <Key className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-ink">Generate Agent Token</h2>
                  <p className="text-sm text-ink-tertiary">
                    Create a secure token for your AI agent
                  </p>
                </div>
              </div>

              {!generatedToken ? (
                <Button
                  variant="accent"
                  onClick={handleGenerateToken}
                  disabled={generatingToken}
                  className="w-full"
                >
                  {generatingToken ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4" />
                      Generate Token
                    </>
                  )}
                </Button>
              ) : (
                <div className="space-y-3">
                  {/* Token display */}
                  <div className="relative rounded-xl bg-[#0f1117] border border-ink/[0.12] p-4">
                    <p className="text-xs text-ink-faint mb-2 font-mono uppercase tracking-wider">
                      Agent Token
                    </p>
                    <p className="font-mono text-sm text-emerald break-all pr-8 leading-relaxed">
                      {generatedToken}
                    </p>
                    <button
                      onClick={handleCopyToken}
                      className="absolute top-3 right-3 flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10 transition-colors"
                      title="Copy token"
                    >
                      {tokenCopied ? (
                        <Check className="w-4 h-4 text-emerald" />
                      ) : (
                        <Copy className="w-4 h-4 text-ink-faint" />
                      )}
                    </button>
                  </div>

                  {/* Warning */}
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-amber/[0.08] border border-amber/30">
                    <span className="text-amber text-sm mt-0.5">⚠</span>
                    <p className="text-xs text-ink-secondary">
                      This token is shown once. Copy it before continuing.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end pt-2">
                <Button
                  size="sm"
                  onClick={() => setStep(2)}
                  disabled={!generatedToken}
                >
                  Next
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 2: Install Agent ──────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center flex-shrink-0">
                  <Terminal className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-ink">Install Agent on Your Machine</h2>
                  <p className="text-sm text-ink-tertiary">
                    Run this command on any machine with your code repo
                  </p>
                </div>
              </div>

              {/* Method toggle */}
              <div className="flex gap-1 p-1 rounded-lg bg-surface-sunken border border-ink/[0.08]">
                <button
                  onClick={() => { setInstallMethod("docker"); setCommandCopied(false); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    installMethod === "docker"
                      ? "bg-accent text-white shadow-sm"
                      : "text-ink-tertiary hover:text-ink"
                  }`}
                >
                  Docker
                  {installMethod === "docker" && (
                    <span className="text-[10px] font-normal opacity-80">recommended</span>
                  )}
                </button>
                <button
                  onClick={() => { setInstallMethod("npx"); setCommandCopied(false); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    installMethod === "npx"
                      ? "bg-accent text-white shadow-sm"
                      : "text-ink-tertiary hover:text-ink"
                  }`}
                >
                  npx
                  <span className={`text-[10px] font-normal ${installMethod === "npx" ? "opacity-80" : "opacity-60"}`}>advanced</span>
                </button>
              </div>

              {/* Command block */}
              <div className="relative rounded-xl bg-[#0f1117] border border-ink/[0.12] p-4">
                <p className="text-xs text-ink-faint mb-3 font-mono uppercase tracking-wider">
                  Terminal
                </p>
                {installMethod === "docker" ? (
                  <pre className="font-mono text-sm text-green-400 whitespace-pre-wrap break-all leading-relaxed pr-8">{`docker run -d --name workforce0-agent \\
  -e WF0_TOKEN=${generatedToken ?? "{your-token}"} \\
  -e WF0_SERVER=ws://localhost:8005/agent/ws \\
  -v ~/code/myrepo:/workspace/myrepo \\
  workforce0/agent --repos myorg/myrepo:/workspace/myrepo`}</pre>
                ) : (
                  <pre className="font-mono text-sm text-green-400 whitespace-pre-wrap break-all leading-relaxed pr-8">{`export WF0_TOKEN=${generatedToken ?? "{your-token}"}
npx workforce0-agent --repos your-org/repo:/path/to/repo`}</pre>
                )}
                <button
                  onClick={handleCopyCommand}
                  className="absolute top-3 right-3 flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10 transition-colors"
                  title="Copy command"
                >
                  {commandCopied ? (
                    <Check className="w-4 h-4 text-emerald" />
                  ) : (
                    <Copy className="w-4 h-4 text-ink-faint" />
                  )}
                </button>
              </div>

              {/* Security warning */}
              <div className="flex items-start gap-2 p-3 mt-3 bg-amber-50 border border-amber-200 rounded-lg">
                <Shield className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-700">
                  <p className="font-medium">Security Recommendation</p>
                  <p className="mt-1">Run the agent on a dedicated machine (a $5/month VPS or spare laptop) — not on a machine with personal credentials, SSH keys, or sensitive files. The agent only needs access to your code repository.</p>
                </div>
              </div>

              {/* Note */}
              <p className="text-xs text-ink-faint flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-surface-sunken text-[10px] font-bold text-ink-tertiary flex-shrink-0">
                  i
                </span>
                {installMethod === "docker"
                  ? "Requires Docker — no Node.js or Claude CLI needed on the host"
                  : "Requires Node.js 20+ and Claude CLI"}
              </p>

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </Button>
                <Button size="sm" onClick={() => setStep(3)}>
                  Next
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Waiting for Connection ────────────────────── */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center flex-shrink-0">
                  <Wifi className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-ink">Waiting for Agent...</h2>
                  <p className="text-sm text-ink-tertiary">
                    Listening for your agent to connect
                  </p>
                </div>
              </div>

              {!timedOut ? (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="relative flex items-center justify-center">
                    {/* Outer pulse ring */}
                    <span className="absolute w-16 h-16 rounded-full bg-accent/10 animate-ping" />
                    <div className="relative flex items-center justify-center w-12 h-12 rounded-full bg-accent/[0.08] border border-accent/20">
                      <Loader2 className="w-6 h-6 animate-spin text-accent" />
                    </div>
                  </div>
                  <p className="text-sm text-ink-tertiary text-center">
                    Your agent will appear here once it connects
                  </p>
                  {polling && pollCount > 0 && (
                    <p className="text-xs text-ink-faint">
                      Checking... ({pollCount}/{MAX_POLLS})
                    </p>
                  )}
                  <p className="text-xs text-ink-faint mt-2">
                    Tip: Use <code className="bg-ink/[0.06] px-1 rounded">--require-approval</code> flag to review each job before the agent executes it.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-surface-sunken border border-ink/[0.08]">
                      <Wifi className="w-6 h-6 text-ink-faint" />
                    </div>
                    <p className="text-sm text-ink-secondary text-center">
                      Agent not detected. Check your terminal for errors.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={handleRestartPolling}
                    >
                      Try Again
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1"
                      onClick={onAgentConnected}
                    >
                      Skip for now
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" size="sm" onClick={() => { stopPolling(); setStep(2); }}>
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </Button>
                {/* Spacer to keep Back left-aligned */}
                <div />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
