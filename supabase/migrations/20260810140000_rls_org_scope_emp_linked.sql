-- 多租戶強化(續):無 org 欄的表用 _emp_org(employee_id) DEFINER helper 綁 org — 2026-08-10
-- salary_adjustments/employee_line_accounts/line_users;event_outbox 系統表無 org 欄刻意不綁。已套用 live。

-- DEFINER helper:由 employee_id 安全取 org(不吃 employees RLS,免遞迴)
CREATE OR REPLACE FUNCTION public._emp_org(p_emp_id int) RETURNS int
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT organization_id FROM public.employees WHERE id = p_emp_id
$fn$;
GRANT EXECUTE ON FUNCTION public._emp_org(int) TO anon, authenticated, service_role;

ALTER POLICY salary_adjustments_self_w ON public.salary_adjustments
  USING (is_super_admin() OR (auth.role() = 'service_role') OR ((is_admin() OR is_hr_staff()) AND _emp_org(employee_id) = current_user_org_id()))
  WITH CHECK (is_super_admin() OR (auth.role() = 'service_role') OR ((is_admin() OR is_hr_staff()) AND _emp_org(employee_id) = current_user_org_id()));

ALTER POLICY employee_line_accounts_self_w ON public.employee_line_accounts
  USING (is_super_admin() OR (auth.role() = 'service_role') OR ((is_admin() OR is_hr_staff()) AND _emp_org(employee_id) = current_user_org_id()))
  WITH CHECK (is_super_admin() OR (auth.role() = 'service_role') OR ((is_admin() OR is_hr_staff()) AND _emp_org(employee_id) = current_user_org_id()));

ALTER POLICY line_users_self_w ON public.line_users
  USING (is_super_admin() OR (auth.role() = 'service_role') OR ((is_admin() OR is_hr_staff()) AND (employee_id IS NULL OR _emp_org(employee_id) = current_user_org_id())))
  WITH CHECK (is_super_admin() OR (auth.role() = 'service_role') OR ((is_admin() OR is_hr_staff()) AND (employee_id IS NULL OR _emp_org(employee_id) = current_user_org_id())));
