-- ════════════════════════════════════════════════════════════
-- RLS: 為 9 個還在 email-only 比對的 policy 加 auth_user_id OR 分支
--
-- 延續 20260429000011 的 pattern（當時只修了 employees + is_admin)。
-- 現在把同樣的 OR-branch 加到 employees 「自己擁有的資料」這類 policy。
--
-- 原本：
--   employee = (SELECT name FROM employees WHERE email = jwt.email LIMIT 1)
-- 改後：
--   employee = (SELECT name FROM employees
--               WHERE auth_user_id = auth.uid() OR email = jwt.email
--               ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
--               LIMIT 1)
--
-- 嚴格只「加分支」，不刪原條件 → 原本 email match 通的還是通，多
-- auth_user_id match 也通。Risk 等同於 2026-04-29 那次。
--
-- 適用 9 個 policy：
--   attendance_records.attendance_select
--   clock_corrections.clock_corrections_select
--   leave_balances.leave_bal_select       (用 employee_id → current_employee_id())
--   leave_requests.leave_select
--   off_requests.off_requests_select
--   off_requests.off_requests_update
--   overtime_requests.overtime_select
--   salary_records.salary_select
--   schedules.schedules_select            (多一個 manager 分支也保留)
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── helper：解 current employee name（給 employee-name-based policy 用） ──
CREATE OR REPLACE FUNCTION public.current_employee_name()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT name FROM public.employees
  WHERE auth_user_id = auth.uid()
     OR email = (auth.jwt() ->> 'email')
  ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.current_employee_name() TO authenticated, anon;


-- ═══ 1. attendance_records ═══
DROP POLICY IF EXISTS attendance_select ON public.attendance_records;
CREATE POLICY attendance_select ON public.attendance_records
FOR SELECT USING (
  current_employee_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])
  OR employee = current_employee_name()
);


-- ═══ 2. clock_corrections ═══
DROP POLICY IF EXISTS clock_corrections_select ON public.clock_corrections;
CREATE POLICY clock_corrections_select ON public.clock_corrections
FOR SELECT USING (
  is_admin()
  OR employee = current_employee_name()
);


-- ═══ 3. leave_balances（用 employee_id） ═══
DROP POLICY IF EXISTS leave_bal_select ON public.leave_balances;
CREATE POLICY leave_bal_select ON public.leave_balances
FOR SELECT USING (
  is_admin()
  OR employee_id = current_employee_id()
);


-- ═══ 4. leave_requests ═══
DROP POLICY IF EXISTS leave_select ON public.leave_requests;
CREATE POLICY leave_select ON public.leave_requests
FOR SELECT USING (
  current_employee_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])
  OR employee = current_employee_name()
);


-- ═══ 5. off_requests SELECT ═══
DROP POLICY IF EXISTS off_requests_select ON public.off_requests;
CREATE POLICY off_requests_select ON public.off_requests
FOR SELECT USING (
  is_admin()
  OR employee = current_employee_name()
);


-- ═══ 6. off_requests UPDATE ═══
DROP POLICY IF EXISTS off_requests_update ON public.off_requests;
CREATE POLICY off_requests_update ON public.off_requests
FOR UPDATE USING (
  is_admin()
  OR employee = current_employee_name()
);


-- ═══ 7. overtime_requests ═══
DROP POLICY IF EXISTS overtime_select ON public.overtime_requests;
CREATE POLICY overtime_select ON public.overtime_requests
FOR SELECT USING (
  current_employee_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])
  OR employee = current_employee_name()
);


-- ═══ 8. salary_records ═══
DROP POLICY IF EXISTS salary_select ON public.salary_records;
CREATE POLICY salary_select ON public.salary_records
FOR SELECT USING (
  current_employee_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])
  OR employee = current_employee_name()
);


-- ═══ 9. schedules — 三條件 OR（admin / 本人 / manager 同店） ═══
-- 原本第 3 條件用 me.email = jwt.email 找出 manager 自己；改成也支援 auth_user_id
DROP POLICY IF EXISTS schedules_select ON public.schedules;
CREATE POLICY schedules_select ON public.schedules
FOR SELECT USING (
  is_admin()
  OR employee = current_employee_name()
  OR EXISTS (
    SELECT 1
      FROM public.employees me
      JOIN public.roles r ON me.role_id = r.id
     WHERE (me.auth_user_id = auth.uid() OR me.email = (auth.jwt() ->> 'email'))
       AND r.name = 'manager'
       AND me.store = (SELECT store FROM public.employees WHERE name = schedules.employee LIMIT 1)
  )
);


COMMIT;

NOTIFY pgrst, 'reload schema';
