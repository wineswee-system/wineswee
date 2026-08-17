-- Phase 0 RPC 稽核 batch1:吃 employee_id 的 DEFINER 函式加 org 守門(跨租戶讀/寫洩漏)。
-- ★含 2 支跨租戶寫入:apply_employee_resignation(設離職)、reset_all_employee_permission_overrides(重置權限)。
-- 全用 _same_org_or_super() 守門(service_role/super_admin/同org 放行)。已 live+複驗;此檔為 rebuild parity。

-- ── _employee_line_target ──
CREATE OR REPLACE FUNCTION public._employee_line_target(p_emp_id integer)
 RETURNS TABLE(line_user_id text, channel_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ela.line_user_id, lc.code
    FROM employee_line_accounts ela
    JOIN line_channels lc ON lc.id = ela.channel_id
   WHERE ela.employee_id = p_emp_id AND (SELECT public._same_org_or_super(organization_id) FROM public.employees WHERE id = p_emp_id)
     AND lc.status = 'active'
   ORDER BY lc.is_default DESC NULLS LAST,
            ela.is_primary DESC NULLS LAST,
            ela.id
   LIMIT 1;
$function$
;

-- ── _ot_category ──
CREATE OR REPLACE FUNCTION public._ot_category(p_emp_id integer, p_date date, p_ot_category text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sc AS (
    SELECT string_agg(COALESCE(shift,''), ' ') AS shifts
    FROM public.schedules WHERE employee_id = p_emp_id AND date = p_date
  )
  SELECT CASE
    WHEN sc.shifts LIKE '%例假%' THEN 'weekly_off'
    WHEN sc.shifts LIKE '%休息%' THEN 'restday'
    WHEN public._is_national_holiday(p_emp_id, p_date) THEN 'holiday'
    WHEN COALESCE((
      SELECT COALESCE(ss.salary_type,'')='hourly' OR COALESCE(ss.employment_category,'')='admin'
      FROM public.salary_structures ss WHERE ss.employee_id = p_emp_id LIMIT 1
    ), false)
      THEN CASE extract(dow from p_date)::int WHEN 0 THEN 'weekly_off' WHEN 6 THEN 'restday' ELSE 'weekday' END
    ELSE 'weekday'
  END
  FROM sc WHERE (SELECT public._same_org_or_super(organization_id) FROM public.employees WHERE id = p_emp_id)
$function$
;

-- ── apply_employee_resignation ──
CREATE OR REPLACE FUNCTION public.apply_employee_resignation(p_emp_id integer, p_resign_date date, p_resign_reason text DEFAULT NULL::text, p_resign_type text DEFAULT 'voluntary'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp           employees;
  v_today         date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_cancelled_lv  INT; v_cancelled_ot INT; v_cancelled_cc INT; v_cancelled_bt INT;
  v_held_tasks    INT; v_deleted_sched INT;
BEGIN
  IF NOT public._same_org_or_super((SELECT organization_id FROM public.employees WHERE id=p_emp_id)) THEN RETURN NULL; END IF;
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF p_resign_type NOT IN ('voluntary','involuntary','retirement','contract_end') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_RESIGN_TYPE', 'received', p_resign_type);
  END IF;

  -- ★ 日期閘門:離職日 >= 今天(最後工作日還沒過,含當天)→ 只登記,維持在職;隔天由 cron 轉。
  IF p_resign_date >= v_today THEN
    UPDATE employees
       SET resign_date = p_resign_date, resign_reason = p_resign_reason, resign_type = p_resign_type
     WHERE id = p_emp_id;               -- status 不動(維持在職,照常排班/打卡/計薪到最後工作日)
    DELETE FROM schedules WHERE employee_id = p_emp_id AND date > p_resign_date;  -- 離職日之後的班不該存在
    GET DIAGNOSTICS v_deleted_sched = ROW_COUNT;
    RETURN json_build_object('ok', true, 'scheduled', true, 'effective_date', p_resign_date,
      'note', '已登記,維持在職至最後工作日,隔天自動轉離職',
      'cascade', json_build_object('deleted_future_schedules', v_deleted_sched));
  END IF;

  -- 離職日已過(< 今天)→ 立刻生效(以下為原有完整 cascade)
  UPDATE employees SET status='離職', resign_date=p_resign_date, resign_reason=p_resign_reason, resign_type=p_resign_type
   WHERE id = p_emp_id;

  UPDATE employee_assignments SET end_date=p_resign_date, is_active=false
   WHERE employee_id=p_emp_id AND department_type='主要' AND is_active=true;

  DELETE FROM schedules WHERE employee_id=p_emp_id AND date > p_resign_date;
  GET DIAGNOSTICS v_deleted_sched = ROW_COUNT;

  -- ★ 只取消「離職日之後」的待審核(未來、人都走了);離職日(含)之前的留著照常審核。
  UPDATE leave_requests SET status='已取消' WHERE employee_id=p_emp_id AND status='待審核' AND start_date > p_resign_date;
  GET DIAGNOSTICS v_cancelled_lv = ROW_COUNT;
  UPDATE overtime_requests SET status='已取消' WHERE employee_id=p_emp_id AND status='待審核' AND date > p_resign_date;
  GET DIAGNOSTICS v_cancelled_ot = ROW_COUNT;
  UPDATE clock_corrections SET status='已取消' WHERE employee=v_emp.name AND status='待審核' AND date > p_resign_date;
  GET DIAGNOSTICS v_cancelled_cc = ROW_COUNT;
  UPDATE business_trips SET status='已取消' WHERE employee=v_emp.name AND status='待審核' AND start_date > p_resign_date;
  GET DIAGNOSTICS v_cancelled_bt = ROW_COUNT;

  UPDATE tasks SET status='已擱置'
   WHERE assignee_id=p_emp_id AND status IN ('進行中','待簽核','待確認');
  GET DIAGNOSTICS v_held_tasks = ROW_COUNT;

  RETURN json_build_object('ok', true, 'employee_id', p_emp_id, 'resign_date', p_resign_date, 'resign_type', p_resign_type,
    'cascade', json_build_object('deleted_future_schedules', v_deleted_sched, 'cancelled_leave_requests', v_cancelled_lv,
      'cancelled_overtime_requests', v_cancelled_ot, 'cancelled_clock_corrections', v_cancelled_cc,
      'cancelled_business_trips', v_cancelled_bt, 'held_tasks', v_held_tasks));
END $function$
;

-- ── leave_annual_entitlement ──
CREATE OR REPLACE FUNCTION public.leave_annual_entitlement(p_emp_id integer, p_ref_year integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp      public.employees;
  v_years    numeric;
  v_cy       int;
  v_ft_days  int;
  v_is_pt    boolean;
  v_avg_wk   numeric;
  v_ratio    numeric;
  v_pt_hours numeric;
  v_pt_actual_enabled boolean := false;   -- ★班表補齊後改 true 即恢復 PT 實排折算
BEGIN
  IF NOT public._same_org_or_super((SELECT organization_id FROM public.employees WHERE id=p_emp_id)) THEN RETURN NULL; END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL OR v_emp.join_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_JOIN_DATE', 'ft_days', 0, 'pt_hours', 0, 'years_worked', 0);
  END IF;

  IF p_ref_year IS NULL THEN
    v_years := EXTRACT(EPOCH FROM (now() - v_emp.join_date::timestamptz)) / (365.25 * 86400);
    v_cy    := NULL;
  ELSE
    v_cy    := p_ref_year - EXTRACT(YEAR FROM v_emp.join_date)::int;
    v_years := v_cy + 0.5;
  END IF;

  -- §38 年資階梯(逐字對齊 leavePolicy calcEntitlement)
  v_ft_days := CASE
    WHEN v_years < 0.5 THEN 0
    WHEN v_years < 1  THEN 3
    WHEN v_years < 2  THEN 7
    WHEN v_years < 3  THEN 10
    WHEN v_years < 5  THEN 14
    WHEN v_years < 10 THEN 15
    ELSE LEAST(30, 15 + (FLOOR(v_years)::int - 10))
  END;

  v_is_pt := (v_emp.salary_type = 'hourly');

  v_avg_wk := NULL; v_ratio := NULL; v_pt_hours := NULL;
  IF v_is_pt THEN
    v_avg_wk := public.leave_pt_avg_weekly_hours(p_emp_id);   -- 仍算,供對帳參考
    v_ratio  := LEAST(1, COALESCE(v_avg_wk, 0) / 40.0);
    IF v_pt_actual_enabled THEN
      v_pt_hours := v_ft_days * 8 * v_ratio;                  -- 正式:實排折算
    ELSE
      v_pt_hours := 0;                                        -- 暫停:班表未匯齊 → 顯示 0
    END IF;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'is_pt', v_is_pt,
    'pt_paused', (v_is_pt AND NOT v_pt_actual_enabled),       -- 前端標「待班表匯入」
    'ref_year', p_ref_year,
    'completed_years', v_cy,
    'years_worked', ROUND(v_years, 1),
    'ft_days', v_ft_days,
    'pt_avg_weekly_hours', v_avg_wk,
    'pt_ratio', v_ratio,
    'pt_hours', v_pt_hours
  );
END $function$
;

-- ── leave_pt_avg_weekly_hours ──
CREATE OR REPLACE FUNCTION public.leave_pt_avg_weekly_hours(p_emp_id integer)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric;
  v_weeks int;
  v_weekly numeric;
  v_fallback numeric;
BEGIN
  IF NOT public._same_org_or_super((SELECT organization_id FROM public.employees WHERE id=p_emp_id)) THEN RETURN NULL; END IF;
  -- 近 182 天(約6個月)實際排班淨工時加總(兩段 shift;休/例假 actual 為 null → _shift_seg_hours 回 0 自動排除)
  -- + 有「實際上班」的週數(以有排班的那些週為分母,避免只有近期資料的人被固定26週低估;資料越多越準)
  SELECT
    COALESCE(SUM(
      public._shift_seg_hours(s.actual_start, s.actual_end, s.rest_minutes)
    + public._shift_seg_hours(s.actual_start_2, s.actual_end_2, NULL)
    ), 0),
    COUNT(DISTINCT date_trunc('week', s.date))
      FILTER (WHERE s.actual_start IS NOT NULL OR s.actual_start_2 IS NOT NULL)
    INTO v_total, v_weeks
  FROM public.schedules s
  WHERE s.employee_id = p_emp_id
    AND s.date >= (CURRENT_DATE - INTERVAL '182 days')
    AND s.date <= CURRENT_DATE
    AND s.absence_type IS NULL;   -- 排除被請假標記的日子

  IF v_total > 0 AND COALESCE(v_weeks, 0) > 0 THEN
    v_weekly := v_total / v_weeks;   -- 平均「每個有上班的週」工時
    RETURN ROUND(v_weekly, 2);
  END IF;

  -- 無排班資料 → fallback 現行 weekly_hours(行為不變,不歸零)
  SELECT COALESCE(weekly_hours, 0) INTO v_fallback FROM public.employees WHERE id = p_emp_id;
  RETURN v_fallback;
END $function$
;

-- ── liff_get_applicant_meta ──
CREATE OR REPLACE FUNCTION public.liff_get_applicant_meta(p_emp_id integer)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id',              e.id,
    'name',            e.name,
    'store_name',      s.name,
    'department_name', d.name
  )
  FROM public.employees e
  LEFT JOIN public.stores      s ON s.id = e.store_id
  LEFT JOIN public.departments d ON d.id = e.department_id
  WHERE e.id = p_emp_id AND public._same_org_or_super(e.organization_id)
  LIMIT 1
$function$
;

-- ── liff_get_store_for_employee ──
CREATE OR REPLACE FUNCTION public.liff_get_store_for_employee(p_employee_id integer)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id',                     s.id,
    'name',                   s.name,
    'lat',                    s.lat,
    'lng',                    s.lng,
    'clock_radius',           s.clock_radius,
    'allowed_wifi',           s.allowed_wifi,
    'late_tolerance_minutes', s.late_tolerance_minutes,
    'early_clock_minutes',    s.early_clock_minutes,
    'clock_in_method',        s.clock_in_method
  )
  FROM public.stores s
  JOIN public.employees e ON e.store_id = s.id
  WHERE e.id = p_employee_id AND public._same_org_or_super(e.organization_id)
  LIMIT 1
$function$
;

-- ── liff_get_stores_for_employee ──
CREATE OR REPLACE FUNCTION public.liff_get_stores_for_employee(p_employee_id integer)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_agg(
    json_build_object(
      'id',                     s.id,
      'name',                   s.name,
      'lat',                    s.lat,
      'lng',                    s.lng,
      'clock_radius',           s.clock_radius,
      'allowed_wifi',           s.allowed_wifi,
      'late_tolerance_minutes', s.late_tolerance_minutes,
      'early_clock_minutes',    s.early_clock_minutes,
      'clock_in_method',        s.clock_in_method,
      'is_primary',             (s.id = e.store_id)
    )
    ORDER BY (s.id = e.store_id) DESC, s.name
  )
  FROM public.employees e
  CROSS JOIN LATERAL (
    SELECT * FROM public.stores
     WHERE id = e.store_id
        OR name = ANY(COALESCE(e.additional_stores, '{}'::TEXT[]))
  ) s
  WHERE e.id = p_employee_id AND public._same_org_or_super(e.organization_id);
$function$
;

-- ── liff_resolve_hr_approvers ──
CREATE OR REPLACE FUNCTION public.liff_resolve_hr_approvers(p_applicant_emp_id integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result json;
BEGIN
  IF NOT public._same_org_or_super((SELECT organization_id FROM public.employees WHERE id=p_applicant_emp_id)) THEN RETURN NULL; END IF;
  SELECT json_agg(json_build_object('emp_id', e.id, 'name', e.name))
    INTO v_result
    FROM employees e
   WHERE e.id IN (SELECT public._resolve_hr_approver_ids(p_applicant_emp_id));
  RETURN COALESCE(v_result, '[]'::json);
END $function$
;

-- ── liff_resolve_line_target ──
CREATE OR REPLACE FUNCTION public.liff_resolve_line_target(p_emp_id integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- 優先序（對齊原 JS getLineTarget）：
  --   1. status='active' 優先（不是 active 的 channel 推不出去）
  --   2. is_default 的 channel 優先（系統預設 channel）
  --   3. is_primary 的綁定優先（員工主要 LINE）
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'line_user_id', ela.line_user_id,
       'channel_code', lc.code
     )
     FROM public.employee_line_accounts ela
     JOIN public.line_channels lc ON lc.id = ela.channel_id
     WHERE ela.employee_id = p_emp_id AND (SELECT public._same_org_or_super(organization_id) FROM public.employees WHERE id = p_emp_id)
       AND ela.line_user_id IS NOT NULL
     ORDER BY
       CASE WHEN lc.status = 'active' THEN 0 ELSE 1 END,
       CASE WHEN lc.is_default THEN 0 ELSE 1 END,
       CASE WHEN ela.is_primary THEN 0 ELSE 1 END
     LIMIT 1),
    jsonb_build_object('line_user_id', NULL, 'channel_code', NULL)
  );
