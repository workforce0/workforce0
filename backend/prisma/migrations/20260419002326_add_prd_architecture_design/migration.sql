-- Add architectureDesign column for the Architect agent's detailed design output.
-- Nullable JSONB — populated after PRD approval when Architect runs.

ALTER TABLE "prds" ADD COLUMN IF NOT EXISTS "architectureDesign" JSONB;
