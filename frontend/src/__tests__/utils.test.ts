import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cn,
  formatDate,
  formatDateTime,
  timeAgo,
  confidenceColor,
  confidenceBg,
  getConfidenceLabel,
} from "@/lib/utils";

// ─── cn (Tailwind class merger) ───────────────────────────────────────────────

describe("cn", () => {
  it("merges simple class strings", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });

  it("resolves conflicting Tailwind classes (last wins)", () => {
    const result = cn("px-4", "px-8");
    expect(result).toBe("px-8");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("handles undefined and null inputs", () => {
    expect(cn("a", undefined, null, "b")).toBe("a b");
  });

  it("handles empty string", () => {
    expect(cn("")).toBe("");
  });

  it("handles arrays of classes", () => {
    expect(cn(["px-2", "py-2"])).toBe("px-2 py-2");
  });

  it("deduplicates Tailwind text-color classes", () => {
    const result = cn("text-red-500", "text-blue-500");
    expect(result).toBe("text-blue-500");
  });
});

// ─── getConfidenceLabel ───────────────────────────────────────────────────────

describe("getConfidenceLabel", () => {
  // Tier 1: >= 0.85 => "Ready to Approve"
  it("returns 'Ready to Approve' for score >= 0.85", () => {
    const result = getConfidenceLabel(0.95);
    expect(result.label).toBe("Ready to Approve");
    expect(result.color).toContain("emerald");
    expect(result.description).toContain("High confidence");
  });

  it("returns 'Ready to Approve' at exactly 0.85 (boundary)", () => {
    const result = getConfidenceLabel(0.85);
    expect(result.label).toBe("Ready to Approve");
  });

  it("returns 'Ready to Approve' for score of 1.0", () => {
    const result = getConfidenceLabel(1.0);
    expect(result.label).toBe("Ready to Approve");
  });

  // Tier 2: >= 0.7 => "Review Recommended"
  it("returns 'Review Recommended' for score >= 0.7 and < 0.85", () => {
    const result = getConfidenceLabel(0.75);
    expect(result.label).toBe("Review Recommended");
    expect(result.color).toContain("amber");
    expect(result.description).toContain("Moderate confidence");
  });

  it("returns 'Review Recommended' at exactly 0.7 (boundary)", () => {
    const result = getConfidenceLabel(0.7);
    expect(result.label).toBe("Review Recommended");
  });

  it("returns 'Review Recommended' at 0.849 (just below tier 1)", () => {
    const result = getConfidenceLabel(0.849);
    expect(result.label).toBe("Review Recommended");
  });

  // Tier 3: >= 0.5 => "Needs Review"
  it("returns 'Needs Review' for score >= 0.5 and < 0.7", () => {
    const result = getConfidenceLabel(0.6);
    expect(result.label).toBe("Needs Review");
    expect(result.color).toContain("orange");
    expect(result.description).toContain("Lower confidence");
  });

  it("returns 'Needs Review' at exactly 0.5 (boundary)", () => {
    const result = getConfidenceLabel(0.5);
    expect(result.label).toBe("Needs Review");
  });

  it("returns 'Needs Review' at 0.699 (just below tier 2)", () => {
    const result = getConfidenceLabel(0.699);
    expect(result.label).toBe("Needs Review");
  });

  // Tier 4: < 0.5 => "Needs Clarification"
  it("returns 'Needs Clarification' for score < 0.5", () => {
    const result = getConfidenceLabel(0.3);
    expect(result.label).toBe("Needs Clarification");
    expect(result.color).toContain("rose");
    expect(result.description).toContain("Low confidence");
  });

  it("returns 'Needs Clarification' at 0.499 (just below tier 3)", () => {
    const result = getConfidenceLabel(0.499);
    expect(result.label).toBe("Needs Clarification");
  });

  it("returns 'Needs Clarification' for score of 0", () => {
    const result = getConfidenceLabel(0);
    expect(result.label).toBe("Needs Clarification");
  });
});

// ─── confidenceColor ──────────────────────────────────────────────────────────

describe("confidenceColor", () => {
  it("returns emerald for confidence >= 0.9", () => {
    expect(confidenceColor(0.95)).toBe("text-emerald");
    expect(confidenceColor(0.9)).toBe("text-emerald");
    expect(confidenceColor(1.0)).toBe("text-emerald");
  });

  it("returns amber for confidence >= 0.7 and < 0.9", () => {
    expect(confidenceColor(0.7)).toBe("text-amber");
    expect(confidenceColor(0.8)).toBe("text-amber");
    expect(confidenceColor(0.89)).toBe("text-amber");
  });

  it("returns rose for confidence < 0.7", () => {
    expect(confidenceColor(0.69)).toBe("text-rose");
    expect(confidenceColor(0.5)).toBe("text-rose");
    expect(confidenceColor(0)).toBe("text-rose");
  });
});

// ─── confidenceBg ─────────────────────────────────────────────────────────────

describe("confidenceBg", () => {
  it("returns emerald classes for confidence >= 0.9", () => {
    const result = confidenceBg(0.95);
    expect(result).toContain("bg-emerald-light");
    expect(result).toContain("text-emerald");
  });

  it("returns amber classes for confidence >= 0.7 and < 0.9", () => {
    const result = confidenceBg(0.75);
    expect(result).toContain("bg-amber-light");
    expect(result).toContain("text-amber");
  });

  it("returns rose classes for confidence < 0.7", () => {
    const result = confidenceBg(0.5);
    expect(result).toContain("bg-rose-light");
    expect(result).toContain("text-rose");
  });

  it("returns rose at boundary 0.7 (should be amber)", () => {
    // 0.7 >= 0.7, so it should be amber
    const result = confidenceBg(0.7);
    expect(result).toContain("bg-amber-light");
  });

  it("returns emerald at boundary 0.9", () => {
    const result = confidenceBg(0.9);
    expect(result).toContain("bg-emerald-light");
  });
});

// ─── formatDate ───────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats an ISO date string", () => {
    const result = formatDate("2026-03-11T10:00:00Z");
    // Should produce something like "Mar 11, 2026"
    expect(result).toMatch(/Mar\s+11,?\s+2026/);
  });

  it("formats a Date object", () => {
    const result = formatDate(new Date("2025-12-25T00:00:00Z"));
    expect(result).toMatch(/Dec\s+2[45],?\s+2025/);
  });

  it("handles beginning of year", () => {
    const result = formatDate("2026-01-01T00:00:00Z");
    expect(result).toMatch(/Jan\s+1,?\s+2026|Dec\s+31,?\s+2025/);
  });
});

