-- 王澤昇(#78)2025 年度特休 16.5h → 15h — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:王澤昇是 PT(hourly),2025 年度特休(週年期 2026/02/03~2026/08/02)於
--   2026-08-03 被「批次生成/結算」寫進 leave_balances(#2644, total_days=2.0625 → 16.5h)。
--   該值由 leave_annual_entitlement 用 leave_pt_avg_weekly_hours(近182天班表)算出,但系統
--   只有 2026-04-01 之後的班表(缺 2~3 月),PT 比例=27.5/40=0.6875 → 3天×8×0.6875=16.5h。
--   班表資料不足6個月,此自動值不可信 → 依老闆決定改回 15 小時(=1.875 天,PT 以 ×8 顯示)。
--   顯示邏輯(LeaveBalances.jsx)dbTotal>0 優先於 RPC 計算值 → 改此列即生效。
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.leave_balances
   SET total_days = 1.875,           -- 1.875 天 × 8 = 15 小時
       updated_at = now()
 WHERE employee_id = 78
   AND year        = 2025
   AND leave_type  = 'annual';

-- 驗證(跑完可自行 SELECT 確認顯示 15h):
-- SELECT id, total_days, total_days*8 AS hours FROM public.leave_balances
--  WHERE employee_id=78 AND year=2025 AND leave_type='annual';
