-- Add Skills table — Hermes-inspired user-message injection playbooks.
--
-- Body stored as markdown with YAML-style frontmatter in configSchema.
-- At invoke time, service builds an activation message and injects as a
-- user turn. See AGENTS.md § "Skills as User-Message Injection".

CREATE TABLE "skills" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "description"      TEXT NOT NULL,
  "body"             TEXT NOT NULL,
  "platforms"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "disabled"         BOOLEAN NOT NULL DEFAULT false,
  "configSchema"     JSONB,
  "supportingFiles"  JSONB,
  "createdBy"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skills_tenantId_slug_key" ON "skills"("tenantId", "slug");
CREATE INDEX "skills_tenantId_disabled_idx" ON "skills"("tenantId", "disabled");

ALTER TABLE "skills"
  ADD CONSTRAINT "skills_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
