-- Hermes III M7 — user-facing cron scheduling.
--
-- Schedules arbitrary jobType + payload on a cron expression. A
-- CronSchedulerService polls this table on boot and registers a
-- BullMQ repeatable for each enabled row.

CREATE TABLE "scheduled_jobs" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "cronExpression" TEXT NOT NULL,
  "timezone"       TEXT NOT NULL DEFAULT 'UTC',
  "jobType"        TEXT NOT NULL,
  "payload"        JSONB NOT NULL DEFAULT '{}',
  "enabled"        BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt"      TIMESTAMP(3),
  "lastStatus"     TEXT,
  "lastError"      TEXT,
  "nextRunAt"      TIMESTAMP(3),
  "createdBy"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scheduled_jobs_tenantId_name_key" ON "scheduled_jobs"("tenantId", "name");
CREATE INDEX "scheduled_jobs_tenantId_enabled_idx" ON "scheduled_jobs"("tenantId", "enabled");

ALTER TABLE "scheduled_jobs"
  ADD CONSTRAINT "scheduled_jobs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
