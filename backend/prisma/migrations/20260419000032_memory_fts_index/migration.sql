-- Hermes III M6 — Postgres FTS index for BuiltinMemoryProvider recall.
--
-- Memory entries live inside audit_logs with action prefixed 'memory.' and
-- the content under after->>'content' (JSONB). BuiltinMemoryProvider's
-- original recall used word-based ILIKE which doesn't scale past a few
-- thousand entries and has no ranking. This index + tsvector query gives
-- us ranked relevance search at any volume.
--
-- Partial index (WHERE action LIKE 'memory.%') keeps the index small —
-- audit_logs holds a lot more than memory, and we only want FTS on this
-- subset.

CREATE INDEX IF NOT EXISTS "audit_logs_memory_content_fts_idx"
  ON "audit_logs"
  USING GIN (to_tsvector('english', COALESCE(after->>'content', '')))
  WHERE action LIKE 'memory.%';
