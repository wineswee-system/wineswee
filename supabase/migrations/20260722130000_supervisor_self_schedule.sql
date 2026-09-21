-- 排班:課督導可以排「自己的班」— 2026-07-22
-- 需求:總部(威耀總部 store20)無店長排班對象、也沒歸到任何課,督導(張庭瑋/羅紹輝/黃蘊珊,
--   皆為 department_sections.supervisor_id)想排自己的班存不了 → 寫 schedules 被 RLS 擋成空白。
--   規則:督導的班自己排。加一條「本人是課督導 → 可寫自己的班列」,加在既有 schedules_v_write 之上。
--   既有規則(店長/督導管自己門市員工)不動;只多放「課督導寫自己那列」,不開放一般店員自排。
-- 對齊 [[project_schedule_permission_model]] / 20260618200000_schedule_write_for_managers。

BEGIN;

CREATE OR REPLACE FUNCTION public.is_supervisor_self_schedule(p_emp_id int, p_emp_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me int := current_employee_id();
BEGIN
  IF v_me IS NULL THEN RETURN false; END IF;
  -- 必須是「本人的班列」(schedules 常用姓名、employee_id 可能為空 → 兩者擇一符合)
  IF NOT EXISTS (
    SELECT 1 FROM public.employees e
     WHERE e.id = v_me AND (e.id = p_emp_id OR e.name = p_emp_name)
  ) THEN
    RETURN false;
  END IF;
  -- 且本人是「課督導」(department_sections.supervisor_id = 我)
  RETURN EXISTS (SELECT 1 FROM public.department_sections ds WHERE ds.supervisor_id = v_me);
END $$;

GRANT EXECUTE ON FUNCTION public.is_supervisor_self_schedule(int, text) TO authenticated, anon;

-- 寫入 policy 加 OR「課督導寫自己的班」
DROP POLICY IF EXISTS schedules_v_write ON public.schedules;
CREATE POLICY schedules_v_write ON public.schedules FOR ALL
  USING (
    public.can_manage_emp_store(employee_id, employee)
    OR public.is_supervisor_self_schedule(employee_id, employee)
  )
  WITH CHECK (
    public.can_manage_emp_store(employee_id, employee)
    OR public.is_supervisor_self_schedule(employee_id, employee)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
