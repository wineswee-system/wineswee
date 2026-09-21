-- 離職 cascade 只取消「離職日之後」的待審核申請 + 還原誤取消的 — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- 承 20260731100000:apply_employee_resignation 的 cascade 把「所有待審核」請假/加班/補卡/出差
-- 一律 已取消,沒判日期 → 連任職期內(離職日之前)真的申請的也被殺
-- (慘案:吳昕芛 #249 7/15 病假+診斷證明、#247 7/27 病假,以及 5 筆加班/7 筆補卡全被取消
--  → 最後薪資少算)。
-- 修:cascade 只取消「date/start_date > 離職日」的待審核(未來、人都走了才該取消);
--    離職日(含)之前的留著照常審核。
-- 並還原吳昕芛(#406)被誤取消、任職期內的 14 筆 → 待審核(丟回審核佇列,主管再審,非自動核准)。
-- ════════════════════════════════════════════════════════════════════════════

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
END $function$;

-- ── 還原被離職 cascade 誤取消、任職期內(date <= resign_date)的申請 → 待審核 ──
-- 全庫盤點僅 2 人受影響(薪資皆未結):吳昕芛(#406,14筆)、宋慧芸(#437,3筆)。
-- 綁死 id 只還原這批;還原=丟回審核佇列由主管再審(非自動核准);idempotent:只動仍為 已取消 的。
-- 吳昕芛(#406)
UPDATE public.leave_requests    SET status='待審核' WHERE id IN (247, 249)                     AND status='已取消';
UPDATE public.overtime_requests SET status='待審核' WHERE id IN (992, 993, 994, 1462, 1552)     AND status='已取消';
UPDATE public.clock_corrections SET status='待審核' WHERE id IN (73, 84, 85, 140, 142, 163, 164) AND status='已取消';
-- 宋慧芸(#437)
UPDATE public.overtime_requests SET status='待審核' WHERE id IN (1526)    AND status='已取消';
UPDATE public.clock_corrections SET status='待審核' WHERE id IN (61, 81)  AND status='已取消';

NOTIFY pgrst, 'reload schema';
