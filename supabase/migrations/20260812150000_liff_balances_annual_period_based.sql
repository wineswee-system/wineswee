-- 2026-08-12 liff_get_my_leave_balances 特休改「期間制」而非「曆年釘死」。
-- 問題:特休週年制跨曆年,現在期可能存在 year=前一年的列(如週年月在下半年者:劉家君 current=2025列、
--       王澤昇 year=2025 period_start NULL)。原 RPC 只抓 year=當年(2026)→ LIFF 顯示/前端 miss 現在期
--       (王澤昇顯示0且被前端擋、劉家君抓到未來那期顯示剩10 但實際0)。後端送出 RPC 是照期間含今天選列所以正確,只有此顯示 RPC 錯。
-- 修:leave_type='annual' 一律照「期間含今天」選現在期(忽略 year 欄);其餘曆年制假別照傳入 p_year(額度頁年份選單)、預設當年。
-- 影響:額度頁/送出頁的特休一律顯示現在期(週年月在下半年者不再看到未來期或空白);正職現在期=year當年者無變化。

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
    AND (
      CASE WHEN lb.leave_type = 'annual'
        -- 特休:照「期間含今天」選現在期(週年制跨曆年也對;period_start NULL 視為已生效)
        THEN (lb.period_start IS NULL OR lb.period_start <= (now() AT TIME ZONE 'Asia/Taipei')::date)
         AND (lb.expires_at  IS NULL OR lb.expires_at  >= (now() AT TIME ZONE 'Asia/Taipei')::date)
        -- 其餘曆年制假別:照傳入年份(額度頁選單),預設當年
        ELSE lb.year = COALESCE(p_year, EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Taipei'))::int)
      END
    )
$function$;
