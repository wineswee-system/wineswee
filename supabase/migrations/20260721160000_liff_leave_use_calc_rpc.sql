-- LIFF 請假改用單一來源計算 — 2026-07-21 [階段4/4 LIFF]
-- liff_insert_leave_request 原本插 client 送的 days/hours(與 web 各算一份)。
-- 改:內部用 leave_calc_days_hours 後端重算(忽略 client 值)→ LIFF 與 web/手機 同一套算法。
-- ★ 只改「days/hours 改後端算」;員工解析 / 補休餘額 guard / 補休扣帳 全部原封不動保留。
-- unit 由「有無 start_time」推;type 是短名 → 反查 leave_types.code 解 step(門市→全公司→假別預設)。

CREATE OR REPLACE FUNCTION public.liff_insert_leave_request(p_line_user_id text, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  new_id int;
  v_type TEXT;          -- 短名(如 '補休')
  v_code TEXT;
  v_unit TEXT;
  v_step numeric;
  v_step_unit text;
  v_calc json;
  v_days numeric;
  v_hours NUMERIC;
  v_deduct JSON;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  v_type := p_payload->>'type';

  -- 反查 code(payload 傳短名)→ 解 step
  SELECT code INTO v_code FROM public.leave_types
   WHERE short_name = v_type OR name = v_type OR code = v_type LIMIT 1;

  v_unit := CASE WHEN NULLIF(p_payload->>'start_time','') IS NOT NULL THEN 'hour' ELSE 'day' END;

  IF v_code IS NOT NULL THEN
    SELECT step, unit INTO v_step, v_step_unit
      FROM public.leave_step_settings WHERE leave_code = v_code AND store_id = emp.store_id LIMIT 1;
    IF v_step IS NULL THEN
      SELECT step, unit INTO v_step, v_step_unit
        FROM public.leave_step_settings WHERE leave_code = v_code AND store_id IS NULL LIMIT 1;
    END IF;
    IF v_step IS NULL THEN
      SELECT min_unit, unit INTO v_step, v_step_unit FROM public.leave_types WHERE code = v_code;
    END IF;
  END IF;
  IF v_step IS NULL THEN
    v_step := 0.5; v_step_unit := CASE WHEN v_unit = 'hour' THEN 'hour' ELSE 'day' END;
  END IF;

  -- ★ 後端算天數/時數(單一來源,忽略 client 送的 days/hours)
  v_calc := public.leave_calc_days_hours(
    v_unit,
    (p_payload->>'start_date')::date,
    COALESCE((p_payload->>'end_date')::date, (p_payload->>'start_date')::date),
    NULLIF(p_payload->>'start_time','')::time,
    NULLIF(p_payload->>'end_time','')::time,
    v_step, v_step_unit
  );
  v_days  := (v_calc->>'days')::numeric;
  v_hours := (v_calc->>'hours')::numeric;

  -- 補休前置 guard(用後端算的 hours;邏輯不變)
  IF v_type = '補休' THEN
    IF v_hours IS NULL OR v_hours <= 0 THEN
      RAISE EXCEPTION 'comp_time hours invalid';
    END IF;
    DECLARE
      v_avail NUMERIC;
    BEGIN
      SELECT COALESCE(SUM(hours - hours_used), 0) INTO v_avail
        FROM comp_time_ledger
       WHERE employee_id = emp.id AND status = 'active';
      IF v_avail < v_hours THEN
        RAISE EXCEPTION '補休餘額不足：剩 % 小時，需請 % 小時', v_avail, v_hours;
      END IF;
    END;
  END IF;

  INSERT INTO public.leave_requests (
    employee_id, employee, type, start_date, end_date, days, hours,
    start_time, end_time, reason, status, organization_id
  )
  VALUES (
    emp.id, emp.name, v_type,
    (p_payload->>'start_date')::date,
    CASE WHEN v_unit = 'hour' THEN (p_payload->>'start_date')::date
         ELSE COALESCE((p_payload->>'end_date')::date, (p_payload->>'start_date')::date) END,
    v_days, v_hours,
    CASE WHEN v_unit = 'hour' THEN NULLIF(p_payload->>'start_time','')::time ELSE NULL END,
    CASE WHEN v_unit = 'hour' THEN NULLIF(p_payload->>'end_time','')::time ELSE NULL END,
    p_payload->>'reason',
    COALESCE(p_payload->>'status', '待審核'),
    emp.organization_id
  )
  RETURNING id INTO new_id;

  -- 補休:同 txn 扣 ledger(不變)
  IF v_type = '補休' THEN
    v_deduct := public.deduct_comp_time(new_id, emp.id, v_hours);
    IF NOT COALESCE((v_deduct->>'ok')::BOOLEAN, false) THEN
      RAISE EXCEPTION '補休扣帳失敗：%', v_deduct;
    END IF;
  END IF;

  RETURN json_build_object('id', new_id);
END $function$;

NOTIFY pgrst, 'reload schema';
