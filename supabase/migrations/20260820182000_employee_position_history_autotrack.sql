-- Plan B Phase4:讓 point-in-time 長期不歪 —— employees 任何 store/職位/底薪/部門變動都自動記 position_history。
-- ①新進員工建檔補基準列。②主檔變動記一列(effective=今天)。
-- 去重:異動 trigger / process_effective_transfers cron 會先寫「今天生效」的 position_history 才 UPDATE employees,
--   本 trigger 遇到「今天已有列」就跳過,避免重複。close 只結束「今天(含)以前生效」的開放列,不動未來排定的異動列。
CREATE OR REPLACE FUNCTION public._trg_employee_position_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = '在職'
       AND NOT EXISTS (SELECT 1 FROM public.position_history WHERE employee_id = NEW.id) THEN
      INSERT INTO public.position_history
        (employee_id, organization_id, effective_date, end_date, department_id, store_id, position, base_salary, role, change_type, reason)
      VALUES (NEW.id, NEW.organization_id, COALESCE(NEW.join_date, CURRENT_DATE), NULL,
              NEW.department_id, NEW.store_id, NEW.position, NEW.base_salary, NEW.role, 'baseline', '新進基準');
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE:只在門市/部門/職位/底薪其一有變才記
  IF NEW.store_id      IS DISTINCT FROM OLD.store_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.position      IS DISTINCT FROM OLD.position
     OR NEW.base_salary   IS DISTINCT FROM OLD.base_salary THEN
    -- 異動/cron 已寫今天生效的列 → 跳過(去重)
    IF NOT EXISTS (SELECT 1 FROM public.position_history
                    WHERE employee_id = NEW.id AND effective_date = CURRENT_DATE) THEN
      UPDATE public.position_history
         SET end_date = CURRENT_DATE - 1
       WHERE employee_id = NEW.id AND end_date IS NULL AND effective_date <= CURRENT_DATE;
      INSERT INTO public.position_history
        (employee_id, organization_id, effective_date, end_date, department_id, store_id, position, base_salary, role, change_type, reason)
      VALUES (NEW.id, NEW.organization_id, CURRENT_DATE, NULL,
              NEW.department_id, NEW.store_id, NEW.position, NEW.base_salary, NEW.role, 'manual', '主檔變更');
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_employee_position_history ON public.employees;
CREATE TRIGGER trg_employee_position_history
  AFTER INSERT OR UPDATE OF store_id, department_id, position, base_salary ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public._trg_employee_position_history();
