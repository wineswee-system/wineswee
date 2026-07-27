-- 「看全公司」改資料驅動:營運部經理自動繼承 + 集中式 helper — 2026-07-27
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:換營運經理要自動更新「看全公司」,不用手動開 schedule.view_all。
-- 做法:departments.oversees_all_stores 旗標(標營運部)→ 該部門「經理」自動看全公司(照 manager_id,
--   換經理自動繼承)。督導多人本來就自動(各課 supervisor_id)。
-- 集中式 helper _emp_sees_all_stores = admin/super_admin OR schedule.view_all(個人override保留)
--   OR 是「oversees_all_stores 部門」的經理。把散在 RLS/RPC 的「看全部」判斷收斂成一支,以後改一處。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS oversees_all_stores boolean NOT NULL DEFAULT false;
UPDATE public.departments SET oversees_all_stores = true WHERE name = '營運部';

CREATE OR REPLACE FUNCTION public._emp_sees_all_stores(p_emp_id integer)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p_emp_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.employees e JOIN public.roles r ON r.id = e.role_id
             WHERE e.id = p_emp_id AND r.name IN ('admin','super_admin'))
    OR public.liff_employee_has_permission(p_emp_id, 'schedule.view_all')
    OR EXISTS (SELECT 1 FROM public.departments d WHERE d.manager_id = p_emp_id AND d.oversees_all_stores)
  );
$function$;
GRANT EXECUTE ON FUNCTION public._emp_sees_all_stores(integer) TO anon, authenticated, service_role;

-- RLS:寫入 + 鎖定可見,改用集中 helper(含營運部經理)
ALTER POLICY schedules_v_write ON public.schedules
  USING (can_manage_emp_store(employee_id, employee) OR supervisor_can_schedule_emp(employee_id, employee) OR public._emp_sees_all_stores(current_employee_id()))
  WITH CHECK (can_manage_emp_store(employee_id, employee) OR supervisor_can_schedule_emp(employee_id, employee) OR public._emp_sees_all_stores(current_employee_id()));
ALTER POLICY schedule_month_locks_st_sel ON public.schedule_month_locks
  USING (can_see_store((store_id)::bigint) OR public._emp_sees_all_stores(current_employee_id()));

-- LIFF 主管選店:改用集中 helper
CREATE OR REPLACE FUNCTION public.liff_manager_view_stores(p_line_user_id text)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me employees; v_see_all boolean; r json;
BEGIN
  SELECT * INTO me FROM public._liff_resolve_employee(p_line_user_id);
  IF me.id IS NULL THEN RETURN '[]'::json; END IF;
  v_see_all := public._emp_sees_all_stores(me.id);
  SELECT json_agg(json_build_object('id', s.id, 'name', s.name)
                  ORDER BY (s.id = me.store_id) DESC, s.name)
    INTO r
  FROM public.stores s
  WHERE s.organization_id = me.organization_id
    AND (v_see_all OR public._can_see_store_for_emp(me.id::bigint, s.id::bigint));
  RETURN COALESCE(r, '[]'::json);
