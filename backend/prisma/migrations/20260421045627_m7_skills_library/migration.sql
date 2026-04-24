-- CreateTable
CREATE TABLE "skill_packages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "slug" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'vendor',
    "contentHash" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "requiredTools" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subagent_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "slug" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'vendor',
    "contentHash" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "allowedTools" JSONB NOT NULL DEFAULT '[]',
    "preferredModel" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subagent_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentTicketId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "model" TEXT,
    "steps" JSONB NOT NULL,
    "channelSummary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "replanReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skill_packages_tenantId_status_idx" ON "skill_packages"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "skill_packages_tenantId_slug_key" ON "skill_packages"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "subagent_definitions_tenantId_status_idx" ON "subagent_definitions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "subagent_definitions_category_idx" ON "subagent_definitions"("category");

-- CreateIndex
CREATE UNIQUE INDEX "subagent_definitions_tenantId_slug_key" ON "subagent_definitions"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "execution_plans_tenantId_parentTicketId_attempt_idx" ON "execution_plans"("tenantId", "parentTicketId", "attempt");
