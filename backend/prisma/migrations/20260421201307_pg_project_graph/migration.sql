-- CreateTable
CREATE TABLE "project_graphs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "graphJson" JSONB NOT NULL,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "edgeCount" INTEGER NOT NULL DEFAULT 0,
    "communityCount" INTEGER NOT NULL DEFAULT 0,
    "godNodeSlugs" JSONB NOT NULL DEFAULT '[]',
    "languages" JSONB NOT NULL DEFAULT '[]',
    "repoLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_graphs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_graphs_projectId_key" ON "project_graphs"("projectId");

-- CreateIndex
CREATE INDEX "project_graphs_tenantId_projectId_idx" ON "project_graphs"("tenantId", "projectId");

-- AddForeignKey
ALTER TABLE "project_graphs" ADD CONSTRAINT "project_graphs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
