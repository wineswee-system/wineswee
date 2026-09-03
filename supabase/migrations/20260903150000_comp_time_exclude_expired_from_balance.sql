-- 補休到期日隔天就不能再休:餘額/扣款排除「已過期(expires_at < 今天)」的筆。
-- 現況洞:到期的筆在算薪結清前仍 status='active',而餘額/扣款函式沒濾到期日 →
--   到期後、算薪結清前那段期間,員工還看得到餘額、還能拿去休(可能又休又被折現)。
-- 修:三支加 expires_at >= CURRENT_DATE(到期當天仍可用,隔天起排除)。
-- 折現不變:仍在 generate_payroll 的 _settle_expired_comp_time(expires_at < 月底)結算入薪。

CREATE OR REPLACE FUNCTION public.get_comp_time_balance(p_employee_id integer)
 RETURNS TABLE(ledger_id bigint, ot_date date, expires_at date, hours numeric, hours_used numeric, hours_remaining numeric, frozen_ot_amount numeric, days_to_expire integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    l.id, l.ot_date, l.expires_at, l.hours, l.hours_used,
    (l.hours - l.hours_used - l.hours_reserved)::NUMERIC,
    l.frozen_ot_amount,
    (l.expires_at - CURRENT_DATE)::INT
  FROM public.comp_time_ledger l
  WHERE l.employee_id = p_employee_id
    AND l.status = 'active'
    AND l.expires_at >= CURRENT_DATE            -- ★ 排除已過期(到期當天仍可用)
    AND (l.hours - l.hours_used - l.hours_reserved) > 0
  ORDER BY l.expires_at ASC;
END $function$;

CREATE OR REPLACE FUNCTION public.liff_get_my_comp_time_balance(p_line_user_id text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  v_total NUMERIC;
  v_reserved NUMERIC;
  v_ledgers JSON;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'employee_not_found');
  END IF;

  SELECT
    COALESCE(SUM(hours - hours_used), 0),
    COALESCE(SUM(hours_reserved), 0),
    COALESCE(json_agg(json_build_object(
      'ledger_id', id, 'ot_date', ot_date, 'expires_at', expires_at,
      'hours', hours, 'hours_used', hours_used,
      'hours_remaining', (hours - hours_used),
      'frozen_ot_amount', frozen_ot_amount,
      'days_to_expire', (expires_at - CURRENT_DATE)::INT
    ) ORDER BY expires_at ASC), '[]'::json)
  INTO v_total, v_reserved, v_ledgers
  FROM comp_time_ledger
  WHERE employee_id = emp.id
    AND status = 'active'
    AND expires_at >= CURRENT_DATE            -- ★ 排除已過期
    AND (hours - hours_used) > 0;

  RETURN json_build_object(
    'ok', true, 'total_remaining', v_total,
    'total_reserved', v_reserved, 'ledgers', v_ledgers
  );
END $function$;

CREATE OR REPLACE FUNCTION public.deduct_comp_time(p_leave_request_id integer, p_employee_id integer, p_hours numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining NUMERIC := p_hours;
  v_available NUMERIC;
  v_take      NUMERIC;
  v_used      JSON[] := ARRAY[]::JSON[];
  rec         RECORD;
  v_confirmed BOOLEAN;
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_hours');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('comp_time:' || p_employee_id));

  SELECT (status = '已核准') INTO v_confirmed FROM public.leave_requests WHERE id = p_leave_request_id;
  v_confirmed := COALESCE(v_confirmed, false);

  SELECT COALESCE(SUM(hours - hours_used - hours_reserved), 0) INTO v_available
    FROM comp_time_ledger
   WHERE employee_id = p_employee_id AND status = 'active'
     AND expires_at >= CURRENT_DATE;          -- ★ 排除已過期

  IF v_available < p_hours THEN
    RETURN json_build_object('ok', false, 'error', 'insufficient_balance',
                             'available', v_available, 'requested', p_hours);
  END IF;

  FOR rec IN
    SELECT id, (hours - hours_used - hours_reserved) AS remaining
      FROM comp_time_ledger
     WHERE employee_id = p_employee_id
       AND status = 'active'
       AND expires_at >= CURRENT_DATE          -- ★ 排除已過期(不從過期筆扣)
       AND (hours - hours_used - hours_reserved) > 0
     ORDER BY expires_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(rec.remaining, v_remaining);

    IF v_confirmed THEN
      UPDATE comp_time_ledger
         SET hours_used = hours_used + v_take,
             status = CASE WHEN (hours_used + v_take) >= hours THEN 'exhausted' ELSE status END
       WHERE id = rec.id;
    ELSE
      UPDATE comp_time_ledger SET hours_reserved = hours_reserved + v_take WHERE id = rec.id;
    END IF;

    INSERT INTO comp_time_usages (leave_request_id, comp_time_ledger_id, hours_used, status)
    VALUES (p_leave_request_id, rec.id, v_take, CASE WHEN v_confirmed THEN 'confirmed' ELSE 'reserved' END);

    v_used := v_used || json_build_object('ledger_id', rec.id, 'hours', v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;

  RETURN json_build_object('ok', true, 'confirmed', v_confirmed, 'items', array_to_json(v_used));
END $function$;
