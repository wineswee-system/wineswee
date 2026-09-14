-- 營運獎金辦法 Phase 1 收尾:LIFF 員工端獎金讀取加「管理獎金」欄位(mgmt_bonus)
--   Phase1 已把損益獎金(profit_bonus)換成管理獎金(mgmt_bonus),LIFF 讀取要一起帶出來。
CREATE OR REPLACE FUNCTION public.liff_get_my_store_bonus(p_line_user_id text, p_limit integer DEFAULT 12)
 RETURNS json
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  RETURN json_build_object('ok', true, 'records', (
    SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.year_month DESC), '[]'::json)
    FROM (
      SELECT
        m.year_month            AS year_month,
        e.net_bonus             AS net_bonus,
        e.total_bonus           AS total_bonus,
        e.mgmt_bonus            AS mgmt_bonus,
        e.profit_bonus          AS profit_bonus,
        e.target_bonus          AS target_bonus,
        e.merit_bonus           AS merit_bonus,
        e.audit_deduction       AS audit_deduction,
        e.punch_deduction       AS punch_deduction,
        e.custom_adjust         AS custom_adjust,
        e.prev_month_supplement AS prev_month_supplement,
        e.notes                 AS notes
      FROM public.store_bonus_employee e
      JOIN public.store_bonus_monthly m ON m.id = e.monthly_id
      WHERE e.employee_id = emp.id AND m.status = 'finalized'
      ORDER BY m.year_month DESC
      LIMIT GREATEST(1, COALESCE(p_limit, 12))
    ) t
  ));
END $function$;

NOTIFY pgrst, 'reload schema';
