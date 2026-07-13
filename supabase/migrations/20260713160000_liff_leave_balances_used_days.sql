-- LIFF 假別餘額 RPC 加回 used_days + expires_at（LIFF 已休才能對齊 104）
-- 2026-07-13  liff_get_my_leave_balances 原只回 total_days/carry_over_days,LIFF 已休自己從
--   請假單算(髒)。加 used_days(104 匯入的權威已休)+ expires_at(可休期間)。signature 改→先 DROP。
--   idempotent。

-- period_start 欄位(20260713170000 也會加,此處先確保存在,避免 migration 順序問題)
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS period_start date;

DROP FUNCTION IF EXISTS public.liff_get_my_leave_balances(text, integer);
CREATE OR REPLACE FUNCTION public.liff_get_my_leave_balances(p_line_user_id text, p_year integer DEFAULT NULL::integer)
 RETURNS TABLE(leave_type text, total_days numeric, used_days numeric, carry_over_days numeric, period_start date, expires_at date)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    lb.leave_type,
    lb.total_days,
    lb.used_days,
    lb.carry_over_days,
    lb.period_start,
    lb.expires_at
  FROM public.leave_balances lb
  JOIN public.employee_line_accounts ela ON ela.employee_id = lb.employee_id
  WHERE ela.line_user_id = p_line_user_id
    AND lb.year = COALESCE(p_year, EXTRACT(YEAR FROM NOW())::int)
$function$;

NOTIFY pgrst, 'reload schema';
