-- 離職生效統一為「最後工作日當天仍在職,隔天才離職」 — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- 慘案:員工 resign_date=7/31(最後工作日=今天),今天卻已是「離職」→ 打卡被擋
--   (_liff_resolve_employee 要 status='在職',離職者 LINE 打卡直接 EMPLOYEE_NOT_FOUND),
--   最後一天上班卻打不了卡。
-- 成因(規則不一致):
--   - resign_employee(前端 OffboardingModal 走的)一處理就立刻 status='離職',沒日期閘門。
--   - apply_employee_resignation(Severance 資遣 + cron 走的)閘門是 resign_date > 今天 才維持在職,
--     = 今天當天就立刻離職。
--   - cron _process_effective_resignations 用 resign_date <= 今天,當天就翻。
--   但計薪/排班/打卡都把 resign_date 當「含當天的最後工作日」→ 狀態也該做到當天才對。
-- 統一規則:resign_date = 最後工作日(含當天)。resign_date >= 今天 → 維持在職;< 今天 → 轉離職。
--   ① apply 閘門 > → >=  ② cron <= → <  ③ resign_employee 最後 UPDATE 加同款閘門
--   ④ 已被提前翻離職且 resign_date>=今天者,翻回在職(留 resign_date,到期由 cron 轉)
-- 台灣日期一律 (now() AT TIME ZONE 'Asia/Taipei')::date。
-- ════════════════════════════════════════════════════════════════════════════

-- ① apply_employee_resignation:閘門 > 今天 → >= 今天(最後工作日當天也維持在職)
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

-- ② _process_effective_resignations:每日 cron 條件 resign_date <= 今天 → < 今天(最後工作日隔天才轉)
CREATE OR REPLACE FUNCTION public._process_effective_resignations()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r RECORD; v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date; v_count int := 0;
BEGIN
  FOR r IN
    SELECT id, resign_date, resign_reason, resign_type
      FROM public.employees
     WHERE status = '在職'
       AND resign_date IS NOT NULL
       AND resign_date < v_today                                                  -- ★ 過了最後工作日才轉(不含當天)
       AND resign_date > COALESCE(reinstatement_date, join_date, DATE '1900-01-01')  -- 防回鍋舊 resign_date
  LOOP
    PERFORM public.apply_employee_resignation(r.id, r.resign_date, r.resign_reason, COALESCE(r.resign_type,'voluntary'));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;

