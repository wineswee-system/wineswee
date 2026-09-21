-- ─────────────────────────────────────────────────────────────────────────────
-- Error Resolution Tracking
-- Adds three columns to error_logs that together let operators record *what*
-- was fixed and surface recurring issues automatically.
--
--  resolution_note TEXT       — free-text description of the fix (required when
--                               resolving via the UI, optional via API)
--  fix_reference   TEXT       — optional pointer: commit SHA, PR URL, Jira ticket
--  recurrence_count INT       — auto-incremented by systemLogger.logError() whenever
--                               a matching (module + error_code) resolved error is
--                               re-opened; lets you see if a "fix" held
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE error_logs
  ADD COLUMN IF NOT EXISTS resolution_note  TEXT,
  ADD COLUMN IF NOT EXISTS fix_reference    TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_count INT NOT NULL DEFAULT 0;

-- Index so recurrence lookups (module + error_code + resolved) are fast
CREATE INDEX IF NOT EXISTS idx_error_logs_recurrence
  ON error_logs (organization_id, module, error_code, resolved)
  WHERE error_code IS NOT NULL;

-- Index for unresolved errors dashboard (most common query)
CREATE INDEX IF NOT EXISTS idx_error_logs_unresolved
  ON error_logs (organization_id, resolved, created_at DESC)
  WHERE resolved = false;

COMMENT ON COLUMN error_logs.resolution_note  IS 'What was done to fix this error';
COMMENT ON COLUMN error_logs.fix_reference    IS 'Commit SHA, PR URL, or ticket number for the fix';
COMMENT ON COLUMN error_logs.recurrence_count IS 'Number of times this error recurred after being marked resolved';
