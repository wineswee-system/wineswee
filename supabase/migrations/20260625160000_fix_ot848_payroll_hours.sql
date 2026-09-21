-- ════════════════════════════════════════════════════════════════════════════
-- 資料修正(續)：加班單 #848 計薪用欄位 ot_hours 8 → 2.5
-- 2026-06-25
--
-- overtime_requests 有兩套欄位：
--   date / hours          → 加班紀錄 UI（前一支 20260625150000 已改成 2.5）
--   request_date / ot_hours / ot_category / is_exception → 計薪(preview_payroll / generate_payroll)讀這套
-- 兩欄無同步 trigger，所以只改 hours 計薪不會跟著動 → 本檔補改 ot_hours。
-- 只動數值欄，ot_category / is_exception 不碰（保留「國定/例假」分類）。
--
-- WHERE 帶 request_date 當護欄；idempotent。
-- 提醒：若 2026-04 林巧玉薪資已正式結算入帳，需重跑該月計薪才會反映。
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_rows int;
BEGIN
  UPDATE public.overtime_requests
     SET ot_hours = 2.5
   WHERE id = 848
     AND request_date = '2026-04-03';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE '加班單 #848 計薪時數 ot_hours 更新為 2.5，影響 % 列', v_rows;
  IF v_rows = 0 THEN
    RAISE NOTICE '※ 0 列：請確認 #848 的 request_date 是否為 2026-04-03（或該欄是否存在/已是 2.5）';
  END IF;
END $$;
