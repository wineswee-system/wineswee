-- 修:LIFF liff_get_my_leave_balances 對特休(週年制)寫死「含今天的現在期」,p_year 沒作用
--     → 員工在 LIFF 翻年度看不到下一期特休(如劉家君卡兩期中間,永遠顯示現在期 剩0)。
-- ★這支同時被「顯示頁(傳 p_year)」和「送出閘門(不傳 p_year)」用,不能一律吃 p_year,
--   否則閘門會拿到未生效的下一期→讓人提早申請。故:
--     p_year IS NULL(閘門)→ 維持「含今天現在期」(對現在期把關,不變);
--     p_year 有值(顯示分頁)→ 該年那期;該年沒列 → 退回含今天現在期。
CREATE OR REPLACE FUNCTION public.liff_get_my_leave_balances(p_line_user_id text, p_year integer DEFAULT NULL::integer)
 RETURNS TABLE(leave_type text, total_days numeric, used_days numeric, carry_over_days numeric, period_start date, expires_at date)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    lb.leave_type, lb.total_days, lb.used_days, lb.carry_over_days, lb.period_start, lb.expires_at
  FROM public.leave_balances lb
  JOIN public.employee_line_accounts ela ON ela.employee_id = lb.employee_id
  WHERE ela.line_user_id = p_line_user_id
    AND (
      CASE WHEN lb.leave_type = 'annual' THEN
        CASE
          -- 沒傳年度(送出閘門)→ 含今天的現在期(對現在期把關,維持原行為)
          WHEN p_year IS NULL THEN
            (lb.period_start IS NULL OR lb.period_start <= (now() AT TIME ZONE 'Asia/Taipei')::date)
            AND (lb.expires_at IS NULL OR lb.expires_at >= (now() AT TIME ZONE 'Asia/Taipei')::date)
          -- 有傳年度(顯示分頁)且該年有列 → 該年那期(對齊 web 年度分頁)
          WHEN EXISTS (
            SELECT 1 FROM public.leave_balances x
             WHERE x.employee_id = lb.employee_id AND x.leave_type = 'annual' AND x.year = p_year
          ) THEN lb.year = p_year
          -- 有傳年度但該年沒列 → 退回含今天現在期(默認頁不變空)
          ELSE
            (lb.period_start IS NULL OR lb.period_start <= (now() AT TIME ZONE 'Asia/Taipei')::date)
            AND (lb.expires_at IS NULL OR lb.expires_at >= (now() AT TIME ZONE 'Asia/Taipei')::date)
        END
      ELSE
        lb.year = COALESCE(p_year, EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Taipei'))::int)
      END
    )
$function$;
