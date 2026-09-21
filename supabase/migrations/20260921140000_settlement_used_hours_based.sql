-- 結算桶「已休」改以精確小時為準,不再吃被四捨五入的天數(days)
-- 病根:trg_settlement_leave_used_sync 先吃 NEW.days(2h 假被存成 0.3 天而非 0.25),
--       導致 used_days 灌成 0.3 → 後台 daysToHours(0.3) 捨到 0.5=2.5h、LIFF (total-0.3)*8=21.6,
--       跟實際 2h、以及彼此都對不上。改用 hours/8 精算即一致(0.25天=2.0h 剛好落在 0.5 格)。

-- 1) trigger:結算桶 used 一律用精確小時(hours/8),days 只當 fallback
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
    -- ★ 先吃精確小時 hours/8(避免 days 被捨過),days 只當 fallback
    v_delta := COALESCE(NULLIF(NEW.hours,0) / 8.0, NEW.days, 0);
    v_year  := EXTRACT(YEAR FROM NEW.start_date)::int;
  ELSE
    v_delta := -COALESCE(NULLIF(OLD.hours,0) / 8.0, OLD.days, 0);
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

-- 2) 一次性對帳:只訂正「used_days 完全來自請假(無折現殘量)、且被四捨五入」的結算桶,
--    改成請假時數精算(hours/8)。有折現殘量或 days 髒值的桶一律跳過,不碰。
UPDATE public.leave_balances lb
   SET used_days = sub.hours_used, updated_at = now()
  FROM (
    SELECT lb2.id,
      round(COALESCE(SUM(COALESCE(NULLIF(lr.hours,0)/8.0, lr.days)),0),4) AS hours_used,
      round(COALESCE(SUM(COALESCE(lr.days, NULLIF(lr.hours,0)/8.0)),0),4) AS days_used
    FROM public.leave_balances lb2
    JOIN public.leave_requests lr
      ON lr.employee_id = lb2.employee_id AND lr.type = lb2.leave_type
     AND lr.status = '已核准' AND lr.deleted_at IS NULL
    WHERE lb2.leave_type LIKE '%結算%'
    GROUP BY lb2.id
  ) sub
 WHERE lb.id = sub.id
   AND abs(lb.used_days - sub.days_used) < 0.001      -- used 完全等於請假天數和 → 無折現殘量
   AND abs(sub.hours_used - sub.days_used) >= 0.001;  -- 且 hours/8 與 days 有差(被四捨五入)

-- 3) (不訂正 leave_requests.days)已簽核假單被 trg_block_edit_after_signed_leave 禁止改內容,
--    且 days 僅為顯示殘留、不影響餘額(餘額已改吃 hours);刪單時 trigger 亦以 hours 精確扣回。
--    故此處不動請假單本身,避免繞過簽核鎖。
