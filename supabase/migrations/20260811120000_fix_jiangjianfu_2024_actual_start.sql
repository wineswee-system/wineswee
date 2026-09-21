-- 修正江建賦「20-24」排班 actual_start 名實不符
-- ─────────────────────────────────────────────────────────────
-- 症狀:打卡追蹤「當天班表」顯示 18:00–00:00,排班表格卻顯示 20:00–24:00。
-- 根因:這些排班列班名掛 '20-24'(店28 班別定義 id309 = 20:00~00:00,正確),
--       但 actual_start 卻存成 18:00(= 另一個定義 '18-24' 的時間)→ 名實不符。
--       最可能是原本 '18-24' 的格子改名成 '20-24' 時 actual 時間沒跟著重算。
-- 影響:actual_start 是遲到/班表工時/合規依據,存 18:00 會誤判每天遲到 ~2h、
--       班表工時 6h→實際 4h。稽核全庫(2026-07 起 3145 列)僅此 10 列受影響,全屬江建賦。
-- 修法:actual_start 校回 20:00 對齊班別定義(actual_end 已是 00:00 正確,不動)。
-- idempotent:條件含 actual_start='18:00',修好後再跑一次影響 0 列。
-- 這些週期已「發布鎖定」(enforce_schedule_lock),需以 bypass GUC 放行本次校正。
BEGIN;
SET LOCAL schedules.bypass_lock = 'on';
UPDATE public.schedules
   SET actual_start = '20:00:00'
 WHERE employee_id = 121          -- 江建賦
   AND shift = '20-24'
   AND actual_start = '18:00:00';
COMMIT;
