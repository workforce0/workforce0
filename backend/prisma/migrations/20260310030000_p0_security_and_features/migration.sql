-- P0 Migration: User model, Invitations, Tenant billing fields, MeetingInsights, PRDTemplate, DB-level RLS

-- ============================================================
-- 1. Add billing fields to Tenant
-- ============================================================
ALTER TABLE "tenants" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'free_trial';
ALTER TABLE "tenants" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "meetingsUsedThisMonth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tenants" ADD COLUMN "prdsUsedThisMonth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tenants" ADD COLUMN "billingPeriodStart" TIMESTAMP(3);

-- Set trial end date for existing tenants (14 days from now)
UPDATE "tenants" SET "trialEndsAt" = NOW() + INTERVAL '14 days' WHERE "trialEndsAt" IS NULL;

-- ============================================================
-- 2. Users table
-- ============================================================
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 3. Invitations table
-- ============================================================
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");
CREATE INDEX "invitations_tenantId_idx" ON "invitations"("tenantId");
CREATE INDEX "invitations_token_idx" ON "invitations"("token");

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 4. Meeting Insights table
-- ============================================================
CREATE TABLE "meeting_insights" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actionItems" JSONB NOT NULL DEFAULT '[]',
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "sentiment" TEXT,
    "participantStats" JSONB NOT NULL DEFAULT '[]',
    "topics" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_insights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meeting_insights_meetingId_key" ON "meeting_insights"("meetingId");
CREATE INDEX "meeting_insights_tenantId_idx" ON "meeting_insights"("tenantId");

-- ============================================================
-- 5. PRD Templates table
-- ============================================================
CREATE TABLE "prd_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prd_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prd_templates_tenantId_idx" ON "prd_templates"("tenantId");

-- ============================================================
-- 6. Database-Level Row-Level Security (Defense-in-depth)
-- ============================================================

-- Enable RLS on tenant-scoped tables
ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;

-- Create policies: allow access only when app.current_tenant_id matches tenantId
-- The application sets this via SET LOCAL before each query batch.

-- Meetings
CREATE POLICY tenant_isolation_meetings ON "meetings"
    USING ("tenantId" = current_setting('app.current_tenant_id', true))
    WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- Agent Tasks
CREATE POLICY tenant_isolation_agent_tasks ON "agent_tasks"
    USING ("tenantId" = current_setting('app.current_tenant_id', true))
    WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- PRDs
CREATE POLICY tenant_isolation_prds ON "prds"
    USING ("tenantId" = current_setting('app.current_tenant_id', true))
    WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- Notifications
CREATE POLICY tenant_isolation_notifications ON "notifications"
    USING ("tenantId" = current_setting('app.current_tenant_id', true))
    WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- Users
CREATE POLICY tenant_isolation_users ON "users"
    USING ("tenantId" = current_setting('app.current_tenant_id', true))
    WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- IMPORTANT: The application role must NOT be a superuser or table owner for RLS to apply.
-- For the app user, RLS is enforced. For migration/admin users (table owners), RLS is bypassed.
-- The app should call: SET LOCAL app.current_tenant_id = '<tenantId>' before queries.
-- When no tenant context (webhooks/system), the setting is empty and RLS returns 0 rows,
-- which is why app-level RLS also exists as a fallback.
