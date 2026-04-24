-- CreateTable
CREATE TABLE "ModelProvider" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyEnc" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "costInput" DOUBLE PRECISION NOT NULL,
    "costOutput" DOUBLE PRECISION NOT NULL,
    "maxContext" INTEGER NOT NULL,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT true,
    "residency" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "preset" TEXT NOT NULL DEFAULT 'recommended',
    "primaryModelId" TEXT NOT NULL,
    "reviewerModelIds" JSONB NOT NULL,
    "maxSteps" INTEGER NOT NULL DEFAULT 25,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "systemPrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "meetingId" TEXT,
    "title" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'listen',
    "status" TEXT NOT NULL DEFAULT 'active',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "agentType" TEXT,
    "input" JSONB,
    "output" JSONB,
    "traceId" TEXT NOT NULL,
    "parentId" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "preferredChannel" TEXT NOT NULL DEFAULT 'email',
    "channelIds" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "discoveredFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "engagementId" TEXT,
    "recipientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "response" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "escalationChannel" TEXT,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMemory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessed" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelProvider_tenantId_idx" ON "ModelProvider"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelProvider_tenantId_name_key" ON "ModelProvider"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ModelConfig_tenantId_idx" ON "ModelConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelConfig_tenantId_providerId_modelId_key" ON "ModelConfig"("tenantId", "providerId", "modelId");

-- CreateIndex
CREATE INDEX "AgentConfig_tenantId_idx" ON "AgentConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConfig_tenantId_agentType_key" ON "AgentConfig"("tenantId", "agentType");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_traceId_key" ON "Engagement"("traceId");

-- CreateIndex
CREATE INDEX "Engagement_tenantId_status_idx" ON "Engagement"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Engagement_tenantId_phase_idx" ON "Engagement"("tenantId", "phase");

-- CreateIndex
CREATE INDEX "Engagement_meetingId_idx" ON "Engagement"("meetingId");

-- CreateIndex
CREATE INDEX "TeamMember_tenantId_role_idx" ON "TeamMember"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_tenantId_email_key" ON "TeamMember"("tenantId", "email");

-- CreateIndex
CREATE INDEX "MessageLog_tenantId_engagementId_idx" ON "MessageLog"("tenantId", "engagementId");

-- CreateIndex
CREATE INDEX "MessageLog_recipientId_status_idx" ON "MessageLog"("recipientId", "status");

-- CreateIndex
CREATE INDEX "TenantMemory_tenantId_category_idx" ON "TenantMemory"("tenantId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMemory_tenantId_category_key_key" ON "TenantMemory"("tenantId", "category", "key");

-- AddForeignKey
ALTER TABLE "ModelConfig" ADD CONSTRAINT "ModelConfig_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ModelProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
