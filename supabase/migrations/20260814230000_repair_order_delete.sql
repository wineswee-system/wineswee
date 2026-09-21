-- 2026-08-14 維修單:刪除(軟刪 deleted_at,可救回;開單人或 admin;前端先 confirm)。
--   與「作廢(_ro_cancel→已取消,保留紀錄)」分工:刪除=從清單移除(開錯單)。

CREATE OR REPLACE FUNCTION public._ro_delete(p_id int, p_actor int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ro public.repair_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_ro FROM public.repair_orders WHERE id = p_id;
  IF v_ro.id IS NULL OR v_ro.deleted_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (public._wo_actor_is_admin(p_actor) OR v_ro.requester_id = p_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  UPDATE public.repair_orders SET deleted_at = now(), updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.delete_repair_order(p_id int)
 RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public._ro_delete(p_id, public.current_employee_id()); $function$;

CREATE OR REPLACE FUNCTION public.liff_delete_repair_order(p_line_user_id text, p_id int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  RETURN public._ro_delete(p_id, emp.id);
END $function$;

REVOKE ALL ON FUNCTION public.delete_repair_order(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_repair_order(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liff_delete_repair_order(text,int) TO anon, authenticated;
