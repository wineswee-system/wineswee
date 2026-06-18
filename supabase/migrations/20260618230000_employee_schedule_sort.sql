-- ════════════════════════════════════════════════════════════════════════════
-- 排班員工顯示順序：可拖拉調整並保存(schedule_sort)
-- 2026-06-18
--
-- 需求:排班頁選完門市後,要能調整員工列的顯示順序並存起來(下次打開不變)。
-- schedule_sort = 顯示順序(每店各自 1..N),跟演算法用的 schedule_priority 分開。
--
-- - ADD COLUMN schedule_sort + 回填(每店按姓名 1..N,維持目前順序)
-- - reorder_employees(p_emp_ids int[]) RPC:依陣列順序設 schedule_sort=位置;
--   SECURITY DEFINER + 只允許「能管理該員工門市的人」(can_manage_emp_store)改 → 店長/課督導/admin
--
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS schedule_sort int;

-- 回填:每店按姓名給 1..N(沒設過的才填,維持現狀順序)
UPDATE public.employees e SET schedule_sort = sub.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY store ORDER BY name) AS rn
      FROM public.employees
  ) sub
 WHERE e.id = sub.id AND e.schedule_sort IS NULL;

-- 依傳入順序重設 schedule_sort（前端拖拉後傳該店新順序的 emp id 陣列）
CREATE OR REPLACE FUNCTION public.reorder_employees(p_emp_ids int[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE i int;
BEGIN
  IF p_emp_ids IS NULL THEN RETURN; END IF;
  FOR i IN 1 .. array_length(p_emp_ids, 1) LOOP
    -- 只允許能管理該員工門市的人(店長/課督導/admin)調整
    IF can_manage_emp_store(p_emp_ids[i], NULL) THEN
      UPDATE public.employees SET schedule_sort = i WHERE id = p_emp_ids[i];
    END IF;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.reorder_employees(int[]) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
