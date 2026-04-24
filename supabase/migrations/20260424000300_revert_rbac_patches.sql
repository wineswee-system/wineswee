-- ============================================================
-- Revert RBAC patches from 20260424000000 + 20260424000100
-- Keeps: permission data additions (re-assigned operational perms)
-- Reverts: audit triggers, audit_logs columns, RLS policy changes
-- ============================================================

BEGIN;

-- ── 1. Drop audit triggers (from 20260424000100) ─────────────

DROP TRIGGER IF EXISTS audit_employees         ON employees;
DROP TRIGGER IF EXISTS audit_salary_records    ON salary_records;
DROP TRIGGER IF EXISTS audit_payroll_records   ON payroll_records;
DROP TRIGGER IF EXISTS audit_leave_requests    ON leave_requests;
DROP TRIGGER IF EXISTS audit_overtime_requests ON overtime_requests;
DROP TRIGGER IF EXISTS audit_roles             ON roles;
DROP TRIGGER IF EXISTS audit_permissions       ON permissions;
DROP TRIGGER IF EXISTS audit_role_permissions  ON role_permissions;

DROP FUNCTION IF EXISTS audit_trigger_fn();

-- ── 2. Drop audit_logs RLS policy ────────────────────────────

DROP POLICY IF EXISTS "audit_select" ON audit_logs;

-- ── 3. Drop columns added to audit_logs ──────────────────────

ALTER TABLE audit_logs
  DROP COLUMN IF EXISTS old_data,
  DROP COLUMN IF EXISTS new_data,
  DROP COLUMN IF EXISTS user_email,
  DROP COLUMN IF EXISTS user_role,
  DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_audit_logs_email;
DROP INDEX IF EXISTS idx_audit_logs_org;
DROP INDEX IF EXISTS idx_audit_logs_table;

-- ── 4. Revert RLS: leave_requests UPDATE (remove manager) ────

DROP POLICY IF EXISTS "leave_update" ON leave_requests;

CREATE POLICY "leave_update" ON leave_requests FOR UPDATE USING (
  current_employee_role() IN ('admin', 'super_admin')
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);

-- ── 5. Revert RLS: overtime_requests UPDATE (remove manager) ─

DROP POLICY IF EXISTS "overtime_update" ON overtime_requests;

CREATE POLICY "overtime_update" ON overtime_requests FOR UPDATE USING (
  current_employee_role() IN ('admin', 'super_admin')
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);

COMMIT;
