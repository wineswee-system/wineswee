-- 根治薪資「重複」:salary_structures 定為唯一真理源,employees 的 5 個薪資欄改成「自動鏡射」自 salary_structures。
-- 從此不管誰改 salary_structures(表單/異動/薪資調整 RPC),employees 立刻同步 → 不可能再分歧。
-- 只單向鏡射(ss→employees);計薪引擎本來就 salary_structures 優先。不砍 employees 欄(避免大量讀取點壞掉)。
-- IS DISTINCT 守門:值沒變不空跑 UPDATE(避免多餘的 employees 觸發器/position_history 記錄)。
CREATE OR REPLACE FUNCTION public._sync_employee_salary_from_structure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.employees SET
    base_salary         = NEW.base_salary,
    hourly_rate         = NEW.hourly_rate,
    salary_type         = NEW.salary_type,
    meal_allowance      = NEW.meal_allowance,
    transport_allowance = NEW.transport_allowance
  WHERE id = NEW.employee_id
    AND ( base_salary         IS DISTINCT FROM NEW.base_salary
       OR hourly_rate         IS DISTINCT FROM NEW.hourly_rate
       OR salary_type         IS DISTINCT FROM NEW.salary_type
       OR meal_allowance      IS DISTINCT FROM NEW.meal_allowance
       OR transport_allowance IS DISTINCT FROM NEW.transport_allowance );
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_employee_salary_from_structure ON public.salary_structures;
CREATE TRIGGER trg_sync_employee_salary_from_structure
  AFTER INSERT OR UPDATE OF base_salary, hourly_rate, salary_type, meal_allowance, transport_allowance
  ON public.salary_structures
  FOR EACH ROW EXECUTE FUNCTION public._sync_employee_salary_from_structure();

-- 一次性對齊既有(有 ss 的員工),確保起點一致(目前 0 分歧→大多無動作)
UPDATE public.employees e SET
  base_salary         = ss.base_salary,
  hourly_rate         = ss.hourly_rate,
  salary_type         = ss.salary_type,
  meal_allowance      = ss.meal_allowance,
  transport_allowance = ss.transport_allowance
FROM public.salary_structures ss
WHERE ss.employee_id = e.id
  AND ( e.base_salary         IS DISTINCT FROM ss.base_salary
     OR e.hourly_rate         IS DISTINCT FROM ss.hourly_rate
     OR e.salary_type         IS DISTINCT FROM ss.salary_type
     OR e.meal_allowance      IS DISTINCT FROM ss.meal_allowance
     OR e.transport_allowance IS DISTINCT FROM ss.transport_allowance );
