-- ============================================================
-- liff_card_today_summary
-- /說明 主選單前的「今日摘要」卡用：待辦/待簽/任務/今日班別/打卡狀態
-- ============================================================

CREATE OR REPLACE FUNCTION public.liff_card_today_summary(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp                    employees;
  v_today                date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date;
  v_pending_tasks        int;
  v_pending_approvals    int;
  v_pending_cover        int;
  v_today_shift          text;
  v_clocked_in           boolean := false;
  v_clocked_out          boolean := false;
  pa                     json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 我的待辦任務（assignee + 非 completed/cancelled）
  SELECT COUNT(*) INTO v_pending_tasks
    FROM public.tasks
   WHERE assignee_id = emp.id
     AND status NOT IN ('completed', 'cancelled');

  -- 待我簽核（呼叫既有 RPC 抓總數）
  pa := public.liff_list_pending_approvals(p_line_user_id);
  v_pending_approvals := COALESCE(
    (SELECT COUNT(*) FROM json_array_elements(pa->'leaves')) +
    (SELECT COUNT(*) FROM json_array_elements(pa->'overtimes')) +
    (SELECT COUNT(*) FROM json_array_elements(pa->'trips')) +
    (SELECT COUNT(*) FROM json_array_elements(pa->'corrections')) +
    (SELECT COUNT(*) FROM json_array_elements(pa->'expenses')) +
    (SELECT COUNT(*) FROM json_array_elements(pa->'expense_requests')) +
    (SELECT COUNT(*) FROM json_array_elements(pa->'off_requests')),
    0);

  -- 待回應的代班邀請
  SELECT COUNT(*) INTO v_pending_cover
    FROM public.shift_cover_requests
   WHERE status = '招募中' AND emp.id = ANY(invited_emp_ids);

  -- 今日班別
  SELECT COALESCE(absence_type, shift) INTO v_today_shift
    FROM public.schedules
   WHERE employee_id = emp.id AND date = v_today
   LIMIT 1;

  -- 今日打卡狀態
  SELECT (clock_in IS NOT NULL), (clock_out IS NOT NULL)
    INTO v_clocked_in, v_clocked_out
    FROM public.attendance_records
   WHERE date = v_today AND (employee_id = emp.id OR employee = emp.name)
   ORDER BY id DESC LIMIT 1;

  RETURN json_build_object(
    'ok', true,
    'employee_name',     emp.name,
    'today',             to_char(v_today, 'YYYY-MM-DD'),
    'weekday',           CASE EXTRACT(DOW FROM v_today)::int
                          WHEN 0 THEN '日' WHEN 1 THEN '一' WHEN 2 THEN '二'
                          WHEN 3 THEN '三' WHEN 4 THEN '四' WHEN 5 THEN '五'
                          WHEN 6 THEN '六' END,
    'pending_tasks',     v_pending_tasks,
    'pending_approvals', v_pending_approvals,
    'pending_cover',     v_pending_cover,
    'today_shift',       COALESCE(v_today_shift, '休'),
    'clocked_in',        COALESCE(v_clocked_in, false),
    'clocked_out',       COALESCE(v_clocked_out, false)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_card_today_summary(text) TO anon, authenticated;
