-- 排班:課督導可排「自己本店」全員(不只自己) — 2026-07-22
-- 取代 20260722130000(那版只放自己那列)。需求升級:總部 3 位督導(張庭瑋/羅紹輝/黃蘊珊,本店皆威耀總部)
--   要能「互相排」→ 放寬成「課督導可寫自己本店(employees.store_id)所有人的班列」。
--   既有規則(店長/督導管自己門市員工 can_manage_emp_store)不動,只多這條 OR。不開放一般店員。
-- 通用:任何課督導對「自己本店全員」皆適用,以後新增督導自動生效。

BEGIN;

CREATE OR REPLACE FUNCTION public.supervisor_can_schedule_emp(p_emp_id int, p_emp_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me        int := current_employee_id();
  v_my_store  int;
  v_tgt_store int;
BEGIN
  IF v_me IS NULL THEN RETURN false; END IF;
  -- 本人必須是「課督導」(department_sections.supervisor_id = 我)
  IF NOT EXISTS (SELECT 1 FROM public.department_sections ds WHERE ds.supervisor_id = v_me) THEN
    RETURN false;
  END IF;
  -- 我的本店
  SELECT store_id INTO v_my_store FROM public.employees WHERE id = v_me;
  IF v_my_store IS NULL THEN RETURN false; END IF;
  -- 被排員工的門市(schedules 常用姓名、employee_id 可能空 → id 優先、姓名 fallback)
  SELECT COALESCE(
    (SELECT store_id FROM public.employees WHERE id = p_emp_id),
    (SELECT store_id FROM public.employees WHERE name = p_emp_name AND status = '在職' ORDER BY id LIMIT 1)
  ) INTO v_tgt_store;
  -- 同本店 → 可排
  RETURN v_tgt_store IS NOT NULL AND v_tgt_store = v_my_store;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_can_schedule_emp(int, text) TO authenticated, anon;

-- 寫入 policy:店長/督導管門市員工 OR 課督導排自己本店全員
DROP POLICY IF EXISTS schedules_v_write ON public.schedules;
CREATE POLICY schedules_v_write ON public.schedules FOR ALL
  USING (
    public.can_manage_emp_store(employee_id, employee)
    OR public.supervisor_can_schedule_emp(employee_id, employee)
  )
  WITH CHECK (
    public.can_manage_emp_store(employee_id, employee)
    OR public.supervisor_can_schedule_emp(employee_id, employee)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
