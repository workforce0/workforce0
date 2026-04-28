"use client";

/**
 * Guided tour orchestrator. Mounted once in the dashboard layout.
 *
 * Behavior
 * ────────
 * - First sign-in (no `hasSeenTour` server flag, no localStorage seen
 *   marker) → auto-starts the tour and pushes the user to the first
 *   route in TOUR_ROUTE_ORDER.
 * - Per-route step list driven via driver.js. When a route's steps
 *   complete, advances to the next route automatically.
 * - User can pause via the "Explore on your own" button (injected as
 *   HTML in step descriptions). A floating banner offers Resume / End.
 * - "End Tour" or finishing the last route's last step calls
 *   `api.markTourSeen()` so the auto-tour doesn't re-trigger on the
 *   next session.
 *
 * Adapted from aether2.0's `components/tour/GuidedTour.tsx`. Auth API
 * differs: aether uses `getStoredUser()`, workforce0 uses `getUser()`.
 */
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { driver, DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import "@/lib/tour/driver.css";
import { getUser } from "@/lib/auth";
import { api } from "@/lib/api";
import {
  getStepsForRoute,
  getTourRouteOrder,
  normalizeTourPath,
  ROUTE_LABELS,
  TOUR_KEY,
  TOUR_PAUSED_KEY,
  TOUR_SEEN_PREFIX,
  TOUR_START_EVENT,
  TOUR_PAUSE_EVENT,
} from "@/lib/tour/tourSteps";

function ResumeBanner({ onResume, onEnd }: { onResume: () => void; onEnd: () => void }) {
  return (
    <div className="tour-resume-banner" role="status" aria-live="polite">
      <span>Tour paused — explore freely</span>
      <button className="tour-resume-btn" onClick={onResume}>
        Resume Tour
      </button>
      <button className="tour-end-btn" onClick={onEnd}>
        End Tour
      </button>
    </div>
  );
}

export default function GuidedTour() {
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();
  // Tour is the same shape for everyone in Phase 1 — the admin/superadmin
  // split is wired so Phase 2's admin-only pages can plug in without
  // touching the orchestrator.
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const routeOrder = useMemo(() => getTourRouteOrder(isAdmin), [isAdmin]);
  const [tourActive, setTourActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const hasAutoCheckedRef = useRef(false);

  // Hydrate from localStorage on mount so a refresh mid-tour resumes
  // instead of restarting from step 1.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(TOUR_KEY) === "true") {
      setTourActive(true);
      setPaused(localStorage.getItem(TOUR_PAUSED_KEY) === "true");
    }
  }, []);

  // First-login auto-start. Guarded against re-firing within a session
  // and against running on auth pages.
  useEffect(() => {
    if (hasAutoCheckedRef.current) return;
    if (!user?.email) return;
    hasAutoCheckedRef.current = true;

    const userKey = `${TOUR_SEEN_PREFIX}${user.email}`;
    const seenLocal = localStorage.getItem(userKey) === "true";
    // The /auth/me payload exposes `hasSeenTour` (added with the
    // migration in this same PR). Cast through unknown because the
    // public User type doesn't include it yet — we treat the field as
    // optional so older cached user objects still work.
    const seenServer =
      (user as unknown as { hasSeenTour?: boolean }).hasSeenTour === true;
    if (seenLocal || seenServer) return;
    if (localStorage.getItem(TOUR_KEY) === "true") return;

    const skipPaths = ["/login", "/signup", "/forgot-password", "/reset-password", "/onboarding"];
    if (skipPaths.some((p) => pathname.startsWith(p))) return;

    localStorage.setItem(userKey, "true");
    api.markTourSeen().catch(() => {
      // Server-side write is best-effort; the localStorage flag above
      // already prevents re-trigger this session.
    });
    localStorage.setItem(TOUR_KEY, "true");
    setTourActive(true);
    if (normalizeTourPath(pathname) !== "/dashboard") {
      router.push("/dashboard");
    }
  }, [user, pathname, router]);

  // External "start tour" trigger from the header button.
  useEffect(() => {
    function handleStart() {
      setPaused(false);
      localStorage.removeItem(TOUR_PAUSED_KEY);
      setTourActive(true);
    }
    window.addEventListener(TOUR_START_EVENT, handleStart);
    return () => window.removeEventListener(TOUR_START_EVENT, handleStart);
  }, []);

  // External pause trigger from the "Explore on your own" button
  // injected into step descriptions.
  useEffect(() => {
    function handlePause() {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
      setPaused(true);
      localStorage.setItem(TOUR_PAUSED_KEY, "true");
    }
    window.addEventListener(TOUR_PAUSE_EVENT, handlePause);
    return () => window.removeEventListener(TOUR_PAUSE_EVENT, handlePause);
  }, []);

  // The actual driver.js loop. Re-runs on route change while the tour
  // is active, picks up the next step list, advances to the next route
  // when the user clicks "Continue to <Page>" on the last step.
  useEffect(() => {
    if (!tourActive || paused) return;

    const baseSteps = getStepsForRoute(pathname);
    if (!baseSteps || baseSteps.length === 0) return;

    // 800 ms delay gives the new route's anchors time to mount before
    // driver.js queries them. Without this, navigating in step
    // sometimes lands on a "Element not found" stub.
    const timer = setTimeout(() => {
      const currentRouteIndex = routeOrder.indexOf(normalizeTourPath(pathname));
      if (currentRouteIndex === -1) return;

      const nextRoute = routeOrder[currentRouteIndex + 1];
      const isLastRoute = !nextRoute;
      const nextLabel = nextRoute
        ? ROUTE_LABELS[nextRoute] || nextRoute.replace(/^\//, "") || "next"
        : "";

      const steps: DriveStep[] = baseSteps;

      const d = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        overlayColor: "rgba(0, 0, 0, 0.55)",
        stagePadding: 10,
        stageRadius: 10,
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: isLastRoute ? "Finish Tour" : `Continue to ${nextLabel}`,
        onCloseClick: () => {
          d.destroy();
          driverRef.current = null;
          setPaused(true);
          localStorage.setItem(TOUR_PAUSED_KEY, "true");
        },
        onDestroyStarted: () => {
          if (isLastRoute) {
            // Tour fully completed — clear state + persist server-side.
            localStorage.removeItem(TOUR_KEY);
            localStorage.removeItem(TOUR_PAUSED_KEY);
            if (user?.email) {
              localStorage.setItem(`${TOUR_SEEN_PREFIX}${user.email}`, "true");
            }
            api.markTourSeen().catch(() => {});
            setTourActive(false);
            setPaused(false);
            d.destroy();
          } else {
            d.destroy();
            driverRef.current = null;
            router.push(nextRoute);
          }
        },
        steps,
      });

      driverRef.current = d;
      d.drive();
    }, 800);

    return () => {
      clearTimeout(timer);
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, [tourActive, paused, pathname, router, routeOrder, user]);

  const handleResume = useCallback(() => {
    setPaused(false);
    localStorage.removeItem(TOUR_PAUSED_KEY);
    // Force the driver-loop effect to re-run by toggling tourActive
    // off and back on — the effect's deps don't include `paused`'s
    // false value transition reliably enough across React 19.
    setTourActive(false);
    setTimeout(() => setTourActive(true), 100);
  }, []);

  const handleEnd = useCallback(() => {
    localStorage.removeItem(TOUR_KEY);
    localStorage.removeItem(TOUR_PAUSED_KEY);
    if (user?.email) {
      localStorage.setItem(`${TOUR_SEEN_PREFIX}${user.email}`, "true");
    }
    api.markTourSeen().catch(() => {});
    setTourActive(false);
    setPaused(false);
  }, [user]);

  if (tourActive && paused) {
    return <ResumeBanner onResume={handleResume} onEnd={handleEnd} />;
  }
  return null;
}
