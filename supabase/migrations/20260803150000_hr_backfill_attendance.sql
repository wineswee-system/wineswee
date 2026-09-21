-- HR 補登打卡紀錄 RPC（可補離職者、任意日期）— 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:員工當天完全沒打卡(尤其已離職),HR 需要幫他補一筆完整打卡紀錄。
-- 現況:打卡追蹤頁的「上班打卡/下班打卡」只對「今天 + 在職(getActiveEmployees)」有效;
--   「改時間」只能改既有 record。離職者不在清單、過去日期無列 → 補不了。
-- 修:admin/super_admin 專用 SECURITY DEFINER RPC，直接 insert/upsert attendance_records
--   (繞 RLS、離職也能補)+ 用 net_work_hours 算工時 + 寫 attendance_clock_edits 稽核。
--   同一 (employee_id, date) 已有 record → 更新;否則新增。source='hr_backfill' 標記來源。
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.hr_backfill_attendance(
  p_emp_id    int,
  p_date      date,
  p_clock_in  text,
  p_clock_out text DEFAULT NULL,
  p_reason    text DEFAULT NULL,
  p_actor_id  int  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller  employees;
  v_emp     employees;
  v_ci      time;
  v_co      time;
  v_net     numeric;
  v_rec_id  int;
  v_org     int;
  v_old_ci  text;
  v_old_co  text;
BEGIN
  -- 呼叫者權限（限 admin/super_admin）
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL AND p_actor_id IS NOT NULL THEN
    SELECT * INTO v_caller FROM employees WHERE id = p_actor_id;
  END IF;
  IF v_caller.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND');
  END IF;
  -- admin/super_admin 或 具 clock.correction_edit 權限（對齊前端「改時間」閘門）
  IF NOT (v_caller.role IN ('admin', 'super_admin')
          OR public.liff_employee_has_permission(v_caller.id, 'clock.correction_edit')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;
  IF p_date IS NULL OR COALESCE(btrim(p_clock_in), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLOCK_IN_REQUIRED');
  END IF;

  v_org := v_emp.organization_id;
  v_ci  := p_clock_in::time;
  v_co  := NULLIF(btrim(p_clock_out), '')::time;

  -- 工時（有下班卡才算;net_work_hours 失敗回 NULL）
  IF v_co IS NOT NULL THEN
    v_net := public.net_work_hours(p_emp_id, p_date, v_ci, v_co);
  END IF;

  -- 同 (員工, 日期) 已有 → 更新;否則新增
  SELECT id, clock_in::text, clock_out::text
    INTO v_rec_id, v_old_ci, v_old_co
    FROM attendance_records
   WHERE employee_id = p_emp_id AND date = p_date
   LIMIT 1;

  IF v_rec_id IS NULL THEN
    INSERT INTO attendance_records (
      employee_id, employee, date, clock_in, clock_out,
      total_hours, hours, status, source, clock_in_mode, clock_out_mode,
      organization_id, store_id
    ) VALUES (
      p_emp_id, v_emp.name, p_date, v_ci, v_co,
      COALESCE(v_net, 0), COALESCE(v_net, 0), '正常', 'hr_backfill', 'normal',
      CASE WHEN v_co IS NOT NULL THEN 'normal' END,
      v_org, v_emp.store_id
    )
    RETURNING id INTO v_rec_id;
  ELSE
    UPDATE attendance_records
       SET clock_in    = v_ci,
           clock_out   = v_co,
           total_hours = COALESCE(v_net, total_hours),
           hours       = COALESCE(v_net, hours)
     WHERE id = v_rec_id;
  END IF;

  -- 稽核（沿用「改時間」同一張表）
  INSERT INTO attendance_clock_edits (
    attendance_record_id, employee, date,
    old_clock_in, new_clock_in, old_clock_out, new_clock_out,
    reason, edited_by, edited_by_id, organization_id
  ) VALUES (
    v_rec_id, v_emp.name, p_date,
    v_old_ci, p_clock_in, v_old_co, NULLIF(btrim(p_clock_out), ''),
    'HR補登：' || p_reason, v_caller.name, v_caller.id, v_org
  );

  RETURN jsonb_build_object('ok', true, 'record_id', v_rec_id, 'net_hours', v_net,
                            'action', CASE WHEN v_old_ci IS NULL AND v_old_co IS NULL THEN 'insert' ELSE 'update' END);
END $$;

REVOKE ALL ON FUNCTION public.hr_backfill_attendance(int,date,text,text,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_backfill_attendance(int,date,text,text,text,int) TO authenticated;

NOTIFY pgrst, 'reload schema';
