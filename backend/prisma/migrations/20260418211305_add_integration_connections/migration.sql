-- Add IntegrationConnection table — generic BYOK credential vault.
--
-- Per-tenant encrypted storage for tokens the user pastes through the
-- in-app integration wizards (Jira, Slack, GitHub, Linear, Notion, etc.).
--
-- Credentials column holds AES-256-GCM ciphertext in `iv:tag:ct` format,
-- encrypted via lib/encryption.ts with a key derived from JWT_SECRET.

CREATE TABLE "integration_connections" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'disconnected',
  "credentials"  TEXT NOT NULL DEFAULT '',
  "metadata"     JSONB NOT NULL DEFAULT '{}',
  "lastTestedAt" TIMESTAMP(3),
  "lastError"    TEXT,
  "connectedBy"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_connections_tenantId_name_key"
  ON "integration_connections"("tenantId", "name");

CREATE INDEX "integration_connections_tenantId_status_idx"
  ON "integration_connections"("tenantId", "status");

ALTER TABLE "integration_connections"
  ADD CONSTRAINT "integration_connections_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
