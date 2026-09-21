-- LIFF 端:申請人在「已完成」關駁回工單(打回重做)
--   對齊 liff_confirm/reject_work_order:line user → 員工 → 呼叫 _wo_reopen
CREATE OR REPLACE FUNCTION public.liff_reopen_work_order(p_line_user_id text, p_id integer, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  RETURN public._wo_reopen(p_id, emp.id, p_reason);
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_reopen_work_order(text, integer, text) TO anon, authenticated;
