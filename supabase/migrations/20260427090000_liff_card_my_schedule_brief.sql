-- ============================================================
-- liff_card_my_schedule_brief
--
-- LINE BOT「班表」preview 卡片用：一次回 7 天班表 + 月工時 + 希望休 + 待回代班
-- 用 line_user_id 解析員工，回 JSON 給 webhook 組卡。
-- ============================================================

CREATE OR REPLACE FUNCTION public.liff_card_my_schedule_brief(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp                 employees;
  v_today             date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date;
  v_week_start        date := v_today;
  v_week_end          date := v_today + INTERVAL '6 days';
  v_month_start       date := date_trunc('month', v_today)::date;
  v_month_end         date := (date_trunc('month', v_today) + INTERVAL '1 month - 1 day')::date;
  v_week              json;
  v_month_hours       numeric;
  v_off_req_count     int;
  v_pending_cover     int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 7 天班表：今天起算往後 7 天，無排班的日期回 null shift
  WITH days AS (
    SELECT generate_series(v_week_start, v_week_end, INTERVAL '1 day')::date AS d
  )
  SELECT json_agg(json_build_object(
    'date',        to_char(days.d, 'YYYY-MM-DD'),
    'weekday',     CASE EXTRACT(DOW FROM days.d)::int
                     WHEN 0 THEN '日' WHEN 1 THEN '一' WHEN 2 THEN '二'
                     WHEN 3 THEN '三' WHEN 4 THEN '四' WHEN 5 THEN '五'
                     WHEN 6 THEN '六' END,
    'shift',       s.shift,
    'actual_start', to_char(s.actual_start, 'HH24:MI'),
    'actual_end',  to_char(s.actual_end, 'HH24:MI'),
    'actual_hours', s.actual_hours,
    'absence_type', s.absence_type,
    'is_today',    days.d = v_today,
    'is_weekend',  EXTRACT(DOW FROM days.d) IN (0, 6)
  ) ORDER BY days.d)
  INTO v_week
  FROM days
  LEFT JOIN public.schedules s
    ON s.employee_id = emp.id AND s.date = days.d;

  -- 本月實際工時
  SELECT COALESCE(SUM(actual_hours), 0)
    INTO v_month_hours
    FROM public.schedules
   WHERE employee_id = emp.id
     AND date BETWEEN v_month_start AND v_month_end
     AND actual_hours IS NOT NULL;

  -- 本月希望休（已申請 + 已核准）
  SELECT COUNT(*) INTO v_off_req_count
    FROM public.off_requests
   WHERE employee_id = emp.id
     AND date BETWEEN v_month_start AND v_month_end
     AND status IN ('已核准', '待審核');

  -- 待我回應的代班邀請
  SELECT COUNT(*) INTO v_pending_cover
    FROM public.shift_cover_requests
   WHERE status = '招募中'
     AND emp.id = ANY(invited_emp_ids);

  RETURN json_build_object(
    'ok', true,
    'employee', json_build_object('id', emp.id, 'name', emp.name),
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'week', COALESCE(v_week, '[]'::json),
    'month_hours', v_month_hours,
    'off_request_count', v_off_req_count,
    'pending_cover_invites', v_pending_cover
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_card_my_schedule_brief(text) TO anon, authenticated;
