-- 補休可用餘額扣掉「預留(簽核中)」— 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 接續 150000 軟扣:送出=hours_reserved 預留。get_comp_time_balance 原本
--   hours_remaining = hours - hours_used(沒扣預留)→ 請假表單顯示的「可用」會虛高,
--   員工可能看到 8h 就再送一張(雖然 DB deduct 會擋超額,但顯示誤導)。
-- 改:hours_remaining = hours - hours_used - hours_reserved(=真正可申請),過濾同步。
-- 只動這一支唯讀 RPC,不影響扣款邏輯。idempotent。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_comp_time_balance(p_employee_id integer)
 RETURNS TABLE(ledger_id bigint, ot_date date, expires_at date, hours numeric, hours_used numeric, hours_remaining numeric, frozen_ot_amount numeric, days_to_expire integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    l.id,
    l.ot_date,
    l.expires_at,
    l.hours,
    l.hours_used,
    (l.hours - l.hours_used - l.hours_reserved)::NUMERIC,   -- 可申請=可休−已休−簽核中預留
    l.frozen_ot_amount,
    (l.expires_at - CURRENT_DATE)::INT
  FROM public.comp_time_ledger l
  WHERE l.employee_id = p_employee_id
    AND l.status = 'active'
    AND (l.hours - l.hours_used - l.hours_reserved) > 0
  ORDER BY l.expires_at ASC;
END $function$;

NOTIFY pgrst, 'reload schema';