END $function$;
GRANT EXECUTE ON FUNCTION public.liff_manager_view_stores(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.liff_view_store_schedule(p_line_user_id text, p_store_id integer, p_start date, p_end date)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me employees; v_ok boolean; r json;
BEGIN
  SELECT * INTO me FROM public._liff_resolve_employee(p_line_user_id);
  IF me.id IS NULL THEN RETURN '[]'::json; END IF;
  v_ok := public._emp_sees_all_stores(me.id) OR public._can_see_store_for_emp(me.id::bigint, p_store_id::bigint);
  IF NOT v_ok THEN RETURN '[]'::json; END IF;
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
GRANT EXECUTE ON FUNCTION public.liff_view_store_schedule(text, integer, date, date) TO anon, authenticated, service_role;

-- 儀表板 scope 也用集中 helper(營運經理/部門經理看全公司一致)
CREATE OR REPLACE FUNCTION public.liff_hr_dashboard(p_line_user_id text, p_store integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  v_org int;
  v_is_admin boolean;
  v_see_all boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_mstart date;
  v_ids int[];
  v_rest text[] := ARRAY['休','補休','特休','病','事','婚','喪','公','產','生','工傷','陪產','會議','未入職','已離職'];
  v_store_disp text;
  v_expected int; v_clocked int; v_late int;
  v_special json; v_ot_store json; v_ot_limit json; v_permit json; v_prob json;
  v_leave_appr numeric; v_leave_pend numeric; v_leave_pend_cnt int; v_ot_total numeric;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  v_org := emp.organization_id;
  v_is_admin := EXISTS (SELECT 1 FROM roles r WHERE r.id = emp.role_id AND r.name IN ('admin','super_admin'));

  -- 權限:沿用現有儀表板權限 nav.dashboard.hr(admin 免)
  IF NOT (v_is_admin OR public.liff_employee_has_permission(emp.id, 'nav.dashboard.hr')) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- 看全部店 = admin/super_admin OR schedule.view_all(營運經理等跨店角色)
  v_see_all := public._emp_sees_all_stores(emp.id);  -- 集中式:admin/super_admin OR schedule.view_all OR 督導全店部門的經理
  v_mstart := date_trunc('month', v_today)::date;

  -- team scope
  IF v_see_all THEN
    SELECT array_agg(id) INTO v_ids FROM employees
     WHERE organization_id = v_org AND status = '在職' AND (p_store IS NULL OR store_id = p_store);
    IF v_see_all AND p_store IS NULL THEN v_store_disp := '全公司';
    ELSE SELECT name INTO v_store_disp FROM stores WHERE id = p_store; END IF;
  ELSE
    -- 店長(多店)/督導(課):_can_see_store_for_emp 允許的店
    SELECT array_agg(e.id) INTO v_ids FROM employees e
     WHERE e.organization_id = v_org AND e.status = '在職'
       AND public._can_see_store_for_emp(emp.id::bigint, e.store_id::bigint);
    SELECT string_agg(DISTINCT s.name, '、') INTO v_store_disp
      FROM employees e JOIN stores s ON s.id = e.store_id WHERE e.id = ANY(COALESCE(v_ids, ARRAY[]::int[]));
  END IF;
  v_ids := COALESCE(v_ids, ARRAY[]::int[]);

  -- ── A. 今日出勤 ──
  SELECT COUNT(DISTINCT employee_id) INTO v_expected FROM schedules
   WHERE date = v_today AND employee_id = ANY(v_ids) AND shift IS NOT NULL AND shift <> ALL(v_rest);
  SELECT COUNT(DISTINCT employee_id) INTO v_clocked FROM attendance_records
   WHERE date = v_today AND employee_id = ANY(v_ids) AND clock_in IS NOT NULL;
  SELECT COUNT(*) INTO v_late FROM attendance_records
   WHERE date = v_today AND employee_id = ANY(v_ids) AND (is_late = true OR status = '遲到');

  -- ── 今日特殊狀態(含申請中):每人取一個,已核准(prio1)優先於申請中(prio2) ──
  SELECT json_agg(json_build_object('name', name, 'status', status) ORDER BY prio, name) INTO v_special
  FROM (
    SELECT DISTINCT ON (employee_id) employee_id, name, status, prio FROM (
      SELECT l.employee_id, e.name, CASE WHEN l.type IN ('病假','事假') THEN 'sick' ELSE 'leave' END AS status, 1 AS prio
        FROM leave_requests l JOIN employees e ON e.id = l.employee_id
       WHERE l.status='已核准' AND l.employee_id = ANY(v_ids) AND l.deleted_at IS NULL
         AND l.start_date <= v_today AND COALESCE(l.end_date, l.start_date) >= v_today
      UNION ALL
      SELECT t.employee_id, e.name, 'trip', 1 FROM business_trips t JOIN employees e ON e.id = t.employee_id
       WHERE t.status='已核准' AND t.employee_id = ANY(v_ids) AND t.deleted_at IS NULL
         AND t.start_date <= v_today AND t.end_date >= v_today
      UNION ALL
      SELECT o.employee_id, e.name, 'overtime', 1 FROM overtime_requests o JOIN employees e ON e.id = o.employee_id
       WHERE o.status='已核准' AND o.employee_id = ANY(v_ids) AND o.deleted_at IS NULL AND o.date = v_today
      UNION ALL
      SELECT l.employee_id, e.name, CASE WHEN l.type IN ('病假','事假') THEN 'sick_pending' ELSE 'leave_pending' END, 2
        FROM leave_requests l JOIN employees e ON e.id = l.employee_id
       WHERE l.status='待審核' AND l.employee_id = ANY(v_ids) AND l.deleted_at IS NULL
         AND l.start_date <= v_today AND COALESCE(l.end_date, l.start_date) >= v_today
      UNION ALL
      SELECT t.employee_id, e.name, 'trip_pending', 2 FROM business_trips t JOIN employees e ON e.id = t.employee_id
       WHERE t.status='待審核' AND t.employee_id = ANY(v_ids) AND t.deleted_at IS NULL
         AND t.start_date <= v_today AND t.end_date >= v_today
      UNION ALL
      SELECT o.employee_id, e.name, 'overtime_pending', 2 FROM overtime_requests o JOIN employees e ON e.id = o.employee_id
       WHERE o.status='待審核' AND o.employee_id = ANY(v_ids) AND o.deleted_at IS NULL AND o.date = v_today
    ) u ORDER BY employee_id, prio
  ) x;

  -- ── C. 加班分門市(本月已核准) + 總時數 ──
  SELECT json_agg(json_build_object('store', COALESCE(store,'未指定門市'), 'hours', h) ORDER BY h DESC) INTO v_ot_store
  FROM (SELECT store, SUM(hours) AS h FROM overtime_requests
         WHERE status='已核准' AND employee_id = ANY(v_ids) AND deleted_at IS NULL
           AND date >= v_mstart AND date <= v_today GROUP BY store) s;
  SELECT COALESCE(SUM(hours),0) INTO v_ot_total FROM overtime_requests
   WHERE status='已核准' AND employee_id = ANY(v_ids) AND deleted_at IS NULL AND date >= v_mstart AND date <= v_today;

  -- ── B. 加班接近上限(本月>=36h,勞基法46h) ──
  SELECT json_agg(json_build_object('name', employee, 'hours', h) ORDER BY h DESC) INTO v_ot_limit
  FROM (SELECT employee, SUM(hours) AS h FROM overtime_requests
         WHERE status='已核准' AND employee_id = ANY(v_ids) AND deleted_at IS NULL
           AND date >= v_mstart AND date <= v_today GROUP BY employee HAVING SUM(hours) >= 36) s;

  -- ── C. 請假(本月已核准 + 申請中) ──
  SELECT COALESCE(SUM(days),0) INTO v_leave_appr FROM leave_requests
   WHERE status='已核准' AND employee_id = ANY(v_ids) AND deleted_at IS NULL AND start_date >= v_mstart;
  SELECT COALESCE(SUM(days),0), COUNT(*) INTO v_leave_pend, v_leave_pend_cnt FROM leave_requests
   WHERE status='待審核' AND employee_id = ANY(v_ids) AND deleted_at IS NULL;

  -- ── B. 到期提醒:外籍證件(30天內) / 試用期(7天內) ──
  SELECT json_agg(json_build_object('name', name, 'date', work_permit_expiry) ORDER BY work_permit_expiry) INTO v_permit
    FROM employees WHERE organization_id = v_org AND id = ANY(v_ids)
     AND work_permit_expiry IS NOT NULL AND work_permit_expiry >= v_today AND work_permit_expiry <= v_today + 30;
  SELECT json_agg(json_build_object('name', name, 'date', probation_end) ORDER BY probation_end) INTO v_prob
    FROM employees WHERE organization_id = v_org AND id = ANY(v_ids)
     AND probation_end IS NOT NULL AND probation_end >= v_today AND probation_end <= v_today + 7;

  RETURN json_build_object(
    'ok', true,
    'scope', json_build_object('store', COALESCE(v_store_disp, '—'), 'is_admin', v_is_admin, 'see_all', v_see_all,
                               'team_count', COALESCE(array_length(v_ids,1),0)),
    'today', json_build_object(
      'expected', COALESCE(v_expected,0), 'clocked_in', COALESCE(v_clocked,0),
      'not_clocked', GREATEST(COALESCE(v_expected,0) - COALESCE(v_clocked,0), 0), 'late', COALESCE(v_late,0),
      'special', COALESCE(v_special, '[]'::json)),
    'alerts', json_build_object(
      'ot_near_limit', COALESCE(v_ot_limit, '[]'::json),
      'permit_expiry', COALESCE(v_permit, '[]'::json),
      'probation_ending', COALESCE(v_prob, '[]'::json)),
    'stats', json_build_object(
      'ot_by_store', COALESCE(v_ot_store, '[]'::json),
      'ot_total_hours', COALESCE(v_ot_total,0),
      'leave', json_build_object('approved_days', v_leave_appr, 'pending_days', v_leave_pend, 'pending_count', v_leave_pend_cnt))
  );
END $function$;;

NOTIFY pgrst, 'reload schema';
