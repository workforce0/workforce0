-- Remove SaaS billing fields from tenants table (OSS pivot, 2026-04-18).
--
-- Workforce0 no longer ships with Stripe-driven billing. These columns are
-- removed because they only made sense in the SaaS deployment model.
-- For installs that previously held data in these columns, the values are
-- silently dropped — the data has no meaning in the self-hosted context.
--
-- If you self-host and depended on `tier` for any custom gating, read
-- CHANGELOG.md for the migration note.

ALTER TABLE "tenants"
  DROP COLUMN IF EXISTS "tier",
  DROP COLUMN IF EXISTS "trialEndsAt",
  DROP COLUMN IF EXISTS "stripeCustomerId",
  DROP COLUMN IF EXISTS "stripeSubscriptionId",
  DROP COLUMN IF EXISTS "meetingsUsedThisMonth",
  DROP COLUMN IF EXISTS "prdsUsedThisMonth",
  DROP COLUMN IF EXISTS "billingPeriodStart";
