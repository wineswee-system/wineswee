-- ════════════════════════════════════════════════════════════════════════════
-- 修 1 筆 OT 分類錯誤：陳嘉益 2026-04-29
--
-- 來源：scripts/yongchun_april_overtime_restore.sql 第 85 行手寫成 'holiday'
--      但 2026-04-29 是星期三平日，旁邊其他 6 筆都是 'weekday'
--      → 公式 modal 顯示「國定/例假 ×2.0」金額被高估
--
-- 修法：UPDATE 該筆 ot_category 'holiday' → 'weekday'
-- 影響：批次計薪 4 月須重跑（該天加班費由 ×2.0 變三桶階梯，金額會降）
-- 安全：idempotent（已修過再跑不會動）；只動 1 筆，加多重 WHERE 防誤觸
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.overtime_requests
     SET ot_category = 'weekday'
   WHERE employee = '陳嘉益'
     AND date = DATE '2026-04-29'
     AND request_date = DATE '2026-04-29'
     AND ot_hours = 8.0
     AND ot_category = 'holiday'
     AND status = '已核准';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '陳嘉益 2026-04-29 OT 分類修正：% 筆 row 被更新', v_count;

  IF v_count = 0 THEN
    RAISE NOTICE '※ 0 筆 = 該資料已修過 / 找不到符合條件的 row，無動作（migration 是 idempotent）';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
