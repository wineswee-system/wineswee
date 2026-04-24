-- ============================================================
-- Security hardening:
--   HIGH-4  Fix current_employee_role() to JOIN roles table
--   MED-1   Drop surviving anon full-access policies + REVOKE SELECT
--   MED-5   Restrict ecommerce_connections to admin roles
--   LOW-4   Add SECURITY DEFINER to check_permission()
-- ============================================================

BEGIN;

-- ── HIGH-4: Fix current_employee_role() ──────────────────────
-- Previously read freetext employees.role; now JOINs roles table
-- so the value always matches the authoritative RBAC assignment.

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.name
  FROM public.employees e
  JOIN public.roles r ON r.id = e.role_id
  WHERE e.auth_user_id = auth.uid()
     OR e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
  ORDER BY (e.auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.current_employee_role() TO authenticated, anon;

-- ── MED-1: Drop surviving blanket anon policies ───────────────
-- Drop all policies that grant anon unrestricted SELECT (qual = 'true').

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles @> ARRAY['anon'::name]
      AND (qual = 'true' OR qual IS NULL)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Explicitly revoke SELECT from anon on sensitive tables
REVOKE SELECT ON
  employees,
  salary_records,
  payroll_records,
  leave_requests,
  overtime_requests,
  attendance_records,
  expense_requests
FROM anon;

-- Belt-and-suspenders: revoke write privileges too
REVOKE INSERT, UPDATE, DELETE ON
  employees,
  salary_records,
  payroll_records,
  leave_requests,
  overtime_requests,
  attendance_records,
  expense_requests
FROM anon;

-- ── MED-5: ecommerce_connections — admin-only access ─────────

ALTER TABLE IF EXISTS ecommerce_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ecommerce_connections_select" ON ecommerce_connections;
DROP POLICY IF EXISTS "ecommerce_connections_admin_only" ON ecommerce_connections;

CREATE POLICY "ecommerce_connections_admin_only" ON ecommerce_connections
FOR ALL USING (
  current_employee_role() IN ('admin', 'super_admin')
);

-- ── LOW-4: check_permission() — SECURITY DEFINER + self-only guard ──
-- Non-admins may only check their own permissions, preventing enumeration
-- of other employees' permission assignments.

CREATE OR REPLACE FUNCTION public.check_permission(
  p_employee_id INT,
  p_permission_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id   INT;
  v_caller_role TEXT;
  v_result      BOOLEAN;
BEGIN
  v_caller_id   := current_employee_id();
  v_caller_role := current_employee_role();

  IF v_caller_role NOT IN ('admin', 'super_admin') AND v_caller_id IS DISTINCT FROM p_employee_id THEN
    RAISE EXCEPTION '權限不足：僅可查詢自身權限';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    JOIN employees e    ON e.role_id = rp.role_id
    WHERE e.id = p_employee_id
      AND p.code = p_permission_code
  ) INTO v_result;

  RETURN COALESCE(v_result, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_permission(INT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.check_permission(INT, TEXT) FROM anon;

COMMIT;
