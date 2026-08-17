-- B:讓員工能「請掉」特休假2025結算等結算桶。
-- 現況:請假核准全走 chain(hr_chain_approve/web_advance_chain_request),不維護 leave_balances.used_days。
--   標準特休(annual)吃 104 匯入 used_days;但「結算」桶(特休假2025結算/舊人資系統補休結算)可休可折現,
--   核准後剩餘該遞減、下拉該收掉、到期折現讀 total-used 才對。
-- 解:一支「只認 type LIKE '%結算%'」的 AFTER trigger,跨越「計入/不計入 used」界線時同步 used_days(days 為單位)。
--   計入條件 = status='已核准' AND deleted_at IS NULL。approve→+;取消/駁回/軟刪/刪除→-。冪等(比對前後狀態,不重複加)。
--   標準假別(不含'結算')一律早退,現有行為零影響。
CREATE OR REPLACE FUNCTION public._trg_settlement_leave_used_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_type text := COALESCE(NEW.type, OLD.type);
  v_was_counted boolean;
  v_is_counted  boolean;
  v_delta numeric;
  v_year  int;
BEGIN
  -- 只處理「結算」桶(可休可折現);其餘假別不碰,維持既有行為
  IF v_type IS NULL OR v_type NOT LIKE '%結算%' THEN
    RETURN NULL;  -- AFTER trigger,回傳值被忽略
  END IF;

  v_was_counted := (TG_OP <> 'INSERT') AND OLD.status = '已核准' AND OLD.deleted_at IS NULL;
  v_is_counted  := (TG_OP <> 'DELETE') AND NEW.status = '已核准' AND NEW.deleted_at IS NULL;

  IF v_was_counted = v_is_counted THEN
    RETURN NULL;  -- 沒跨越界線 → 不動
  END IF;

  IF v_is_counted THEN
    v_delta := COALESCE(NEW.days, NEW.hours / 8.0, 0);
    v_year  := EXTRACT(YEAR FROM NEW.start_date)::int;
  ELSE
    v_delta := -COALESCE(OLD.days, OLD.hours / 8.0, 0);
    v_year  := EXTRACT(YEAR FROM OLD.start_date)::int;
  END IF;

  UPDATE public.leave_balances
     SET used_days  = GREATEST(0, COALESCE(used_days, 0) + v_delta),
         updated_at = now()
   WHERE employee_id = COALESCE(NEW.employee_id, OLD.employee_id)
     AND year        = v_year
     AND leave_type  = v_type;

  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS trg_settlement_leave_used_sync ON public.leave_requests;
CREATE TRIGGER trg_settlement_leave_used_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_settlement_leave_used_sync();
