-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN "step0Migrated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN "step0Dismissed" BOOLEAN NOT NULL DEFAULT false;
