"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle,
  Circle,
  Video,
  Plug,
  FileText,
  ArrowRight,
  X,
} from "lucide-react";

export interface SetupState {
  hasIntegration: boolean;
  hasMeeting: boolean;
  hasPrd: boolean;
}

interface GettingStartedProps {
  setup: SetupState;
  onDismiss: () => void;
}

export function GettingStarted({ setup, onDismiss }: GettingStartedProps) {
  const steps = [
    {
      label: "Connect a meeting tool",
      description: "Connect Google Meet, upload recordings, or use voice dial-in",
      done: setup.hasIntegration,
      href: "/settings",
      icon: Plug,
    },
    {
      label: "Schedule your first meeting",
      description: "Paste a meeting link and AI handles the rest",
      done: setup.hasMeeting,
      href: "/meetings",
      icon: Video,
    },
    {
      label: "Review your first brief",
      description: "AI creates a product brief from the discussion",
      done: setup.hasPrd,
      href: "/prds",
      icon: FileText,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;
  if (allDone) return null;

  const progressPercent = (completedCount / steps.length) * 100;

  return (
    <Card className="animate-fade-in-up delay-3 overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-subtle flex items-center justify-center">
              <span className="text-sm font-bold text-accent">{completedCount}/{steps.length}</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">Getting Started</p>
              <p className="text-[11px] text-ink-tertiary mt-0.5">Complete these steps to get the most from your AI team</p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-lg hover:bg-ink/[0.04] text-ink-tertiary hover:text-ink-secondary transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <Progress value={progressPercent} className="mb-4" />

        <div className="space-y-1">
          {steps.map((step, i) => (
            <Link
              key={step.label}
              href={step.href}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group",
                step.done ? "opacity-50" : "hover:bg-ink/[0.02]"
              )}
            >
              {step.done ? (
                <CheckCircle className="w-5 h-5 text-emerald flex-shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-ink-faint flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-ink-tertiary">{i + 1}</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className={cn(
                  "text-sm font-medium",
                  step.done ? "text-ink-secondary line-through" : "text-ink"
                )}>
                  {step.label}
                </p>
                <p className="text-[12px] text-ink-tertiary">{step.description}</p>
              </div>
              {!step.done && (
                <ArrowRight className="w-4 h-4 text-ink-faint group-hover:text-ink-secondary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              )}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
