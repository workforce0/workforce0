import { cn } from "@/lib/utils";
import { Card } from "./ui/card";
import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  className?: string;
  iconColor?: string;
  iconBg?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  className,
  iconColor = "text-accent",
  iconBg = "bg-accent-subtle",
}: StatCardProps) {
  return (
    <Card className={cn("relative overflow-hidden p-5 card-interactive group", className)}>
      {/* Subtle accent glow on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 w-48 h-48 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--color-accent-subtle), transparent 70%)" }}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-medium text-ink-tertiary uppercase tracking-[0.08em]">
            {title}
          </p>
          <p className="text-4xl font-semibold text-ink font-display tracking-[-0.03em] tabular animate-fade-in-up">
            {value}
          </p>
          {subtitle && <p className="text-[13px] text-ink-secondary">{subtitle}</p>}
        </div>
        <div
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-lg shrink-0 border border-border",
            iconBg,
          )}
        >
          <Icon className={cn("w-5 h-5", iconColor)} />
        </div>
      </div>

      {trend && (
        <div className="relative mt-4 pt-3 border-t border-border flex items-center gap-1.5 text-[13px]">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md font-medium tabular",
              trend.value >= 0
                ? "text-emerald bg-[var(--color-emerald-light)]"
                : "text-rose bg-[var(--color-rose-light)]",
            )}
          >
            {trend.value >= 0 ? "↗" : "↘"} {Math.abs(trend.value)}%
          </span>
          <span className="text-ink-tertiary">{trend.label}</span>
        </div>
      )}
    </Card>
  );
}
