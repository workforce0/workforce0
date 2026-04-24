-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "meetingId" TEXT,
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "tickets_meetingId_idx" ON "tickets"("meetingId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- N6 backfill: every AgentTask row becomes a Ticket row so downstream
-- readers (dashboard, email digest, outcome observer, /api/agents/tasks)
-- can consume a single source of truth. The Ticket id is derived from the
-- AgentTask id with a "tix_legacy_" prefix so re-running is a no-op.
INSERT INTO "tickets" (
  "id", "tenantId", "projectId", "meetingId", "goalId",
  "roleSlug", "title", "description", "status",
  "claimedByAgent", "claimedAt", "payload", "result", "error",
  "priority", "confidence", "requiresApproval", "approvedBy", "approvedAt",
  "createdBy", "createdAt", "updatedAt", "completedAt"
)
SELECT
  'tix_legacy_' || a."id",
  a."tenantId",
  a."projectId",
  a."meetingId",
  a."goalId",
  a."agentType",
  COALESCE('Legacy ' || a."agentType" || COALESCE(' — ' || m."title", ''), 'Legacy agent task'),
  'Backfilled from AgentTask during the N6 migration. Historical record.',
  CASE a."status"
    WHEN 'pending'                  THEN 'ready'
    WHEN 'processing'               THEN 'claimed'
    WHEN 'awaiting_clarification'   THEN 'waiting'
    WHEN 'awaiting_approval'        THEN 'waiting'
    WHEN 'completed'                THEN 'done'
    WHEN 'failed'                   THEN 'failed'
    ELSE 'ready'
  END,
  NULL,
  NULL,
  COALESCE(a."input", '{}'::jsonb),
  a."output",
  a."error",
  100,
  a."confidence",
  a."requiresApproval",
  a."approvedBy",
  a."approvedAt",
  NULL,
  a."createdAt",
  a."updatedAt",
  a."completedAt"
FROM "agent_tasks" a
LEFT JOIN "meetings" m ON m."id" = a."meetingId"
ON CONFLICT ("id") DO NOTHING;