-- ③ resign_employee:最後的 status UPDATE 加日期閘門(離職日 >= 今天 → 維持在職);其餘(代理轉移/log)不動
CREATE OR REPLACE FUNCTION public.resign_employee(p_emp_id integer, p_new_status text, p_resign_date date DEFAULT NULL::date, p_chain_delegate_id integer DEFAULT NULL::integer, p_store_delegate_id integer DEFAULT NULL::integer, p_dept_delegate_id integer DEFAULT NULL::integer, p_authorized_by_emp_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp           public.employees;
  v_chain_del     public.employees;
  v_store_del     public.employees;
  v_dept_del      public.employees;
  v_step_ids      INT[];
  v_snap_ids      INT[];
  v_store_ids     INT[];
  v_dept_ids      INT[];
  v_log_id        INT;
  v_auth_name     TEXT;
  v_eff_date      DATE;
  v_today         DATE := (now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
  IF p_new_status NOT IN ('離職', '留職停薪') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 查操作人名稱（供 audit_logs.user）
  SELECT name INTO v_auth_name FROM public.employees WHERE id = p_authorized_by_emp_id;

  -- ── Validate each delegate ──────────────────────────
  -- 三個都不能是員工本人（否則轉給自己後狀態改離職，chain 仍指向離職員工）

  IF p_chain_delegate_id IS NOT NULL THEN
    IF p_chain_delegate_id = p_emp_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CHAIN_DELEGATE_CANNOT_BE_SELF');
    END IF;
    SELECT * INTO v_chain_del FROM public.employees
    WHERE id = p_chain_delegate_id AND status = '在職';
    IF v_chain_del.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CHAIN_DELEGATE_NOT_ACTIVE');
    END IF;
  END IF;

  IF p_store_delegate_id IS NOT NULL THEN
    IF p_store_delegate_id = p_emp_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'STORE_DELEGATE_CANNOT_BE_SELF');
    END IF;
    SELECT * INTO v_store_del FROM public.employees
    WHERE id = p_store_delegate_id AND status = '在職';
    IF v_store_del.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'STORE_DELEGATE_NOT_ACTIVE');
    END IF;
  END IF;

  IF p_dept_delegate_id IS NOT NULL THEN
    IF p_dept_delegate_id = p_emp_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'DEPT_DELEGATE_CANNOT_BE_SELF');
    END IF;
    SELECT * INTO v_dept_del FROM public.employees
    WHERE id = p_dept_delegate_id AND status = '在職';
    IF v_dept_del.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'DEPT_DELEGATE_NOT_ACTIVE');
    END IF;
  END IF;

  -- ── Chain steps + snapshots ─────────────────────────

  IF p_chain_delegate_id IS NOT NULL THEN
    SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::INT[]) INTO v_step_ids
    FROM public.approval_chain_steps
    WHERE target_type = 'fixed_emp' AND target_emp_id = p_emp_id;

    IF COALESCE(array_length(v_step_ids, 1), 0) > 0 THEN
      UPDATE public.approval_chain_steps
      SET target_emp_id = p_chain_delegate_id
      WHERE id = ANY(v_step_ids);
    END IF;

    SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::INT[]) INTO v_snap_ids
    FROM public.request_chain_snapshots
    WHERE target_type = 'fixed_emp' AND target_emp_id = p_emp_id;

    IF COALESCE(array_length(v_snap_ids, 1), 0) > 0 THEN
      UPDATE public.request_chain_snapshots
      SET target_emp_id = p_chain_delegate_id
      WHERE id = ANY(v_snap_ids);
    END IF;
  END IF;

  -- ── Managed stores ──────────────────────────────────

  IF p_store_delegate_id IS NOT NULL THEN
    SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::INT[]) INTO v_store_ids
    FROM public.stores WHERE manager_id = p_emp_id;

    IF COALESCE(array_length(v_store_ids, 1), 0) > 0 THEN
      UPDATE public.stores SET manager_id = p_store_delegate_id
      WHERE id = ANY(v_store_ids);
    END IF;
  END IF;

  -- ── Managed departments ─────────────────────────────

  IF p_dept_delegate_id IS NOT NULL THEN
    SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::INT[]) INTO v_dept_ids
    FROM public.departments WHERE manager_id = p_emp_id;

    IF COALESCE(array_length(v_dept_ids, 1), 0) > 0 THEN
      UPDATE public.departments SET manager_id = p_dept_delegate_id
      WHERE id = ANY(v_dept_ids);
    END IF;
  END IF;

  -- ── Delegate log (以 chain delegate 為主記錄人) ─────

  INSERT INTO public.employee_delegate_log (
    original_emp_id, delegate_emp_id, trigger_action,
    chain_step_ids, snapshot_ids, store_ids, dept_ids,
    authorized_by_emp_id, notes
  ) VALUES (
    p_emp_id,
    COALESCE(p_chain_delegate_id, p_store_delegate_id, p_dept_delegate_id, p_emp_id),
    p_new_status,
    COALESCE(v_step_ids,  ARRAY[]::INT[]),
    COALESCE(v_snap_ids,  ARRAY[]::INT[]),
    COALESCE(v_store_ids, ARRAY[]::INT[]),
    COALESCE(v_dept_ids,  ARRAY[]::INT[]),
    p_authorized_by_emp_id,
    -- 記錄各類別承接人（三人可能不同）
    CASE
      WHEN p_chain_delegate_id IS DISTINCT FROM p_store_delegate_id
        OR p_chain_delegate_id IS DISTINCT FROM p_dept_delegate_id
      THEN 'chain:' || COALESCE(v_chain_del.name,'—')
        || ' store:' || COALESCE(v_store_del.name,'—')
        || ' dept:'  || COALESCE(v_dept_del.name,'—')
      ELSE NULL
    END
  ) RETURNING id INTO v_log_id;

  -- ── Audit log ───────────────────────────────────────

  INSERT INTO public.audit_logs ("user", action, target, target_table, target_id, old_value, new_value)
  VALUES (
    v_auth_name,
    'resign_with_handoff',
    v_emp.name,
    'employees',
    p_emp_id,
    'status: ' || COALESCE(v_emp.status, '在職'),
    'status: '      || p_new_status
      || ' | chain_del: ' || COALESCE(v_chain_del.name, '無')
      || ' | store_del: ' || COALESCE(v_store_del.name, '無')
      || ' | dept_del: '  || COALESCE(v_dept_del.name,  '無')
      || ' | steps: '     || COALESCE(array_length(v_step_ids,  1), 0)::text
      || ' | snaps: '     || COALESCE(array_length(v_snap_ids,  1), 0)::text
  );

  -- ── Update employee ─────────────────────────────────
  -- ★ 離職日期閘門(對齊 apply_employee_resignation / _process_effective_resignations):
  --   離職 且「離職日 >= 今天(台灣)」= 最後工作日還沒過(含當天)→ 維持在職
  --   (照常排班/打卡/計薪到最後一天),隔天由每日 cron 轉離職。
  --   離職日已過、或留職停薪 → 立刻生效。代理轉移已在上方完成(責任提前交接)。
  v_eff_date := COALESCE(p_resign_date, v_emp.resign_date);

  UPDATE public.employees
  SET status = CASE
                 WHEN p_new_status = '離職' AND v_eff_date IS NOT NULL AND v_eff_date >= v_today
                   THEN '在職'
                 ELSE p_new_status
               END,
      resign_date = COALESCE(p_resign_date, resign_date)
  WHERE id = p_emp_id;

  -- 離職日之後的班不該存在(對齊 apply_employee_resignation)
  IF p_new_status = '離職' AND v_eff_date IS NOT NULL THEN
    DELETE FROM public.schedules WHERE employee_id = p_emp_id AND date > v_eff_date;
  END IF;

  RETURN jsonb_build_object(
    'ok',                true,
    'log_id',            v_log_id,
    'chain_steps_count', COALESCE(array_length(v_step_ids,  1), 0),
    'snapshots_count',   COALESCE(array_length(v_snap_ids,  1), 0),
    'stores_count',      COALESCE(array_length(v_store_ids, 1), 0),
    'depts_count',       COALESCE(array_length(v_dept_ids,  1), 0),
    'kept_active',       (p_new_status = '離職' AND v_eff_date IS NOT NULL AND v_eff_date >= v_today)
  );
END $function$;

-- ④ 修正已被提前翻離職、但最後工作日還沒過(resign_date >= 今天)的人 → 翻回在職
--    (留 resign_date;最後工作日隔天由每日 cron 自動轉離職)。當前為 吳昕芛/孫嘉澤(resign_date=今天)。
UPDATE public.employees
   SET status = '在職'
 WHERE status = '離職'
   AND resign_date IS NOT NULL
   AND resign_date >= (now() AT TIME ZONE 'Asia/Taipei')::date;

-- 確保每日 cron 有掛(重掛,指向修正後的函式;台灣 08:05 = UTC 00:05)
DO $do$
BEGIN
  BEGIN PERFORM cron.unschedule('process_effective_resignations'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('process_effective_resignations', '5 0 * * *',
    $cron$SELECT public._process_effective_resignations()$cron$);
END $do$;

NOTIFY pgrst, 'reload schema';
