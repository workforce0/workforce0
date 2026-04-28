"use client";

/**
 * Header button to (re-)start the guided tour from the current page.
 *
 * Disabled when the current pathname has no tour steps registered —
 * this stays accurate as `tourSteps.ts` grows in Phase 2/3, no manual
 * gating needed here.
 */
import { useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { PlayCircle } from "lucide-react";
import { getUser } from "@/lib/auth";
import {
  getTourRouteOrder,
  hasStepsForRoute,
  normalizeTourPath,
  TOUR_KEY,
  TOUR_PAUSED_KEY,
  TOUR_START_EVENT,
} from "@/lib/tour/tourSteps";

export default function StartTourButton({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const user = getUser();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const routeOrder = useMemo(() => getTourRouteOrder(isAdmin), [isAdmin]);
  const currentIndex = routeOrder.indexOf(normalizeTourPath(pathname));
  const enabled = hasStepsForRoute(pathname) && currentIndex !== -1;

  const startTour = useCallback(() => {
    if (!enabled) return;
    localStorage.setItem(TOUR_KEY, "true");
    localStorage.removeItem(TOUR_PAUSED_KEY);
    window.dispatchEvent(new Event(TOUR_START_EVENT));
  }, [enabled]);

  return (
    <button
      data-tour="header-tour-button"
      onClick={startTour}
      disabled={!enabled}
      title={enabled ? "Start tour from this page" : "No tour for this page yet"}
      aria-label={enabled ? "Start tour from this page" : "No tour for this page yet"}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-ink-secondary hover:bg-surface-hover hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-secondary ${className}`}
    >
      <PlayCircle className="w-4 h-4" />
      <span className="hidden md:inline text-xs">Tour</span>
    </button>
  );
}
