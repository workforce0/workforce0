-- CreateTable
CREATE TABLE "agent_webhooks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleSlug" TEXT NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "sharedSecret" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_webhooks_tenantId_roleSlug_isActive_idx" ON "agent_webhooks"("tenantId", "roleSlug", "isActive");

-- CreateIndex
CREATE INDEX "agent_webhooks_tenantId_idx" ON "agent_webhooks"("tenantId");
