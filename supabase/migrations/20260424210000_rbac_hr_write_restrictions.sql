-- ============================================================
-- Security Fix C-3 (partial): Role-based write restrictions on
-- sensitive HR tables.
--
-- PROBLEM: salary_records, payroll_records, and employees all had
-- blanket `FOR ALL TO authenticated USING (true)` policies (added
-- by 20260417000003_employees_rls_fix.sql). Any authenticated user
-- could INSERT / UPDATE / DELETE these rows regardless of role.
--
-- FIX:
--   salary_records   — INSERT/UPDATE/DELETE restricted to admin/super_admin
--   payroll_records  — INSERT/UPDATE/DELETE restricted to admin/super_admin
--                      (replaces the FOR ALL payroll_records_admin_write policy
--                       from 20260418000005 with per-operation policies so the
--                       SELECT path is unaffected)
--   employees        — INSERT/DELETE restricted to admin/super_admin
--                      UPDATE: employees may update their own row; admin/super_admin
--                      may update any row
--
-- current_employee_role() was created in 20260418000005_security_hardening.sql
-- and improved in 20260424100100_security_hardening.sql. Reused here.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. salary_records — write restricted to admin / super_admin
-- ────────────────────────────────────────────────────────────

ALTER TABLE salary_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salary_write_admin   ON salary_records;
DROP POLICY IF EXISTS salary_update_admin  ON salary_records;
DROP POLICY IF EXISTS salary_delete_admin  ON salary_records;

CREATE POLICY salary_write_admin ON salary_records
  FOR INSERT TO authenticated
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));

CREATE POLICY salary_update_admin ON salary_records
  FOR UPDATE TO authenticated
  USING  (current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));

CREATE POLICY salary_delete_admin ON salary_records
  FOR DELETE TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'));


-- ────────────────────────────────────────────────────────────
-- 2. payroll_records — replace blanket FOR ALL with per-operation
--    policies so SELECT remains open to self + admin (defined in
--    20260418000005) while writes are restricted explicitly.
-- ────────────────────────────────────────────────────────────

ALTER TABLE payroll_records ENABLE ROW LEVEL SECURITY;

-- Drop the old FOR ALL write policy from 20260418000005 so it does
-- not conflict with the new per-operation policies below.
DROP POLICY IF EXISTS "payroll_records_admin_write" ON payroll_records;

DROP POLICY IF EXISTS payroll_write_admin   ON payroll_records;
DROP POLICY IF EXISTS payroll_update_admin  ON payroll_records;
DROP POLICY IF EXISTS payroll_delete_admin  ON payroll_records;

CREATE POLICY payroll_write_admin ON payroll_records
  FOR INSERT TO authenticated
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));

CREATE POLICY payroll_update_admin ON payroll_records
  FOR UPDATE TO authenticated
  USING  (current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));

CREATE POLICY payroll_delete_admin ON payroll_records
  FOR DELETE TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'));


-- ────────────────────────────────────────────────────────────
-- 3. employees — INSERT/DELETE restricted to admin/super_admin;
--    UPDATE allows self-edit or admin/super_admin edit
-- ────────────────────────────────────────────────────────────

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employees_write_admin    ON employees;
DROP POLICY IF EXISTS employees_delete_admin   ON employees;
DROP POLICY IF EXISTS employees_self_update    ON employees;
DROP POLICY IF EXISTS employees_update_admin   ON employees;

-- Only admin / super_admin may create or delete employee records.
CREATE POLICY employees_write_admin ON employees
  FOR INSERT TO authenticated
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));

CREATE POLICY employees_delete_admin ON employees
  FOR DELETE TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'));

-- Any authenticated employee may update their own row.
-- Admin / super_admin may update any row (separate policy below).
CREATE POLICY employees_self_update ON employees
  FOR UPDATE TO authenticated
  USING     (email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  WITH CHECK (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Admin / super_admin override: unrestricted UPDATE on all rows.
CREATE POLICY employees_update_admin ON employees
  FOR UPDATE TO authenticated
  USING  (current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));


-- ────────────────────────────────────────────────────────────
-- 4. Safety net: ensure anon can never write to these tables
--    (belt-and-suspenders on top of 20260424100100 REVOKEs)
-- ────────────────────────────────────────────────────────────

REVOKE INSERT, UPDATE, DELETE ON salary_records, payroll_records FROM anon;

COMMIT;
