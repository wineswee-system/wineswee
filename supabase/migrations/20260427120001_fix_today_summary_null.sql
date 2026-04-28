-- Fix liff_card_today_summary：補 NULL 防呆，並在發生 SQLSTATE 錯誤時回 ok=false 而非 throw

CREATE OR REPLACE FUNCTION public.liff_card_today_summary(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp                    employees;
  v_today                date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date;
  v_pending_tasks        int := 0;
  v_pending_approvals    int := 0;
  v_pending_cover        int := 0;
  v_today_shift          text;
  v_clocked_in           boolean := false;
  v_clocked_out          boolean := false;
  pa                     json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 待辦任務
  BEGIN
    SELECT COUNT(*) INTO v_pending_tasks
      FROM public.tasks
     WHERE assignee_id = emp.id
       AND status NOT IN ('completed', 'cancelled');
  EXCEPTION WHEN OTHERS THEN v_pending_tasks := 0;
  END;

  -- 待我簽核（合計 7 類）— 寫成單一 SQL 防 NULL
  BEGIN
    pa := public.liff_list_pending_approvals(p_line_user_id);
    IF pa IS NOT NULL THEN
      v_pending_approvals :=
        COALESCE(json_array_length(pa->'leaves'), 0) +
        COALESCE(json_array_length(pa->'overtimes'), 0) +
        COALESCE(json_array_length(pa->'trips'), 0) +
        COALESCE(json_array_length(pa->'corrections'), 0) +
        COALESCE(json_array_length(pa->'expenses'), 0) +
        COALESCE(json_array_length(pa->'expense_requests'), 0) +
        COALESCE(json_array_length(pa->'off_requests'), 0);
    END IF;
  EXCEPTION WHEN OTHERS THEN v_pending_approvals := 0;
  END;

  -- 待回應代班邀請
  BEGIN
    SELECT COUNT(*) INTO v_pending_cover
      FROM public.shift_cover_requests
     WHERE status = '招募中' AND emp.id = ANY(invited_emp_ids);
  EXCEPTION WHEN OTHERS THEN v_pending_cover := 0;
  END;

  -- 今日班別
  BEGIN
    SELECT COALESCE(absence_type, shift) INTO v_today_shift
      FROM public.schedules
     WHERE employee_id = emp.id AND date = v_today
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_today_shift := NULL;
  END;

  -- 今日打卡
  BEGIN
    SELECT (clock_in IS NOT NULL), (clock_out IS NOT NULL)
      INTO v_clocked_in, v_clocked_out
      FROM public.attendance_records
     WHERE date = v_today AND (employee_id = emp.id OR employee = emp.name)
     ORDER BY id DESC LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_clocked_in := false;
    v_clocked_out := false;
  END;

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
