-- 離職/資遣「到離職日才生效」— 2026-07-21
-- 現況:apply_employee_resignation 一呼叫就立刻把員工轉離職(不管離職日在不在未來)→
--   資遣有預告期時,人今天就被離職(排班/計薪把他當已走)。
-- 修:①apply 加「日期閘門」——離職日在未來 → 只登記 resign_date/type,維持在職(照常做到最後一天),
--     離職日=今天/過去 → 立刻生效(原有完整 cascade)。
--    ②每日 cron 掃「在職 + resign_date≤今天(台灣)」→ 到期才真正轉離職(呼叫 apply,此時走立刻分支)。
-- 台灣日期用 (now() AT TIME ZONE 'Asia/Taipei')::date。守衛:resign_date 必須晚於最近到職/復職,防回鍋誤轉。

CREATE OR REPLACE FUNCTION public.apply_employee_resignation(
  p_emp_id integer, p_resign_date date, p_resign_reason text DEFAULT NULL, p_resign_type text DEFAULT 'voluntary'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_emp           employees;
  v_today         date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_cancelled_lv  INT; v_cancelled_ot INT; v_cancelled_cc INT; v_cancelled_bt INT;
  v_held_tasks    INT; v_deleted_sched INT;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF p_resign_type NOT IN ('voluntary','involuntary','retirement','contract_end') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_RESIGN_TYPE', 'received', p_resign_type);
  END IF;

  -- ★ 日期閘門:離職日在未來 → 只登記,維持在職;到期由 cron 轉。
  IF p_resign_date > v_today THEN
    UPDATE employees
       SET resign_date = p_resign_date, resign_reason = p_resign_reason, resign_type = p_resign_type
     WHERE id = p_emp_id;               -- status 不動(維持在職,照常排班/計薪到離職日)
    DELETE FROM schedules WHERE employee_id = p_emp_id AND date > p_resign_date;  -- 離職日之後的班不該存在
    GET DIAGNOSTICS v_deleted_sched = ROW_COUNT;
    RETURN json_build_object('ok', true, 'scheduled', true, 'effective_date', p_resign_date,
      'note', '已登記,維持在職至離職日,到期自動轉離職',
      'cascade', json_build_object('deleted_future_schedules', v_deleted_sched));
  END IF;

  -- 離職日=今天/過去 → 立刻生效(以下為原有完整 cascade)
  UPDATE employees SET status='離職', resign_date=p_resign_date, resign_reason=p_resign_reason, resign_type=p_resign_type
   WHERE id = p_emp_id;

  UPDATE employee_assignments SET end_date=p_resign_date, is_active=false
   WHERE employee_id=p_emp_id AND department_type='主要' AND is_active=true;

  DELETE FROM schedules WHERE employee_id=p_emp_id AND date > p_resign_date;
  GET DIAGNOSTICS v_deleted_sched = ROW_COUNT;

  UPDATE leave_requests SET status='已取消' WHERE employee_id=p_emp_id AND status='待審核';
  GET DIAGNOSTICS v_cancelled_lv = ROW_COUNT;
  UPDATE overtime_requests SET status='已取消' WHERE employee_id=p_emp_id AND status='待審核';
  GET DIAGNOSTICS v_cancelled_ot = ROW_COUNT;
  UPDATE clock_corrections SET status='已取消' WHERE employee=v_emp.name AND status='待審核';
  GET DIAGNOSTICS v_cancelled_cc = ROW_COUNT;
  UPDATE business_trips SET status='已取消' WHERE employee=v_emp.name AND status='待審核';
  GET DIAGNOSTICS v_cancelled_bt = ROW_COUNT;

  UPDATE tasks SET status='已擱置'
   WHERE assignee_id=p_emp_id AND status IN ('進行中','待簽核','待確認');
  GET DIAGNOSTICS v_held_tasks = ROW_COUNT;

  RETURN json_build_object('ok', true, 'employee_id', p_emp_id, 'resign_date', p_resign_date, 'resign_type', p_resign_type,
    'cascade', json_build_object('deleted_future_schedules', v_deleted_sched, 'cancelled_leave_requests', v_cancelled_lv,
      'cancelled_overtime_requests', v_cancelled_ot, 'cancelled_clock_corrections', v_cancelled_cc,
      'cancelled_business_trips', v_cancelled_bt, 'held_tasks', v_held_tasks));
END $function$;

-- ── 每日到期轉離職 ──
CREATE OR REPLACE FUNCTION public._process_effective_resignations()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date; v_count int := 0;
BEGIN
  FOR r IN
    SELECT id, resign_date, resign_reason, resign_type
      FROM public.employees
     WHERE status = '在職'
       AND resign_date IS NOT NULL
       AND resign_date <= v_today
       AND resign_date > COALESCE(reinstatement_date, join_date, DATE '1900-01-01')  -- 防回鍋舊 resign_date
  LOOP
    PERFORM public.apply_employee_resignation(r.id, r.resign_date, r.resign_reason, COALESCE(r.resign_type,'voluntary'));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public._process_effective_resignations() TO service_role;

-- 排程:每日 00:05 UTC(=台灣 08:05)
DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('process_effective_resignations'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('process_effective_resignations', '5 0 * * *',
    $cron$SELECT public._process_effective_resignations()$cron$);
END $$;

NOTIFY pgrst, 'reload schema';