$function$
;

-- ── reset_all_employee_permission_overrides ──
CREATE OR REPLACE FUNCTION public.reset_all_employee_permission_overrides(p_emp_id integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller        employees;
  v_caller_role   TEXT;
  v_target_role   TEXT;
  v_deleted       int;
BEGIN
  IF NOT public._same_org_or_super((SELECT organization_id FROM public.employees WHERE id=p_emp_id)) THEN RETURN NULL; END IF;
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT roles.name INTO v_caller_role
    FROM roles WHERE roles.id = v_caller.role_id;

  IF v_caller_role NOT IN ('super_admin', 'admin') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- admin 額外防呆
  IF v_caller_role = 'admin' THEN
    IF p_emp_id = v_caller.id THEN
      RETURN json_build_object('ok', false, 'error', 'CANNOT_MODIFY_SELF');
    END IF;
    SELECT roles.name INTO v_target_role
      FROM employees e JOIN roles ON roles.id = e.role_id
     WHERE e.id = p_emp_id;
    IF v_target_role IN ('super_admin', 'admin') THEN
      RETURN json_build_object('ok', false, 'error', 'CANNOT_MODIFY_PEER_OR_HIGHER');
    END IF;
  END IF;

  WITH del AS (
    DELETE FROM employee_permissions WHERE employee_id = p_emp_id RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM del;

  RETURN json_build_object('ok', true, 'deleted', v_deleted);
END $function$
;

