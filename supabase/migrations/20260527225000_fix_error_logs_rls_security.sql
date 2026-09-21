-- ─────────────────────────────────────────────────────────────────────────────
-- Fix error_logs RLS policies and resolve_errors_by_codes RPC security
--
-- ⚠️ BACKFILL：此檔為老闆 2026-05-27 22:50 直接在 Supabase Studio 套用的 hotfix，
--   原本沒進 git。為了讓 local migration history 跟遠端對齊，事後補進來。
--   內容 1:1 對應遠端 supabase_migrations.schema_migrations.statements。
--
-- Addresses three critical issues found in code review:
--
--  [C-1] Open INSERT policy (WITH CHECK (true)) allowed anonymous unauthenticated
--        users to flood the table or spoof any organization_id.
--        Fix: separate anon policy (NULL org only) from authenticated policy (own org).
--
--  [C-2] resolve_errors_by_codes was GRANTED to anon role — anyone with the
--        public anon key could mass-resolve all errors across every tenant.
--        Fix: revoke anon, keep service_role + authenticated (super-admin UI).
--
--  [C-3] UPDATE RLS had no org-scoping — any authenticated user could resolve
--        errors belonging to other organisations.
--        Fix: require organization_id to match the caller's own org on UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── C-1 / C-3: Replace INSERT and UPDATE policies ────────────────────────────

-- Drop the original open policies from 20260527205000
DROP POLICY IF EXISTS "error_logs_insert_anon"  ON error_logs;
DROP POLICY IF EXISTS "error_logs_update_auth"  ON error_logs;

-- Authenticated users may only insert errors for their own organisation.
CREATE POLICY "error_logs_insert_authenticated" ON error_logs
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      auth.role() = 'authenticated'
      AND (
        organization_id IS NULL
        OR organization_id IN (
          SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
        )
      )
    )
  );

-- Anonymous (pre-login) runtime errors: INSERT allowed only when org is NULL.
-- Lets window.onerror / unhandledrejection log before the user signs in without
-- allowing spoofing of another org's error stream.
CREATE POLICY "error_logs_insert_anon" ON error_logs
  FOR INSERT
  WITH CHECK (
    auth.role() = 'anon'
    AND organization_id IS NULL
  );

-- UPDATE: org-scoped for authenticated callers; service_role for automation.
CREATE POLICY "error_logs_update_auth" ON error_logs
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR (
      auth.role() = 'authenticated'
      AND (
        organization_id IS NULL
        OR organization_id IN (
          SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
        )
      )
    )
  );

-- ── C-2: Remove anon from RPC GRANT ──────────────────────────────────────────
-- The git hook and CI both use SUPABASE_SERVICE_ROLE_KEY — anon is unnecessary.
-- Leaving anon grant meant anyone with the public anon key (in the JS bundle)
-- could bulk-resolve all open errors across every tenant with one HTTP call.

REVOKE EXECUTE ON FUNCTION resolve_errors_by_codes(TEXT[], TEXT, TEXT, TEXT)
  FROM anon;

-- service_role: git-hook / CI automation
-- authenticated: super-admin bulk resolve via UI (future path)
GRANT EXECUTE ON FUNCTION resolve_errors_by_codes(TEXT[], TEXT, TEXT, TEXT)
  TO service_role, authenticated;

COMMENT ON FUNCTION resolve_errors_by_codes IS
  'Bulk-resolve open error_logs entries by error_code array. '
  'Called from git post-commit hook and GitHub Actions CI (service_role key). '
  'SECURITY DEFINER — bypasses RLS. NOT callable by the anon role. Safe to call repeatedly.';