// ─── formatDateTime ───────────────────────────────────────────────────────────

describe("formatDateTime", () => {
  it("includes time components", () => {
    const result = formatDateTime("2026-03-11T14:30:00Z");
    // Should include date parts and time (hour:minute)
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/2026/);
    // Should contain a colon for the time portion (e.g., "2:30" or "14:30")
    expect(result).toContain(":");
  });

  it("formats a Date object with time", () => {
    const result = formatDateTime(new Date("2026-06-15T09:05:00Z"));
    expect(result).toMatch(/Jun/);
    expect(result).toContain(":");
  });
});

// ─── timeAgo ──────────────────────────────────────────────────────────────────

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a time less than 1 minute ago", () => {
    expect(timeAgo("2026-03-11T11:59:30Z")).toBe("just now");
  });

  it("returns minutes ago for < 60 minutes", () => {
    expect(timeAgo("2026-03-11T11:55:00Z")).toBe("5m ago");
    expect(timeAgo("2026-03-11T11:30:00Z")).toBe("30m ago");
  });

  it("returns hours ago for < 24 hours", () => {
    expect(timeAgo("2026-03-11T10:00:00Z")).toBe("2h ago");
    expect(timeAgo("2026-03-11T00:00:00Z")).toBe("12h ago");
  });

  it("returns days ago for < 7 days", () => {
    expect(timeAgo("2026-03-10T12:00:00Z")).toBe("1d ago");
    expect(timeAgo("2026-03-05T12:00:00Z")).toBe("6d ago");
  });

  it("returns formatted date for >= 7 days", () => {
    const result = timeAgo("2026-02-01T12:00:00Z");
    // Should fall back to formatDate which produces e.g. "Feb 1, 2026"
    expect(result).toMatch(/Feb/);
    expect(result).toMatch(/2026/);
  });

  it("returns '1m ago' at exactly 1 minute", () => {
    expect(timeAgo("2026-03-11T11:59:00Z")).toBe("1m ago");
  });

  it("returns '1h ago' at exactly 60 minutes", () => {
    expect(timeAgo("2026-03-11T11:00:00Z")).toBe("1h ago");
  });

  it("handles Date object input", () => {
    expect(timeAgo(new Date("2026-03-11T11:50:00Z"))).toBe("10m ago");
  });
});
