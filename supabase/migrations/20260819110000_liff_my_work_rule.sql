-- LIFF 打卡紀錄要判「行政(admin)」遲到/早退需要員工身分 + 固定辦公時間規則 — 2026-08-19
-- 回 {category, work_start, work_end, grace_minutes};anon(line_user_id)走 DEFINER。
CREATE OR REPLACE FUNCTION public.liff_my_work_rule(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_emp  employees;
  v_cat  text;
  v_rule employment_category_work_rules;
BEGIN
  SELECT e.* INTO v_emp
    FROM public.employees e
    JOIN public.employee_line_accounts ela ON ela.employee_id = e.id
   WHERE ela.line_user_id = p_line_user_id
   LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;

  SELECT employment_category INTO v_cat
    FROM public.salary_structures WHERE employee_id = v_emp.id ORDER BY id DESC LIMIT 1;

  SELECT * INTO v_rule
    FROM public.employment_category_work_rules
   WHERE category = v_cat AND organization_id = v_emp.organization_id AND is_active
   LIMIT 1;

  RETURN json_build_object(
    'category',      v_cat,
    'work_start',    v_rule.work_start,
    'work_end',      v_rule.work_end,
    'grace_minutes', v_rule.grace_minutes
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_my_work_rule(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
