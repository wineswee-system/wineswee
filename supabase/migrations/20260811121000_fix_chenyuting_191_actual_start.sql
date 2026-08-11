-- 修正陳羽庭「19-1」排班 actual_start 名實不符(同江建賦那類 drift)
-- ─────────────────────────────────────────────────────────────
-- 2026-07-11 一列:班名 '19-1'(=19:00~01:00)但 actual_start 存成 18:00。
-- 全庫自由班名抽驗(2026-07 起)僅此 1 列;她其他班名實相符。
-- 該日無打卡 → 對計薪零影響,純為打卡追蹤/排班表格顯示一致。
-- actual_start 校回 19:00(actual_end 01:00 正確,不動)。週期已鎖 → bypass GUC 放行。
BEGIN;
SET LOCAL schedules.bypass_lock = 'on';
UPDATE public.schedules
   SET actual_start = '19:00:00'
 WHERE employee_id = 133          -- 陳羽庭
   AND shift = '19-1'
   AND actual_start = '18:00:00';
COMMIT;
