-- LIFF 簽核卡片:整天請假顯示時數改讀班表實際淨時數(對齊計薪)— 2026-08-07
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:簽核卡片整天請假原本顯示 days×8(固定 8h),要改成「當天實際排班淨時數」
--   (9h 班顯示 8h、6h 班顯示 5.5h…),跟計薪引擎一致(_scheduled_net_hours)。
-- 作法:加法式小 RPC(比照 liff_leave_attachments_for_ids,不動大 pending RPC),
--   前端 merge 進 leaves 顯示。公式與引擎相同:COALESCE(填的hours, Σ排班淨時數, days×8)。
--   staff 閘(需能解析到員工)。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_leave_display_hours_for_ids(p_line_user_id text, p_ids int[])
RETURNS TABLE(id int, disp_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lr.id,
         COALESCE(
           lr.hours,
           (SELECT SUM(public._scheduled_net_hours(lr.employee_id, g::date))
              FROM generate_series(lr.start_date, COALESCE(lr.end_date, lr.start_date), interval '1 day') g),
           COALESCE(lr.days, 0) * 8
         ) AS disp_hours
  FROM public.leave_requests lr
  WHERE lr.id = ANY(p_ids)
    AND EXISTS (SELECT 1 FROM public._liff_resolve_employee(p_line_user_id) e WHERE e.id IS NOT NULL)
$$;

GRANT EXECUTE ON FUNCTION public.liff_leave_display_hours_for_ids(text, int[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
