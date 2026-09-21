-- LIFF 人力儀表板「今日特殊狀態」卡片:病假→sick、事假→personal、其餘→leave,並帶實際假別(type)
-- 合併版(取代同日 _hr_dashboard_personal_leave):事假獨立 personal(前端📋圖示)+ type 讓前端顯示特休/婚假/喪假…
-- 只動 v_special 區塊(status 三分 + 每列多帶 ltype),其餘與線上定義逐字一致。

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
  -- type = 實際假別(特休/婚假/喪假…);trip/加班為 null。前端請假類顯示 type。
  SELECT json_agg(json_build_object('name', name, 'status', status, 'type', ltype) ORDER BY prio, name) INTO v_special
  FROM (
    SELECT DISTINCT ON (employee_id) employee_id, name, status, ltype, prio FROM (
      SELECT l.employee_id, e.name, CASE WHEN l.type = '病假' THEN 'sick' WHEN l.type = '事假' THEN 'personal' ELSE 'leave' END AS status, l.type AS ltype, 1 AS prio
        FROM leave_requests l JOIN employees e ON e.id = l.employee_id
       WHERE l.status='已核准' AND l.employee_id = ANY(v_ids) AND l.deleted_at IS NULL
         AND l.start_date <= v_today AND COALESCE(l.end_date, l.start_date) >= v_today
      UNION ALL
      SELECT t.employee_id, e.name, 'trip', NULL::text, 1 FROM business_trips t JOIN employees e ON e.id = t.employee_id
       WHERE t.status='已核准' AND t.employee_id = ANY(v_ids) AND t.deleted_at IS NULL
         AND t.start_date <= v_today AND t.end_date >= v_today
      UNION ALL
      SELECT o.employee_id, e.name, 'overtime', NULL::text, 1 FROM overtime_requests o JOIN employees e ON e.id = o.employee_id
       WHERE o.status='已核准' AND o.employee_id = ANY(v_ids) AND o.deleted_at IS NULL AND (CASE WHEN o.start_time IS NOT NULL AND o.start_time < time '06:00' THEN o.date - 1 ELSE o.date END) = v_today
      UNION ALL
      SELECT l.employee_id, e.name, CASE WHEN l.type = '病假' THEN 'sick_pending' WHEN l.type = '事假' THEN 'personal_pending' ELSE 'leave_pending' END, l.type, 2
        FROM leave_requests l JOIN employees e ON e.id = l.employee_id
       WHERE l.status='待審核' AND l.employee_id = ANY(v_ids) AND l.deleted_at IS NULL
         AND l.start_date <= v_today AND COALESCE(l.end_date, l.start_date) >= v_today
      UNION ALL
      SELECT t.employee_id, e.name, 'trip_pending', NULL::text, 2 FROM business_trips t JOIN employees e ON e.id = t.employee_id
       WHERE t.status='待審核' AND t.employee_id = ANY(v_ids) AND t.deleted_at IS NULL
         AND t.start_date <= v_today AND t.end_date >= v_today
      UNION ALL
      SELECT o.employee_id, e.name, 'overtime_pending', NULL::text, 2 FROM overtime_requests o JOIN employees e ON e.id = o.employee_id
       WHERE o.status='待審核' AND o.employee_id = ANY(v_ids) AND o.deleted_at IS NULL AND (CASE WHEN o.start_time IS NOT NULL AND o.start_time < time '06:00' THEN o.date - 1 ELSE o.date END) = v_today
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
END $function$;
