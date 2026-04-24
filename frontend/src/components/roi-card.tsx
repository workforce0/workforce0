"use client";

import { TrendingUp, Clock, FileText, CheckCircle2, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

interface ROIData {
  hoursSavedThisWeek: number;
  meetingsThisWeek: number;
  prdsThisWeek: number;
  approvalRate: number;
  weekOverWeekChange: number;
}

interface ROICardProps {
  data: ROIData;
}

export function ROICard({ data }: ROICardProps) {
  const hasActivity = data.meetingsThisWeek > 0 || data.hoursSavedThisWeek > 0;

  if (!hasActivity) {
    return (
      <Card className="relative overflow-hidden p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border-dashed">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink-tertiary">Time Saved This Week</p>
            <p className="text-3xl font-bold text-ink mt-1">0 hours</p>
            <p className="text-sm text-ink-faint mt-2">
              Schedule your first meeting to start saving time.
            </p>
          </div>
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-accent-subtle">
            <Clock className="w-7 h-7 text-accent" />
          </div>
        </div>
        <div className="mt-4">
          <Button size="sm" variant="default" asChild>
            <Link href="/meetings">
              Schedule a Meeting
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-[13px] font-medium text-ink-tertiary uppercase tracking-wide">
              Time Saved This Week
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-4xl font-bold text-ink tracking-tight">
                {data.hoursSavedThisWeek}
              </span>
              <span className="text-lg text-ink-secondary font-medium">hours</span>
            </div>
            {data.weekOverWeekChange !== 0 && (
              <div className="flex items-center gap-1.5 mt-2">
                <TrendingUp className={`w-4 h-4 ${data.weekOverWeekChange >= 0 ? "text-emerald" : "text-rose rotate-180"}`} />
                <span className={`text-sm font-semibold ${data.weekOverWeekChange >= 0 ? "text-emerald" : "text-rose"}`}>
                  {data.weekOverWeekChange >= 0 ? "+" : ""}{data.weekOverWeekChange}%
                </span>
                <span className="text-xs text-ink-faint">vs last week</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-accent-subtle">
            <Clock className="w-7 h-7 text-accent" />
          </div>
        </div>

        {/* Secondary metrics row */}
        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-ink/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-subtle">
              <Clock className="w-4 h-4 text-accent" />
            </div>
            <div>
              <p className="text-lg font-bold text-ink">{data.meetingsThisWeek}</p>
              <p className="text-[11px] text-ink-faint">Meetings</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-light">
              <FileText className="w-4 h-4 text-violet" />
            </div>
            <div>
              <p className="text-lg font-bold text-ink">{data.prdsThisWeek}</p>
              <p className="text-[11px] text-ink-faint">Briefs</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-light">
              <CheckCircle2 className="w-4 h-4 text-emerald" />
            </div>
            <div>
              <p className="text-lg font-bold text-ink">{data.approvalRate}%</p>
              <p className="text-[11px] text-ink-faint">Approved</p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
