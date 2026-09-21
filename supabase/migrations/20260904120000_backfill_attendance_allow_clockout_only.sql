-- 打卡追蹤補登:放寬成「上班/下班至少一個」即可(原本硬性要上班 → 不能只補下班)。
CREATE OR REPLACE FUNCTION public.hr_backfill_attendance(p_emp_id integer, p_date date, p_clock_in text, p_clock_out text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_actor_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller employees; v_emp employees;
  v_ci time; v_co time; v_net numeric; v_rec_id int; v_org int; v_old_ci text; v_old_co text;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL AND p_actor_id IS NOT NULL THEN
    SELECT * INTO v_caller FROM employees WHERE id = p_actor_id;
  END IF;
  IF v_caller.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND'); END IF;
  IF NOT (v_caller.role IN ('admin','super_admin')
          OR public.liff_employee_has_permission(v_caller.id, 'clock.correction_edit')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED'); END IF;
  -- ★ 放寬:上班/下班至少一個(可只補下班)
  IF p_date IS NULL OR (COALESCE(btrim(p_clock_in),'')='' AND COALESCE(btrim(p_clock_out),'')='') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLOCK_TIME_REQUIRED');
  END IF;

  v_org := v_emp.organization_id;
  v_ci  := NULLIF(btrim(p_clock_in), '')::time;   -- ★ 可為 null
  v_co  := NULLIF(btrim(p_clock_out), '')::time;

  IF v_ci IS NOT NULL AND v_co IS NOT NULL THEN
    v_net := public.net_work_hours(p_emp_id, p_date, v_ci, v_co);
  END IF;

  SELECT id, clock_in::text, clock_out::text INTO v_rec_id, v_old_ci, v_old_co
    FROM attendance_records WHERE employee_id = p_emp_id AND date = p_date LIMIT 1;

  IF v_rec_id IS NULL THEN
    INSERT INTO attendance_records (
      employee_id, employee, date, clock_in, clock_out,
      total_hours, hours, status, source, clock_in_mode, clock_out_mode, organization_id, store_id
    ) VALUES (
      p_emp_id, v_emp.name, p_date, v_ci, v_co,
      COALESCE(v_net, 0), COALESCE(v_net, 0), '正常', 'hr_backfill',
      'normal', 'normal',   -- 兩欄 NOT NULL(預設 normal),不可給 null
      v_org, v_emp.store_id
    ) RETURNING id INTO v_rec_id;
  ELSE
    UPDATE attendance_records
       SET clock_in = v_ci, clock_out = v_co,
           total_hours = COALESCE(v_net, total_hours), hours = COALESCE(v_net, hours)
     WHERE id = v_rec_id;
  END IF;

  INSERT INTO attendance_clock_edits (
    attendance_record_id, employee, date, old_clock_in, new_clock_in, old_clock_out, new_clock_out,
    reason, edited_by, edited_by_id, organization_id
  ) VALUES (
    v_rec_id, v_emp.name, p_date, v_old_ci, NULLIF(btrim(p_clock_in),''), v_old_co, NULLIF(btrim(p_clock_out),''),
    'HR補登：' || p_reason, v_caller.name, v_caller.id, v_org
  );

  RETURN jsonb_build_object('ok', true, 'record_id', v_rec_id, 'net_hours', v_net,
                            'action', CASE WHEN v_old_ci IS NULL AND v_old_co IS NULL THEN 'insert' ELSE 'update' END);
END $function$;
