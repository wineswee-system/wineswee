-- ============================================================
-- Restore audit triggers + fix leave/overtime RLS
-- Reverts the damage from 20260424000300_revert_rbac_patches.sql
-- ============================================================

BEGIN;

-- ── 1. Restore audit_logs columns ────────────────────────────

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

-- ── 2. Restore audit_logs RLS policy ─────────────────────────

DROP POLICY IF EXISTS "audit_select" ON audit_logs;
CREATE POLICY "audit_select" ON audit_logs FOR SELECT USING (
  current_employee_role() IN ('admin', 'super_admin')
  OR organization_id = current_employee_org()
);

-- ── 3. Recreate audit trigger function ───────────────────────

CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT;
  v_role  TEXT;
  v_org   INT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  v_role := current_employee_role();
  v_org  := current_employee_org();

  INSERT INTO audit_logs (
    table_name, operation,
    old_data, new_data,
    user_email, user_role, organization_id,
    created_at
  ) VALUES (
    TG_TABLE_NAME,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    v_email,
    v_role,
    v_org,
    now()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 4. Re-attach triggers to sensitive tables ─────────────────

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'employees', 'salary_records', 'payroll_records',
    'leave_requests', 'overtime_requests',
    'roles', 'permissions', 'role_permissions'
  ]
  LOOP
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
  END LOOP;
END $$;

-- ── 5. Fix leave_requests UPDATE policy ──────────────────────
-- admin/super_admin/manager: unrestricted
-- employee: own record only, and only while still pending

DROP POLICY IF EXISTS "leave_update" ON leave_requests;

CREATE POLICY "leave_update" ON leave_requests FOR UPDATE USING (
  current_employee_role() IN ('admin', 'super_admin', 'manager')
  OR (
    employee = (
      SELECT name FROM employees
      WHERE auth_user_id = auth.uid()
         OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
      LIMIT 1
    )
    AND status = '待審核'
  )
);

-- ── 6. Fix overtime_requests UPDATE policy ───────────────────

DROP POLICY IF EXISTS "overtime_update" ON overtime_requests;

CREATE POLICY "overtime_update" ON overtime_requests FOR UPDATE USING (
  current_employee_role() IN ('admin', 'super_admin', 'manager')
  OR (
    employee = (
      SELECT name FROM employees
      WHERE auth_user_id = auth.uid()
         OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
      LIMIT 1
    )
    AND status = '待審核'
  )
);

COMMIT;
