-- ================================================================
-- Migration: 20260624000000_org_rls_audit_fix.sql
--
-- Audit & fix org_id scoping + RLS for the process-module tables
-- that were added after phase1_3 ran, or that used non-standard
-- column names / referenced a non-existent table.
--
-- Tables fixed:
--   1. project_lists         — org_id exists but RLS is blanket-true
--   2. task_time_logs        — no org column + blanket-true (all roles)
--   3. approval_delegation_rules — org_id exists but RLS is blanket-true
--   4. list_templates        — RLS referenced non-existent organization_members
--   5. form_templates        — same
--   6. project_comments      — no org column; employees couldn't write
-- ================================================================

BEGIN;

-- ================================================================
-- 1. project_lists
--    org_id column (bigint) exists but policy is blanket USING(true)
-- ================================================================

-- Backfill org_id from the parent project for any rows missing it
UPDATE project_lists pl
SET org_id = p.organization_id::bigint
FROM projects p
WHERE pl.project_id = p.id
  AND pl.org_id IS NULL
  AND p.organization_id IS NOT NULL;

DROP POLICY IF EXISTS "org members access project lists"  ON project_lists;
DROP POLICY IF EXISTS "org members access project_lists"  ON project_lists;

CREATE POLICY "org members access project_lists" ON project_lists
  FOR ALL TO authenticated
  USING (
    org_id = public.current_employee_org()::bigint
    OR public.current_employee_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    org_id = public.current_employee_org()::bigint
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

-- ================================================================
-- 2. task_time_logs
--    No org column; policy was FOR ALL (no role restriction) USING(true)
-- ================================================================

ALTER TABLE task_time_logs
  ADD COLUMN IF NOT EXISTS organization_id int REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE task_time_logs tl
SET organization_id = t.organization_id
FROM tasks t
WHERE tl.task_id = t.id
  AND tl.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_time_logs_org ON task_time_logs(organization_id);

DROP POLICY IF EXISTS "org members manage time logs" ON task_time_logs;

CREATE POLICY "org members manage time logs" ON task_time_logs
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

-- ================================================================
-- 3. approval_delegation_rules
--    org_id column (bigint) exists but policy is blanket USING(true)
-- ================================================================

DROP POLICY IF EXISTS "org members manage delegation rules" ON approval_delegation_rules;

CREATE POLICY "org members manage delegation rules" ON approval_delegation_rules
  FOR ALL TO authenticated
  USING (
    org_id = public.current_employee_org()::bigint
    OR public.current_employee_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    org_id = public.current_employee_org()::bigint
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

-- ================================================================
-- 4. list_templates
--    organization_id column exists but RLS used a non-existent
--    organization_members table — queries would error at runtime
-- ================================================================

DROP POLICY IF EXISTS "list_templates_org_access" ON list_templates;

CREATE POLICY "list_templates_org_access" ON list_templates
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_employee_org()::bigint
    OR public.current_employee_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    organization_id = public.current_employee_org()::bigint
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

-- ================================================================
-- 5. form_templates
--    Same broken organization_members reference as list_templates
-- ================================================================

DROP POLICY IF EXISTS "form_templates_org_access" ON form_templates;

CREATE POLICY "form_templates_org_access" ON form_templates
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_employee_org()::bigint
    OR public.current_employee_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    organization_id = public.current_employee_org()::bigint
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

-- ================================================================
-- 6. project_comments
--    No organization_id column; phase1_3 assigned admin-only write,
--    so regular employees couldn't add comments on their own projects.
-- ================================================================

ALTER TABLE project_comments
  ADD COLUMN IF NOT EXISTS organization_id int REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE project_comments pc
SET organization_id = p.organization_id
FROM projects p
WHERE pc.project_id = p.id
  AND pc.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_comments_org ON project_comments(organization_id);

-- Drop all old policies (blanket-true from original migration + phase1_3 policies)
DROP POLICY IF EXISTS anon_project_comments          ON project_comments;
DROP POLICY IF EXISTS auth_project_comments          ON project_comments;
DROP POLICY IF EXISTS auth_read_project_comments     ON project_comments;
DROP POLICY IF EXISTS admin_write_project_comments   ON project_comments;

CREATE POLICY "org members access project_comments" ON project_comments
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

-- ================================================================
-- Sanity check: non-fatal warnings for rows that couldn't be backfilled
-- ================================================================
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM project_lists WHERE org_id IS NULL;
  IF n > 0 THEN
    RAISE WARNING 'project_lists: % rows still have NULL org_id — invisible to non-admin users', n;
  END IF;

  SELECT count(*) INTO n FROM task_time_logs WHERE organization_id IS NULL;
  IF n > 0 THEN
    RAISE WARNING 'task_time_logs: % rows still have NULL organization_id — invisible to non-admin users', n;
  END IF;

  SELECT count(*) INTO n FROM approval_delegation_rules WHERE org_id IS NULL;
  IF n > 0 THEN
    RAISE WARNING 'approval_delegation_rules: % rows still have NULL org_id — invisible to non-admin users', n;
  END IF;

  SELECT count(*) INTO n FROM project_comments WHERE organization_id IS NULL;
  IF n > 0 THEN
    RAISE WARNING 'project_comments: % rows still have NULL organization_id — invisible to non-admin users', n;
  END IF;
END $$;

COMMIT;
