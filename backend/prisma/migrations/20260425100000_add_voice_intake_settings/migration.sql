-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN "voiceCallerAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "tenant_settings" ADD COLUMN "voicePinHash" TEXT;
