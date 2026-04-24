-- DropForeignKey
ALTER TABLE "clarification_requests" DROP CONSTRAINT "clarification_requests_taskId_fkey";

-- AlterTable
ALTER TABLE "clarification_requests" ADD COLUMN     "ticketId" TEXT,
ALTER COLUMN "taskId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "clarification_requests_ticketId_idx" ON "clarification_requests"("ticketId");

-- AddForeignKey
ALTER TABLE "clarification_requests" ADD CONSTRAINT "clarification_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "agent_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clarification_requests" ADD CONSTRAINT "clarification_requests_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- N6b backfill: every existing ClarificationRequest already has a
-- taskId → AgentTask. N6 mirrored every AgentTask into a Ticket with
-- id = 'tix_legacy_<taskId>'. Populate ticketId on every existing row
-- so downstream readers can stop querying via taskId. Idempotent on
-- re-run (the UPDATE is a no-op when ticketId is already set).
UPDATE "clarification_requests" c
SET    "ticketId" = 'tix_legacy_' || c."taskId"
WHERE  c."taskId" IS NOT NULL
  AND  c."ticketId" IS NULL
  AND  EXISTS (SELECT 1 FROM "tickets" t WHERE t."id" = 'tix_legacy_' || c."taskId");
