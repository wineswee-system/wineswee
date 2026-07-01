-- LIFF 讀取個人假別餘額（leave_balances table）
-- 讓 LIFF 跟主系統對齊：有 DB 記錄就用 DB 的 total_days，沒有就 fallback 法定上限
-- idempotent
-- 2026-07-01

DROP FUNCTION IF EXISTS public.liff_get_my_leave_balances(text, int);

CREATE OR REPLACE FUNCTION public.liff_get_my_leave_balances(
  p_line_user_id text,
  p_year         int DEFAULT NULL
)
RETURNS TABLE (
  leave_type      text,
  total_days      numeric,
  carry_over_days numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    lb.leave_type,
    lb.total_days,
    lb.carry_over_days
  FROM public.leave_balances lb
  JOIN public.employee_line_accounts ela ON ela.employee_id = lb.employee_id
  WHERE ela.line_user_id = p_line_user_id
    AND lb.year = COALESCE(p_year, EXTRACT(YEAR FROM NOW())::int)
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_my_leave_balances(text, int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
