-- AlterTable
ALTER TABLE "Engagement" ADD COLUMN     "goalId" TEXT;

-- AlterTable
ALTER TABLE "agent_tasks" ADD COLUMN     "goalId" TEXT;

-- AlterTable
ALTER TABLE "prds" ADD COLUMN     "targetRepo" TEXT;

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "goalId" TEXT,
    "parentTicketId" TEXT,
    "roleSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "claimedByAgent" TEXT,
    "claimedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "parentGoalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "targetDate" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_role_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_role_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'consultant',
    "systemPromptTemplate" TEXT,
    "allowedTools" JSONB NOT NULL DEFAULT '[]',
    "defaultModelConfigId" TEXT,
    "monthlyBudgetTokens" INTEGER,
    "defaultConcurrency" INTEGER NOT NULL DEFAULT 2,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learned_skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "sourceOutcomes" INTEGER NOT NULL DEFAULT 0,
    "positiveRate" DOUBLE PRECISION,
    "negativeRate" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learned_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_outcomes" (
    "id" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "toolsUsed" JSONB,
    "stepCount" INTEGER,
    "revisionFeedback" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tokens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "targetRepo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_threads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channelRef" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "engagementId" TEXT,
    "participants" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3),

    CONSTRAINT "conversation_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_turns" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "addressedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tickets_tenantId_status_idx" ON "tickets"("tenantId", "status");

-- CreateIndex
CREATE INDEX "tickets_tenantId_roleSlug_status_idx" ON "tickets"("tenantId", "roleSlug", "status");

-- CreateIndex
CREATE INDEX "tickets_parentTicketId_idx" ON "tickets"("parentTicketId");

-- CreateIndex
CREATE INDEX "tickets_goalId_idx" ON "tickets"("goalId");

-- CreateIndex
CREATE INDEX "ticket_events_ticketId_createdAt_idx" ON "ticket_events"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "goals_tenantId_status_idx" ON "goals"("tenantId", "status");

-- CreateIndex
CREATE INDEX "goals_parentGoalId_idx" ON "goals"("parentGoalId");

-- CreateIndex
CREATE INDEX "agent_role_versions_tenantId_slug_createdAt_idx" ON "agent_role_versions"("tenantId", "slug", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_role_versions_tenantId_slug_version_key" ON "agent_role_versions"("tenantId", "slug", "version");

-- CreateIndex
CREATE INDEX "agent_roles_tenantId_isActive_idx" ON "agent_roles"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "agent_roles_slug_idx" ON "agent_roles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "agent_roles_tenantId_slug_key" ON "agent_roles"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "learned_skills_status_target_idx" ON "learned_skills"("status", "target");

-- CreateIndex
CREATE INDEX "learned_skills_status_idx" ON "learned_skills"("status");

-- CreateIndex
CREATE INDEX "agent_outcomes_agentType_result_idx" ON "agent_outcomes"("agentType", "result");

-- CreateIndex
CREATE INDEX "agent_outcomes_createdAt_idx" ON "agent_outcomes"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tokens_tokenHash_key" ON "agent_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "agent_tokens_tokenHash_idx" ON "agent_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "agent_tokens_tenantId_idx" ON "agent_tokens"("tenantId");

-- CreateIndex
CREATE INDEX "agent_jobs_tenantId_status_idx" ON "agent_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "agent_jobs_agentId_status_idx" ON "agent_jobs"("agentId", "status");

-- CreateIndex
CREATE INDEX "conversation_threads_tenantId_purpose_idx" ON "conversation_threads"("tenantId", "purpose");

-- CreateIndex
CREATE INDEX "conversation_threads_tenantId_lastActivityAt_idx" ON "conversation_threads"("tenantId", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_threads_channel_channelRef_purpose_key" ON "conversation_threads"("channel", "channelRef", "purpose");

-- CreateIndex
CREATE INDEX "conversation_turns_threadId_createdAt_idx" ON "conversation_turns"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_turns_speaker_createdAt_idx" ON "conversation_turns"("speaker", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parentTicketId_fkey" FOREIGN KEY ("parentTicketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "conversation_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
