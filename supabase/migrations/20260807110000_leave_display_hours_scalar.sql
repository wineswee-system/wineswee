-- 請假顯示時數(讀班表淨時數)純量 helper — 供 LINE 卡片(簽核卡/通知)共用 — 2026-08-07
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:請假 LINE 卡片(簽核卡 card-approval、hr-notify 提交/核准/退回通知)顯示時數,
--   整天假要讀「當天實際排班淨時數」(9h班=8h、6h班=5.5h),與計薪引擎/LIFF 一致。
-- 作法:純量版(比照 liff_leave_display_hours_for_ids,同公式但不綁 line_user,service_role 可用),
--   給 edge function 直接以 leave_id 查。公式 = COALESCE(填的hours, Σ排班淨時數, days×8)。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.leave_display_hours(p_leave_id int)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
           lr.hours,
           (SELECT SUM(public._scheduled_net_hours(lr.employee_id, g::date))
              FROM generate_series(lr.start_date, COALESCE(lr.end_date, lr.start_date), interval '1 day') g),
           COALESCE(lr.days, 0) * 8
         )
  FROM public.leave_requests lr
  WHERE lr.id = p_leave_id
$$;

GRANT EXECUTE ON FUNCTION public.leave_display_hours(int) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
