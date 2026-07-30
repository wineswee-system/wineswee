-- 請假淨時數預覽 RPC(給 web/LIFF 填單即時預覽用)— 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 前端填時數假時,預覽「實際扣幾小時」要跟 trigger(20260730160000)存進去的淨值一致。
-- 純唯讀薄包 _leave_net_hours;回 NULL(查無班表/辦公)→ 前端 fallback 顯示毛時段差。
-- 只回一個數字、不寫入 → 開放 anon(LIFF)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.preview_leave_net_hours(
  p_emp_id int, p_date date, p_start time, p_end time
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._leave_net_hours(p_emp_id, p_date, p_start, p_end);
$$;

GRANT EXECUTE ON FUNCTION public.preview_leave_net_hours(int, date, time, time) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
