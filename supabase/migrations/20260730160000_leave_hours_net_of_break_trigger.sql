-- 部分請假時數扣內含休息(step 2)— 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 規格(project_partial_leave_break_spec):請假時數 = 請假時段 −(休息 ∩ 請假時段)。
-- 做法:BEFORE INSERT trigger 掛 leave_requests,對「時數假」(start_time/end_time 有值)
--   用 _leave_net_hours 重算 hours/days。這樣 web(create_leave_request)/LIFF
--   (liff_insert_leave_request)/手機/任何未來路徑全涵蓋,且「不動」那兩支大函式(避 Studio drift)。
--
-- 安全:
--   - 只動「時數假」;全天假(start_time NULL)不碰(日內休息不影響天數)。
--   - _leave_net_hours 回 NULL(查無班表/辦公時間)或 <=0 → 保留 RPC 原本算的值(fallback,不惡化現況)。
--   - 純加 trigger;idempotent(DROP TRIGGER IF EXISTS + CREATE)。
-- 已知小限制:RPC 內的額度/餘額 guard 仍用「毛時數」驗(比淨值嚴一點=保守,不會超發)。
--   若之後要連 guard 也用淨值,再進 step 2b(那才需動 RPC)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tg_leave_hours_net_of_break()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_net numeric;
BEGIN
  -- 只處理「時數假」:有起訖時間才有「日內休息」問題;全天假走天數不受影響
  IF NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL AND NEW.employee_id IS NOT NULL THEN
    v_net := public._leave_net_hours(NEW.employee_id, NEW.start_date, NEW.start_time, NEW.end_time);
    IF v_net IS NOT NULL AND v_net > 0 THEN
      NEW.hours := v_net;
      NEW.days  := ROUND(v_net / 8.0, 1);
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_leave_hours_net_of_break ON public.leave_requests;
CREATE TRIGGER trg_leave_hours_net_of_break
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_leave_hours_net_of_break();

NOTIFY pgrst, 'reload schema';
