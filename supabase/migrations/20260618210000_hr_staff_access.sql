-- ════════════════════════════════════════════════════════════════════════════
-- HR 人員(人力資源部)不靠 admin role 也能管全公司 HR 資料
-- 2026-06-18
--
-- 背景：陳楷仁/尤致皓/張啟達(人力資源部)將從 admin 退成 manager。但他們的工作是「全公司
--   HR」(合約/外勞/資遣/調薪/LINE 綁定/各種申請處理)。若只靠 role，退成 manager 後會被
--   can_see_request(只看自己課/店/鏈)擋住 → HR 工作做不了。違反「職責範圍要能運作」。
--
-- 解法：access 跟「職責(人資部)」走，不是 role。新增 is_hr_staff()(= admin / service /
--   人力資源部成員)，折進 can_see_request + can_see_own，並補進 HR 敏感表(調薪/資遣/LINE)
--   的寫政策。這樣 HR 人員不管 role 是 admin 還 manager 都能管全公司 HR。
--
-- 註:張庭瑋(營運部經理)退成 manager 後靠主管鏈看整個營運即可,不需 HR 存取,不在此列。
-- idempotent：CREATE OR REPLACE + 重建相關寫 policy。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 是否為 HR 人員（人力資源部 / admin / service）
CREATE OR REPLACE FUNCTION public.is_hr_staff()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_admin() THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM employees me
      JOIN departments d ON d.id = me.department_id
     WHERE me.id = current_employee_id() AND d.name = '人力資源部'
  );
END $$;
GRANT EXECUTE ON FUNCTION public.is_hr_staff() TO authenticated, anon;

-- can_see_request：加 HR 人員看得到全公司(申請/個人 HR 記錄/班表/任務 assignee 分支)
CREATE OR REPLACE FUNCTION public.can_see_request(p_applicant_emp_id int)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me        int := current_employee_id();
  v_my_org    int;
  v_app_org   int;
  v_app_store int;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF v_me IS NULL OR p_applicant_emp_id IS NULL THEN RETURN false; END IF;
  IF p_applicant_emp_id = v_me THEN RETURN true; END IF;          -- 本人

  SELECT organization_id INTO v_my_org  FROM employees WHERE id = v_me;
  SELECT organization_id, store_id INTO v_app_org, v_app_store FROM employees WHERE id = p_applicant_emp_id;
  IF v_app_org IS DISTINCT FROM v_my_org THEN RETURN false; END IF; -- 跨 org 不可見

  IF is_admin() THEN RETURN true; END IF;                          -- admin
  IF is_hr_staff() THEN RETURN true; END IF;                       -- HR 人員(全公司 HR)

  -- 申請人門市的店長
  IF v_app_store IS NOT NULL AND EXISTS (
    SELECT 1 FROM stores s WHERE s.id = v_app_store AND s.manager_id = v_me
  ) THEN RETURN true; END IF;
  -- 申請人門市所屬課的督導/課長
  IF v_app_store IS NOT NULL AND EXISTS (
    SELECT 1 FROM stores st JOIN department_sections ds ON ds.id = st.section_id
     WHERE st.id = v_app_store AND ds.supervisor_id = v_me
  ) THEN RETURN true; END IF;
  -- 我在申請人的直屬主管鏈上
  RETURN EXISTS (
    WITH RECURSIVE chain(id, supervisor_id, depth) AS (
      SELECT e.id, e.supervisor_id, 1 FROM employees e WHERE e.id = p_applicant_emp_id
      UNION ALL
      SELECT e.id, e.supervisor_id, c.depth + 1
        FROM employees e JOIN chain c ON e.id = c.supervisor_id
       WHERE c.depth < 20 AND c.supervisor_id IS NOT NULL
    )
    SELECT 1 FROM chain WHERE supervisor_id = v_me
  );
END $$;

-- can_see_own：高敏個資(調薪/資遣/LINE)→ 本人 + admin + HR 人員
CREATE OR REPLACE FUNCTION public.can_see_own(p_emp_id bigint)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_admin() THEN RETURN true; END IF;
  IF is_hr_staff() THEN RETURN true; END IF;
  RETURN p_emp_id IS NOT NULL AND p_emp_id = current_employee_id();
END $$;

-- PERSON_SELF 寫政策(salary_adjustments/severance_records/line_users/employee_line_accounts)
-- 從 admin-only → admin / service / HR 人員
DO $$
DECLARE tbls text[] := ARRAY['salary_adjustments','severance_records','line_users','employee_line_accounts']; i int; t text;
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_self_w', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (is_admin() OR auth.role()=''service_role'' OR is_hr_staff()) WITH CHECK (is_admin() OR auth.role()=''service_role'' OR is_hr_staff())', t||'_self_w', t);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
