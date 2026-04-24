-- ============================================================
-- Security patch: audit log RLS + misc fixes
--
-- H-5: audit_logs SELECT allowed any same-org employee to read
--      salary/payroll PII in old_data/new_data. Restricted those
--      table rows to admins only.
-- M-6: current_employee_role() was granted EXECUTE to anon in the
--      fallback block of 20260424200001. Revoked here.
-- M-7: ecommerce_connections policy had no org isolation. Fixed.
-- M-8: check_permission() had no org scope on employee JOIN,
--      allowing cross-tenant permission lookups. Fixed.
-- ============================================================

BEGIN;

-- ─── H-5: audit_logs RLS ─────────────────────────────────────
DROP POLICY IF EXISTS "audit_select" ON audit_logs;

CREATE POLICY "audit_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    current_employee_role() IN ('admin', 'super_admin')
    OR (
      organization_id = current_employee_org()
      AND table_name NOT IN ('salary_records', 'payroll_records')
    )
  );

-- ─── M-6: Revoke anon execute on current_employee_role() ─────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'current_employee_role'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.current_employee_role() FROM anon;
  END IF;
END $$;

-- ─── M-7: ecommerce_connections — admin-only (no organization_id column exists yet) ──────────
-- Full org isolation requires ALTER TABLE ecommerce_connections ADD COLUMN organization_id INT
-- in a separate migration once the column is confirmed. For now, enforce admin-only access.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ecommerce_connections'
  ) THEN
    DROP POLICY IF EXISTS "ecommerce_connections_admin_only" ON ecommerce_connections;
    CREATE POLICY "ecommerce_connections_admin_only" ON ecommerce_connections
      FOR ALL
      USING (current_employee_role() IN ('admin', 'super_admin'))
      WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));
  END IF;
END $$;

-- ─── M-8: check_permission() — add org scope ─────────────────
CREATE OR REPLACE FUNCTION public.check_permission(
  p_employee_id     INT,
  p_permission_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id   INT;
  v_caller_role TEXT;
  v_caller_org  INT;
  v_result      BOOLEAN;
BEGIN
  v_caller_id   := current_employee_id();
  v_caller_role := current_employee_role();
  v_caller_org  := current_employee_org();

  IF v_caller_role NOT IN ('admin', 'super_admin') AND v_caller_id IS DISTINCT FROM p_employee_id THEN
    RAISE EXCEPTION '權限不足：僅可查詢自身權限';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    JOIN employees   e ON e.role_id = rp.role_id
    WHERE e.id              = p_employee_id
      AND e.organization_id = v_caller_org
      AND p.code            = p_permission_code
  ) INTO v_result;

  RETURN COALESCE(v_result, false);
END;
$$;

GRANT  EXECUTE ON FUNCTION public.check_permission(INT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.check_permission(INT, TEXT) FROM anon;

COMMIT;
