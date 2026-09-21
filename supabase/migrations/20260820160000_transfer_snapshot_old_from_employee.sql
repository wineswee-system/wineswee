-- 修:人事異動「原本(old_*)」空白 —— 前端靠 selectedEmp 帶 old_*,某些路徑(如自助/LIFF)selectedEmp 空 → old 全 NULL;
--   且前端 payload 根本沒有 old_base_salary(永遠 NULL)。
-- 治本:建立當下由後端從員工現況快照 old_*(COALESCE:前端有帶就尊重,沒帶才補)。web/LIFF 任何路徑都涵蓋。
CREATE OR REPLACE FUNCTION public._transfer_fill_old_from_employee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_emp public.employees;
BEGIN
  IF NEW.employee_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = NEW.employee_id;
  IF v_emp.id IS NOT NULL THEN
    NEW.old_department_id := COALESCE(NEW.old_department_id, v_emp.department_id);
    NEW.old_store_id      := COALESCE(NEW.old_store_id,      v_emp.store_id);
    NEW.old_position      := COALESCE(NEW.old_position,      v_emp.position);
    NEW.old_base_salary   := COALESCE(NEW.old_base_salary,   v_emp.base_salary);
    NEW.old_role          := COALESCE(NEW.old_role,          v_emp.role);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_transfer_fill_old_from_employee ON public.personnel_transfer_requests;
CREATE TRIGGER trg_transfer_fill_old_from_employee
  BEFORE INSERT ON public.personnel_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public._transfer_fill_old_from_employee();
