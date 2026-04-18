-- ============================================================
-- 安全加固：RLS 收緊 + 敏感表保護
-- 2026-04-18
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- SECTION 1: 薪資相關表 — 僅 admin/super_admin 可操作
-- ═══════════════════════════════════════════════════════════

-- 建立角色檢查函式
CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM employees
  WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id FROM employees
  WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
  LIMIT 1;
$$;

-- ── payroll_records: 員工只能看自己，admin 看全部 ──
DROP POLICY IF EXISTS "allow_all_payroll_records" ON public.payroll_records;
CREATE POLICY "payroll_records_self_or_admin" ON public.payroll_records
  FOR SELECT TO authenticated
  USING (
    employee_id = current_employee_id()
    OR current_employee_role() IN ('admin', 'super_admin')
  );
CREATE POLICY "payroll_records_admin_write" ON public.payroll_records
  FOR ALL TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));

-- ── payroll_runs: 僅 admin ──
DROP POLICY IF EXISTS "allow_all_payroll_runs" ON public.payroll_runs;
CREATE POLICY "payroll_runs_admin" ON public.payroll_runs
  FOR ALL TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));

-- ── salary_structures: 員工只能看自己，admin 可改 ──
DROP POLICY IF EXISTS "allow_all_salary_structures" ON public.salary_structures;
CREATE POLICY "salary_structures_self_or_admin" ON public.salary_structures
  FOR SELECT TO authenticated
  USING (
    employee_id = current_employee_id()
    OR current_employee_role() IN ('admin', 'super_admin')
  );
CREATE POLICY "salary_structures_admin_write" ON public.salary_structures
  FOR ALL TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));

-- ── leave_balances: 員工看自己，主管看部門，admin 看全部 ──
DROP POLICY IF EXISTS "allow_all_leave_balances" ON public.leave_balances;
CREATE POLICY "leave_balances_self_or_admin" ON public.leave_balances
  FOR SELECT TO authenticated
  USING (
    employee_id = current_employee_id()
    OR current_employee_role() IN ('admin', 'super_admin', 'manager')
  );
CREATE POLICY "leave_balances_admin_write" ON public.leave_balances
  FOR ALL TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));

-- ── 勞健保級距表: 所有人可讀，僅 admin 可改 ──
DROP POLICY IF EXISTS "allow_all_labor_ins_brackets" ON public.labor_ins_brackets;
DROP POLICY IF EXISTS "allow_all_health_ins_brackets" ON public.health_ins_brackets;
CREATE POLICY "labor_ins_brackets_read" ON public.labor_ins_brackets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "labor_ins_brackets_admin_write" ON public.labor_ins_brackets
  FOR ALL TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));
CREATE POLICY "health_ins_brackets_read" ON public.health_ins_brackets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "health_ins_brackets_admin_write" ON public.health_ins_brackets
  FOR ALL TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));

-- ── approval_chains: 所有人可讀，僅 admin 可改 ──
DROP POLICY IF EXISTS "allow_all_approval_chains" ON public.approval_chains;
CREATE POLICY "approval_chains_read" ON public.approval_chains
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "approval_chains_admin_write" ON public.approval_chains
  FOR ALL TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin'));


-- ═══════════════════════════════════════════════════════════
-- SECTION 2: LINE 表 — service_role 完整存取，authenticated 唯讀
-- Edge Functions 用 service_role_key 所以不受 RLS 限制
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "allow_all_line_users" ON public.line_users;
DROP POLICY IF EXISTS "allow_all_line_groups" ON public.line_groups;
DROP POLICY IF EXISTS "allow_all_line_group_members" ON public.line_group_members;
DROP POLICY IF EXISTS "allow_all_line_messages" ON public.line_messages;
DROP POLICY IF EXISTS "allow_all_line_command_logs" ON public.line_command_logs;
DROP POLICY IF EXISTS "allow_all_line_error_logs" ON public.line_error_logs;

-- line_users: 員工只能看自己的 LINE 綁定，admin 看全部
CREATE POLICY "line_users_self_or_admin" ON public.line_users
  FOR SELECT TO authenticated
  USING (
    employee_id = current_employee_id()
    OR current_employee_role() IN ('admin', 'super_admin')
  );

-- line_groups / line_messages / logs: 僅 admin 可透過前端查看
CREATE POLICY "line_groups_admin" ON public.line_groups
  FOR SELECT TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'));
CREATE POLICY "line_group_members_admin" ON public.line_group_members
  FOR SELECT TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'));
CREATE POLICY "line_messages_admin" ON public.line_messages
  FOR SELECT TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'));
CREATE POLICY "line_command_logs_admin" ON public.line_command_logs
  FOR SELECT TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'));
CREATE POLICY "line_error_logs_admin" ON public.line_error_logs
  FOR SELECT TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin'));

-- ═══════════════════════════════════════════════════════════
-- SECTION 3: workflow_instance_line_group_assignments
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "allow_all_wf_line_groups" ON public.workflow_instance_line_group_assignments;
CREATE POLICY "wf_line_groups_admin" ON public.workflow_instance_line_group_assignments
  FOR ALL TO authenticated
  USING (current_employee_role() IN ('admin', 'super_admin', 'manager'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin', 'manager'));


-- ═══════════════════════════════════════════════════════════
-- SECTION 4: REVOKE 敏感表的 anon 直接存取
-- Edge Functions 用 service_role_key 不受影響
-- ═══════════════════════════════════════════════════════════

REVOKE INSERT, UPDATE, DELETE ON public.payroll_records FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payroll_runs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.salary_structures FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.leave_balances FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.line_users FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.line_messages FROM anon;

COMMIT;
