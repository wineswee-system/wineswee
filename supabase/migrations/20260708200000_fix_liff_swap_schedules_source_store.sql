-- 修 LIFF 換班/代班：schedules 讀錯欄 store → 真欄 source_store — 2026-07-08
-- 真因(已驗 live):schedules 無 store 欄(真欄 source_store);employees/shift_swaps/
--   shift_cover_requests 的 store 是對的。三支 LIFF 函式讀 schedules.store → 一按就炸。
-- 外科式:只把「讀 schedules 的 store」改 source_store(post_cover/request_swap 用
--   `source_store AS store` 保留下游 v_*.store 引用不變),其餘邏輯一字不動。idempotent。

CREATE OR REPLACE FUNCTION public.liff_list_swap_candidates(p_line_user_id text, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp        employees;
  v_my_store TEXT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(s.source_store, emp.store) INTO v_my_store
    FROM public.schedules s
   WHERE s.date = p_date AND (s.employee_id = emp.id OR s.employee = emp.name)
   LIMIT 1;
  IF v_my_store IS NULL THEN v_my_store := emp.store; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'emp_id', e.id,
      'name', e.name,
      'shift', s.shift,
      'actual_start', s.actual_start,
      'actual_end', s.actual_end
    ) ORDER BY e.name)
    FROM public.schedules s
    JOIN public.employees e ON e.id = s.employee_id OR e.name = s.employee
   WHERE s.date = p_date
     AND COALESCE(s.source_store, e.store) = v_my_store
     AND s.shift IS NOT NULL AND s.shift <> '休'
     AND e.id <> emp.id
     AND e.organization_id = emp.organization_id
     AND e.status = '在職'
  ), '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.liff_post_cover_request(p_line_user_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp           employees;
  v_absent      employees;
  v_date        DATE;
  v_a_sched     record;
  v_store       TEXT;
  v_store_id    INT;
  v_invited     INT[];
  v_expires     TIMESTAMPTZ;
  new_id        INT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  v_date := (p_payload->>'shift_date')::date;
  IF v_date IS NULL OR v_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_DATE');
  END IF;

  SELECT * INTO v_absent FROM public.employees WHERE id = (p_payload->>'absent_emp_id')::int;
  IF v_absent.id IS NULL OR v_absent.organization_id <> emp.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ABSENT_EMP_NOT_FOUND');
  END IF;

  -- 抓缺勤者的班別 snapshot
  SELECT shift, source_store AS store, actual_start, actual_end, actual_hours INTO v_a_sched
    FROM public.schedules
   WHERE date = v_date
     AND (employee_id = v_absent.id OR employee = v_absent.name)
   LIMIT 1;
  IF v_a_sched.shift IS NULL OR v_a_sched.shift = '休' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ABSENT_NO_SHIFT');
  END IF;

  v_store := COALESCE(v_a_sched.store, v_absent.store);
  SELECT id INTO v_store_id FROM public.stores
   WHERE name = v_store AND organization_id = emp.organization_id LIMIT 1;

  -- 主管權限（店長 OR schedule.edit/approve）
  IF NOT (
    EXISTS (SELECT 1 FROM public.stores WHERE id = v_store_id AND manager_id = emp.id)
    OR public.liff_employee_has_permission(emp.id, 'schedule.edit')
    OR public.liff_employee_has_permission(emp.id, 'schedule.approve')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- 找候選人（同店、當天無班、不是缺勤者本人）
  SELECT array_agg(e.id) INTO v_invited
    FROM public.employees e
   WHERE e.organization_id = emp.organization_id
     AND e.status = '在職'
     AND COALESCE(e.store, '') = v_store
     AND e.id <> v_absent.id
     AND NOT EXISTS (
       SELECT 1 FROM public.schedules s
        WHERE s.date = v_date
          AND (s.employee_id = e.id OR s.employee = e.name)
          AND s.shift IS NOT NULL AND s.shift <> ''
     );

  IF v_invited IS NULL OR array_length(v_invited, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_CANDIDATES');
  END IF;

  -- 預設過期時間 24h
  v_expires := COALESCE(
    NULLIF(p_payload->>'expires_at','')::timestamptz,
    now() + interval '24 hours'
  );

  INSERT INTO public.shift_cover_requests (
    organization_id, store, store_id,
    requester_id, requester_name,
    absent_emp_id, absent_emp_name,
    shift_date, shift_label, actual_start, actual_end, actual_hours,
    invited_emp_ids, reason, status, expires_at
  )
  VALUES (
    emp.organization_id, v_store, v_store_id,
    emp.id, emp.name,
    v_absent.id, v_absent.name,
    v_date, v_a_sched.shift, v_a_sched.actual_start, v_a_sched.actual_end, v_a_sched.actual_hours,
    v_invited, NULLIF(p_payload->>'reason',''), '招募中', v_expires
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', new_id,
    'invited_emp_ids', to_jsonb(v_invited),
    'shift_label', v_a_sched.shift,
    'shift_date', v_date,
    'absent_emp_name', v_absent.name
  );
END $function$;

CREATE OR REPLACE FUNCTION public.liff_request_shift_swap(p_line_user_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp_a            employees;
  emp_b            employees;
  v_swap_date      DATE;
  v_a_sched        record;
  v_b_sched        record;
  v_store_id       INT;
  v_store_name     TEXT;
  v_manager_id     INT;
  new_id           INT;
BEGIN
  -- 1. 解析 A
  SELECT * INTO emp_a FROM public._liff_resolve_employee(p_line_user_id);
  IF emp_a.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 2. 解析 B
  SELECT * INTO emp_b FROM public.employees WHERE id = (p_payload->>'target_id')::int;
  IF emp_b.id IS NULL OR emp_b.organization_id <> emp_a.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  END IF;

  IF emp_a.id = emp_b.id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_SWAP_WITH_SELF');
  END IF;

  v_swap_date := (p_payload->>'swap_date')::date;
  IF v_swap_date IS NULL OR v_swap_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_DATE');
  END IF;

  -- 3. 兩人當天都要有班
  SELECT shift, source_store AS store INTO v_a_sched
    FROM public.schedules
   WHERE date = v_swap_date
     AND (employee_id = emp_a.id OR employee = emp_a.name)
   LIMIT 1;
  IF v_a_sched.shift IS NULL OR v_a_sched.shift = '休' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REQUESTER_NO_SHIFT');
  END IF;

  SELECT shift, source_store AS store INTO v_b_sched
    FROM public.schedules
   WHERE date = v_swap_date
     AND (employee_id = emp_b.id OR employee = emp_b.name)
   LIMIT 1;
  IF v_b_sched.shift IS NULL OR v_b_sched.shift = '休' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NO_SHIFT');
  END IF;

  -- 4. 兩人必須同店（用 schedules.source_store 或 employees.store）
  IF COALESCE(v_a_sched.store, emp_a.store) IS DISTINCT FROM COALESCE(v_b_sched.store, emp_b.store) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DIFFERENT_STORE');
  END IF;

  v_store_name := COALESCE(v_a_sched.store, emp_a.store);
  SELECT id, manager_id INTO v_store_id, v_manager_id
    FROM public.stores WHERE name = v_store_name AND organization_id = emp_a.organization_id LIMIT 1;

  -- 5. 同 (A,B,date) 不能有未結案的單
  IF EXISTS (
    SELECT 1 FROM public.shift_swaps
     WHERE swap_date = v_swap_date
       AND ((requester_id = emp_a.id AND target_id = emp_b.id)
         OR (requester_id = emp_b.id AND target_id = emp_a.id))
       AND status IN ('待對方同意', '待主管核准')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DUPLICATE_PENDING_SWAP');
  END IF;

  -- 6. Insert
  INSERT INTO public.shift_swaps (
    requester, requester_id, target, target_id,
    swap_date, requester_shift, target_shift,
    reason, status, organization_id, store, store_id
  ) VALUES (
    emp_a.name, emp_a.id, emp_b.name, emp_b.id,
    v_swap_date, v_a_sched.shift, v_b_sched.shift,
    NULLIF(p_payload->>'reason', ''),
    '待對方同意', emp_a.organization_id, v_store_name, v_store_id
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', new_id,
    'target_emp_id', emp_b.id,
    'target_name', emp_b.name,
    'manager_emp_id', v_manager_id
  );
END $function$;

NOTIFY pgrst, 'reload schema';
