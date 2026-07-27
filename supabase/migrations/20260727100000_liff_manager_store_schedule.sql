-- LIFF「我的班表→全店」主管可選門市看班表 — 2026-07-27
-- ════════════════════════════════════════════════════════════════════════════
-- MySchedule 全店班表原本只看自己店(liff_list_store_schedules=e.store_id=me.store_id)。
-- 加兩支給主管選店:
--   liff_manager_view_stores:回主管可看的門市清單(admin/schedule.view_all→全公司;
--     督導課/店長多店/自己店→_can_see_store_for_emp)。自己店排最前。
--   liff_view_store_schedule:回選定門市的班表 + 可見性檢查(同上,看不到回[])。
-- 前端:全店模式若可看>1店→顯示門市下拉;選店走 liff_view_store_schedule。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_manager_view_stores(p_line_user_id text)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me employees; v_is_admin boolean; v_see_all boolean; r json;
BEGIN
  SELECT * INTO me FROM public._liff_resolve_employee(p_line_user_id);
  IF me.id IS NULL THEN RETURN '[]'::json; END IF;
  v_is_admin := EXISTS (SELECT 1 FROM roles ro WHERE ro.id = me.role_id AND ro.name IN ('admin','super_admin'));
  v_see_all  := v_is_admin OR public.liff_employee_has_permission(me.id, 'schedule.view_all');
  SELECT json_agg(json_build_object('id', s.id, 'name', s.name)
                  ORDER BY (s.id = me.store_id) DESC, s.name)
    INTO r
  FROM public.stores s
  WHERE s.organization_id = me.organization_id
    AND (v_see_all OR public._can_see_store_for_emp(me.id::bigint, s.id::bigint));
  RETURN COALESCE(r, '[]'::json);
END $function$;

CREATE OR REPLACE FUNCTION public.liff_view_store_schedule(p_line_user_id text, p_store_id integer, p_start date, p_end date)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me employees; v_is_admin boolean; v_ok boolean; r json;
BEGIN
  SELECT * INTO me FROM public._liff_resolve_employee(p_line_user_id);
  IF me.id IS NULL THEN RETURN '[]'::json; END IF;
  v_is_admin := EXISTS (SELECT 1 FROM roles ro WHERE ro.id = me.role_id AND ro.name IN ('admin','super_admin'));
  v_ok := v_is_admin
          OR public.liff_employee_has_permission(me.id, 'schedule.view_all')
          OR public._can_see_store_for_emp(me.id::bigint, p_store_id::bigint);
  IF NOT v_ok THEN RETURN '[]'::json; END IF;   -- 看不到就空,不外洩別店
  SELECT COALESCE(json_agg(row_to_json(s.*) ORDER BY s.date, s.employee), '[]'::json) INTO r
  FROM public.schedules s
  WHERE s.date >= p_start AND s.date <= p_end
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE ((s.employee_id IS NOT NULL AND e.id = s.employee_id)
             OR (s.employee_id IS NULL AND e.name = s.employee))
        AND e.store_id = p_store_id
    );
  RETURN r;
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_manager_view_stores(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.liff_view_store_schedule(text, integer, date, date) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
