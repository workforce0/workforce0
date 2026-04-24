-- AlterTable
ALTER TABLE "project_graphs" ADD COLUMN     "repoPath" TEXT;

-- CreateIndex
CREATE INDEX "project_graphs_repoLabel_idx" ON "project_graphs"("repoLabel");
