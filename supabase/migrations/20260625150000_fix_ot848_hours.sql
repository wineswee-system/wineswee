-- ════════════════════════════════════════════════════════════════════════════
-- 資料修正：加班單 #848（林巧玉 / 2026-04-03）時數 8h → 2.5h
-- 2026-06-25
--
-- 已核准單據 UI 不能改，依「production 寫操作一律走 idempotent migration」規矩處理。
-- WHERE 帶 employee + date 當護欄，只動到那一列；對錯就 0 rows、不會誤傷。
-- idempotent：再跑一次就是把它設成 2.5（無副作用）。
--
-- 注意：overtime_requests 是「加班紀錄頁顯示」+「批次計薪 OT」的來源，改這欄兩邊都會跟著對。
--   若 2026-04 該員薪資「已正式結算入帳」，generate_payroll 不會自動重算，需重跑計薪才會反映。
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_rows int;
BEGIN
  UPDATE public.overtime_requests
     SET hours = 2.5
   WHERE id = 848
     AND employee = '林巧玉'
     AND date = '2026-04-03';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE '加班單 #848 時數更新為 2.5h，影響 % 列', v_rows;
  IF v_rows = 0 THEN
    RAISE NOTICE '※ 0 列：請確認 #848 的 員工/日期 是否與護欄相符（林巧玉 / 2026-04-03）';
  END IF;
END $$;
