import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timeAgo(date: string | Date): string {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}

export function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return "text-emerald";
  if (confidence >= 0.7) return "text-amber";
  return "text-rose";
}

export function confidenceBg(confidence: number): string {
  if (confidence >= 0.9) return "bg-emerald-light text-emerald";
  if (confidence >= 0.7) return "bg-amber-light text-amber";
  return "bg-rose-light text-rose";
}

export function getConfidenceLabel(score: number): { label: string; color: string; description: string } {
  if (score >= 0.85) return { label: 'Ready to Approve', color: 'text-emerald-600 bg-emerald-50', description: 'High confidence — the AI is confident in this output' };
  if (score >= 0.7) return { label: 'Review Recommended', color: 'text-amber-600 bg-amber-50', description: 'Moderate confidence — a quick review is suggested' };
  if (score >= 0.5) return { label: 'Needs Review', color: 'text-orange-600 bg-orange-50', description: 'Lower confidence — careful review recommended' };
  return { label: 'Needs Clarification', color: 'text-rose-600 bg-rose-50', description: 'Low confidence — the AI may need more information' };
}
