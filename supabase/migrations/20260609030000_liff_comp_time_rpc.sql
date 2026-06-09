-- ════════════════════════════════════════════════════════════════════════════
-- LIFF RPC 加入「補休」支援
--
-- 主系統的 comp_time 功能（20260609010000 / 020000）已就緒；
-- LIFF 也要能：
--   1. 員工申請加班時選 pay / comp_time
--   2. 員工請假時選「補休」假別 → 自動扣 ledger
--   3. 員工查自己補休餘額
--   4. 員工撤回 補休請假 → 自動退還 ledger
--
-- 變動：
--   A. liff_insert_overtime_request / liff_update_overtime_request：payload 加 ot_type
--   B. liff_insert_leave_request：type='補休' 時呼叫 deduct_comp_time（同 txn 原子操作）
--   C. liff_update_leave_request：原本 type='補休' 不准改（要員工先撤回再重申）
--   D. liff_delete_leave_request：type='補休' 時先退還 ledger
--   E. 新 RPC liff_get_my_comp_time_balance(line_user_id)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── A. OT insert/update 加 ot_type ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_insert_overtime_request(p_line_user_id text, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  new_id int;
  v_ot_type TEXT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  -- ot_type 預設 pay；只允許 pay / comp_time
  v_ot_type := COALESCE(NULLIF(p_payload->>'ot_type', ''), 'pay');
  IF v_ot_type NOT IN ('pay', 'comp_time') THEN
    v_ot_type := 'pay';
  END IF;

  INSERT INTO public.overtime_requests (
    employee_id, employee, date, start_time, end_time, hours, reason, store, status,
    organization_id, ot_type
  )
  VALUES (
    emp.id, emp.name,
    (p_payload->>'date')::date,
    NULLIF(p_payload->>'start_time', '')::time,
    NULLIF(p_payload->>'end_time', '')::time,
    (p_payload->>'hours')::numeric,
    p_payload->>'reason',
    p_payload->>'store',
    COALESCE(p_payload->>'status', '待審核'),
    emp.organization_id,
    v_ot_type
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_overtime_request(text, json) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.liff_update_overtime_request(p_line_user_id text, p_id int, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  n int;
  v_ot_type TEXT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);

  v_ot_type := COALESCE(NULLIF(p_payload->>'ot_type', ''), 'pay');
  IF v_ot_type NOT IN ('pay', 'comp_time') THEN
    v_ot_type := 'pay';
  END IF;

  UPDATE public.overtime_requests SET
    date       = (p_payload->>'date')::date,
    start_time = NULLIF(p_payload->>'start_time', '')::time,
    end_time   = NULLIF(p_payload->>'end_time', '')::time,
    hours      = (p_payload->>'hours')::numeric,
    reason     = p_payload->>'reason',
    store      = p_payload->>'store',
    ot_type    = v_ot_type
  WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('updated', n);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_overtime_request(text, int, json) TO anon, authenticated;


-- ─── B. Leave insert：補休自動扣 ledger ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_insert_leave_request(p_line_user_id text, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  new_id int;
  v_type TEXT;
  v_hours NUMERIC;
  v_deduct JSON;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  v_type  := p_payload->>'type';
  v_hours := COALESCE(
    NULLIF(p_payload->>'hours','')::numeric,
    COALESCE((p_payload->>'days')::numeric, 1) * 8
  );

  -- 補休前置 guard：先檢查餘額夠不夠（避免插入 leave 才發現失敗）
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
    emp.id, emp.name,
    v_type,
    (p_payload->>'start_date')::date,
    COALESCE((p_payload->>'end_date')::date, (p_payload->>'start_date')::date),
    COALESCE((p_payload->>'days')::numeric, 1),
    NULLIF(p_payload->>'hours','')::numeric,
    NULLIF(p_payload->>'start_time','')::time,
    NULLIF(p_payload->>'end_time','')::time,
    p_payload->>'reason',
    COALESCE(p_payload->>'status', '待審核'),
    emp.organization_id
  )
  RETURNING id INTO new_id;

  -- 補休：同 txn 扣 ledger
  IF v_type = '補休' THEN
    v_deduct := public.deduct_comp_time(new_id, emp.id, v_hours);
    IF NOT COALESCE((v_deduct->>'ok')::BOOLEAN, false) THEN
      RAISE EXCEPTION '補休扣帳失敗：%', v_deduct;
    END IF;
  END IF;

  RETURN json_build_object('id', new_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_leave_request(text, json) TO anon, authenticated;


-- ─── C. Leave update：補休不准改（要員工先撤回再申請）─────────────────────
CREATE OR REPLACE FUNCTION public.liff_update_leave_request(p_line_user_id text, p_id int, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  n int;
  v_existing_type TEXT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);

  SELECT type INTO v_existing_type
    FROM leave_requests
   WHERE id = p_id AND employee_id = emp.id;

  IF v_existing_type = '補休' THEN
    RAISE EXCEPTION '補休請假不能直接編輯，請先撤回再重新申請';
  END IF;
  IF p_payload->>'type' = '補休' THEN
    RAISE EXCEPTION '不能把現有假別改成補休，請撤回後重新申請';
  END IF;

  UPDATE public.leave_requests SET
    type = p_payload->>'type',
    start_date = (p_payload->>'start_date')::date,
    end_date = COALESCE((p_payload->>'end_date')::date, (p_payload->>'start_date')::date),
    days = COALESCE((p_payload->>'days')::numeric, days),
    hours = NULLIF(p_payload->>'hours','')::numeric,
    start_time = NULLIF(p_payload->>'start_time','')::time,
    end_time = NULLIF(p_payload->>'end_time','')::time,
    reason = p_payload->>'reason'
  WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('updated', n);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_leave_request(text, int, json) TO anon, authenticated;


-- ─── D. Leave delete：補休先退還 ledger（逆向 deduct）─────────────────────
CREATE OR REPLACE FUNCTION public.liff_delete_leave_request(p_line_user_id text, p_id int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  n int;
  v_type TEXT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);

  SELECT type INTO v_type FROM leave_requests WHERE id = p_id AND employee_id = emp.id;

  -- 補休：刪 leave 之前先把 ledger 退回去
  IF v_type = '補休' THEN
    UPDATE comp_time_ledger l
       SET hours_used = GREATEST(l.hours_used - u.hours_used, 0),
           status = CASE
                      WHEN l.status = 'exhausted' AND (l.hours_used - u.hours_used) < l.hours
                      THEN 'active' ELSE l.status
                    END
      FROM comp_time_usages u
     WHERE u.leave_request_id = p_id AND l.id = u.comp_time_ledger_id;

    DELETE FROM comp_time_usages WHERE leave_request_id = p_id;
  END IF;

  DELETE FROM public.leave_requests WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_delete_leave_request(text, int) TO anon, authenticated;


-- ─── E. LIFF RPC：查自己補休餘額（包裝 get_comp_time_balance）─────────────
CREATE OR REPLACE FUNCTION public.liff_get_my_comp_time_balance(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_total NUMERIC;
  v_ledgers JSON;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'employee_not_found');
  END IF;

  SELECT
    COALESCE(SUM(hours - hours_used), 0),
    COALESCE(json_agg(json_build_object(
      'ledger_id',       id,
      'ot_date',         ot_date,
      'expires_at',      expires_at,
      'hours',           hours,
      'hours_used',      hours_used,
      'hours_remaining', (hours - hours_used),
      'frozen_ot_amount', frozen_ot_amount,
      'days_to_expire',  (expires_at - CURRENT_DATE)::INT
    ) ORDER BY expires_at ASC), '[]'::json)
  INTO v_total, v_ledgers
  FROM comp_time_ledger
  WHERE employee_id = emp.id
    AND status = 'active'
    AND (hours - hours_used) > 0;

  RETURN json_build_object(
    'ok', true,
    'total_remaining', v_total,
    'ledgers', v_ledgers
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_my_comp_time_balance(text) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
