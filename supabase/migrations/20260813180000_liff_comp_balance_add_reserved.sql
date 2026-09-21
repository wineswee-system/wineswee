-- LIFF 補休卡要顯示「簽核中/可申請」(對齊 web 補休管理 tab):RPC 加回 total_reserved(待審核預留時數)。
-- 可申請 = total_remaining − total_reserved。
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
      'ledger_id',       id,
      'ot_date',         ot_date,
      'expires_at',      expires_at,
      'hours',           hours,
      'hours_used',      hours_used,
      'hours_remaining', (hours - hours_used),
      'frozen_ot_amount', frozen_ot_amount,
      'days_to_expire',  (expires_at - CURRENT_DATE)::INT
    ) ORDER BY expires_at ASC), '[]'::json)
  INTO v_total, v_reserved, v_ledgers
  FROM comp_time_ledger
  WHERE employee_id = emp.id
    AND status = 'active'
    AND (hours - hours_used) > 0;

  RETURN json_build_object(
    'ok', true,
    'total_remaining', v_total,
    'total_reserved', v_reserved,
    'ledgers', v_ledgers
  );
END $function$;
