-- ════════════════════════════════════════════════════════════
-- 加班 / 補打卡 加「實際門市」欄位（員工可能跨門市加班 / 補卡，要記在哪間）
--
-- schema:
--   overtime_requests.store TEXT
--   clock_corrections.store TEXT
--
-- 連帶更新 RPC：
--   liff_insert_overtime_request 寫 store
--   liff_update_overtime_request 寫 store
--   liff_insert_clock_correction 寫 store
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. schema ═══
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS store TEXT;
ALTER TABLE public.clock_corrections ADD COLUMN IF NOT EXISTS store TEXT;


-- ═══ 2. RPC ═══

CREATE OR REPLACE FUNCTION public.liff_insert_overtime_request(p_line_user_id text, p_payload json)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  INSERT INTO public.overtime_requests (
    employee_id, employee, date, hours, reason, store, status, organization_id
  )
  VALUES (
    emp.id, emp.name,
    (p_payload->>'date')::date,
    (p_payload->>'hours')::numeric,
    p_payload->>'reason',
    p_payload->>'store',
    COALESCE(p_payload->>'status', '待審核'),
    emp.organization_id
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_overtime_request(text, json) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.liff_update_overtime_request(p_line_user_id text, p_id int, p_payload json)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  UPDATE public.overtime_requests SET
    date = (p_payload->>'date')::date,
    hours = (p_payload->>'hours')::numeric,
    reason = p_payload->>'reason',
    store = p_payload->>'store'
  WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('updated', n);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_overtime_request(text, int, json) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.liff_insert_clock_correction(p_line_user_id text, p_payload json)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  INSERT INTO public.clock_corrections (
    employee, date, type, correction_time, reason, store, status, organization_id
  )
  VALUES (
    emp.name,
    (p_payload->>'date')::date,
    COALESCE(p_payload->>'type', '上班打卡'),
    NULLIF(p_payload->>'correction_time', '')::time,
    p_payload->>'reason',
    p_payload->>'store',
    '待審核',
    emp.organization_id
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_clock_correction(text, json) TO anon, authenticated;


COMMIT;

NOTIFY pgrst, 'reload schema';
