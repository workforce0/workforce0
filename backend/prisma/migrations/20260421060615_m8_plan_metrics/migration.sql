-- AlterTable
ALTER TABLE "execution_plans" ADD COLUMN     "candidateCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "critiqueScore" INTEGER,
ADD COLUMN     "revised" BOOLEAN NOT NULL DEFAULT false;
