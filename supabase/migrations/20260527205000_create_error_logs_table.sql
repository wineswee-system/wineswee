-- ─────────────────────────────────────────────────────────────────────────────
-- Create error_logs table
--
-- Centralised application error log.  Every unhandled error, rejected promise,
-- React error-boundary catch, and explicit logError() call lands here.
-- Super-admins can monitor across all orgs; operators see only their own org
-- via RLS.
--
-- Columns added later by migration 20260527210000:
--   resolution_note, fix_reference, recurrence_count
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS error_logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL,

  -- severity / classification
  level           TEXT NOT NULL DEFAULT 'error'
                    CHECK (level IN ('debug','info','warn','error','fatal')),
  module          TEXT,
  error_code      TEXT,

  -- error content
  message         TEXT NOT NULL,
  stack_trace     TEXT,
  component       TEXT,        -- React component stack or server component name
  url             TEXT,        -- browser URL or server route at time of error

  -- who was affected
  "user"          TEXT,        -- display name
  user_email      TEXT,

  -- arbitrary extra context
  metadata        JSONB NOT NULL DEFAULT '{}',

  -- resolution lifecycle
  resolved        BOOLEAN NOT NULL DEFAULT false,
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Most common query: all errors for this org, newest first
CREATE INDEX IF NOT EXISTS idx_error_logs_org_created
  ON error_logs (organization_id, created_at DESC);

-- Filter by module (per-module error views)
CREATE INDEX IF NOT EXISTS idx_error_logs_org_module
  ON error_logs (organization_id, module, created_at DESC)
  WHERE module IS NOT NULL;

-- Filter by error_code (for the resolve-by-code RPC)
CREATE INDEX IF NOT EXISTS idx_error_logs_error_code
  ON error_logs (error_code)
  WHERE error_code IS NOT NULL;

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's errors
CREATE POLICY "error_logs_select_org" ON error_logs
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
    )
  );

-- Allow browser-side logError() (anon or authenticated) to append entries.
-- Inserts are append-only; SELECT is org-scoped above.
CREATE POLICY "error_logs_insert_anon" ON error_logs
  FOR INSERT
  WITH CHECK (true);

-- Only authenticated users (ops/super-admin) can mark errors resolved
CREATE POLICY "error_logs_update_auth" ON error_logs
  FOR UPDATE
  USING (auth.role() IN ('authenticated', 'service_role'));

-- Only service role can hard-delete entries
CREATE POLICY "error_logs_delete_service" ON error_logs
  FOR DELETE
  USING (auth.role() = 'service_role');

-- ── Comments ──────────────────────────────────────────────────────────────────

COMMENT ON TABLE  error_logs IS
  'Application error log. Populated by systemLogger.logError() and the global '
  'window.onerror / unhandledrejection handlers. Monitored via the super-admin '
  'ErrorLogs page.';
COMMENT ON COLUMN error_logs.level      IS 'debug | info | warn | error | fatal';
COMMENT ON COLUMN error_logs.module     IS 'Logical subsystem (e.g. HR, POS, Auth)';
COMMENT ON COLUMN error_logs.error_code IS 'ALL_CAPS identifier for deduplication and git-hook auto-resolve';
COMMENT ON COLUMN error_logs.component  IS 'React component stack or server-side component';
COMMENT ON COLUMN error_logs.resolved   IS 'True when the underlying bug is confirmed fixed';
COMMENT ON COLUMN error_logs.resolved_by IS 'Display name of the resolver';
COMMENT ON COLUMN error_logs.resolved_at IS 'Timestamp when marked resolved';
