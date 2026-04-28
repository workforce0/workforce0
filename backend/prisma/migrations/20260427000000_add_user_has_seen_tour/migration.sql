-- Guided tour: track whether each user has completed (or dismissed) the
-- onboarding tour. Default false so new users get the auto-tour on first
-- login; existing users start at false too (one-time re-show is harmless
-- and the StartTourButton can dismiss for power users).
ALTER TABLE "users"
  ADD COLUMN "hasSeenTour" BOOLEAN NOT NULL DEFAULT false;
