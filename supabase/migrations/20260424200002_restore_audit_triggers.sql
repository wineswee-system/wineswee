-- ============================================================
-- Security Fix L-5: Restore audit triggers on sensitive tables
--
-- PROBLEM: 20260424000300_revert_rbac_patches.sql dropped audit
-- triggers and audit_trigger_fn() from:
--   employees, salary_records, payroll_records, leave_requests,
--   overtime_requests, roles, permissions, role_permissions
--
-- This migration restores them idempotently. All statements use
-- IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS so the
-- file is safe to run even when 20260424100000 already ran.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Ensure audit_logs has the columns required by the trigger
--    (originally added by 20260424100000; repeated with
--    IF NOT EXISTS for safety)
-- ────────────────────────────────────────────────────────────

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS table_name      TEXT,
  ADD COLUMN IF NOT EXISTS operation       TEXT,
  ADD COLUMN IF NOT EXISTS old_data        JSONB,
  ADD COLUMN IF NOT EXISTS new_data        JSONB,
  ADD COLUMN IF NOT EXISTS user_email      TEXT,
  ADD COLUMN IF NOT EXISTS user_role       TEXT,
  ADD COLUMN IF NOT EXISTS organization_id INT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_email ON audit_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org   ON audit_logs(organization_id);


-- ────────────────────────────────────────────────────────────
-- 2. Ensure current_employee_org() helper exists
--    (used by the trigger to record the acting organisation)
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_employee_org'
  ) THEN
    EXECUTE $func$
      CREATE FUNCTION public.current_employee_org()
      RETURNS INT
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $inner$
        SELECT organization_id
        FROM public.employees
        WHERE auth_user_id = auth.uid()
           OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
        ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
        LIMIT 1
      $inner$
    $func$;
    GRANT EXECUTE ON FUNCTION public.current_employee_org() TO authenticated, anon;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 3. (Re)create the audit trigger function
--    CREATE OR REPLACE is safe to run multiple times.
--    Records: table name, operation, old/new row snapshots,
--    acting user email, their role, and their organisation.
--    Legacy columns ("user", action, target_table) are also
--    populated for backward compatibility with existing queries.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT;
  v_role  TEXT;
  v_org   INT;
BEGIN
  -- Resolve caller context; functions return NULL for
  -- unauthenticated/system callers, which is acceptable.
  BEGIN
    SELECT email INTO v_email
    FROM auth.users WHERE id = auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_email := NULL;
  END;

  BEGIN
    v_role := current_employee_role();
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  BEGIN
    v_org := current_employee_org();
  EXCEPTION WHEN OTHERS THEN
    v_org := NULL;
  END;

  INSERT INTO audit_logs (
    table_name,
    operation,
    old_data,
    new_data,
    user_email,
    user_role,
    organization_id,
    "user",       -- legacy column
    action,       -- legacy column
    target_table  -- legacy column
  ) VALUES (
    TG_TABLE_NAME,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    v_email,
    v_role,
    v_org,
    COALESCE(v_email, 'system'),
    TG_OP,
    TG_TABLE_NAME
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 4. Re-attach audit triggers to all sensitive tables
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'employees',
    'salary_records',
    'payroll_records',
    'leave_requests',
    'overtime_requests',
    'roles',
    'permissions',
    'role_permissions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = tbl
    ) THEN
      RAISE NOTICE 'audit trigger: table % not found, skipping', tbl;
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_%I ON %I',
      tbl, tbl
    );

    EXECUTE format(
      'CREATE TRIGGER audit_%I '
      'AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn()',
      tbl, tbl
    );

    RAISE NOTICE 'audit trigger restored on %', tbl;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────
-- 5. audit_logs RLS: admins and same-org users can read logs
--    (restores the policy dropped by 20260424000300)
-- ────────────────────────────────────────────────────────────

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select" ON audit_logs;

CREATE POLICY "audit_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    current_employee_role() IN ('admin', 'super_admin')
    OR organization_id = current_employee_org()
  );

-- Grant SELECT so authenticated users can read their own org's logs
GRANT SELECT ON audit_logs TO authenticated;

COMMIT;
