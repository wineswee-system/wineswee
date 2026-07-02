-- ════════════════════════════════════════════════════════════════════════════
-- 修正林則宇 2026-07-01 跨午夜打卡孤兒
-- 2026-07-02
--
-- 現象：
--   id=2025  7/1 17:50 上班、未下班（他當場真打的）
--   id=2034  7/2 00:02 上班、未下班（跨午夜舊快取誤顯示「上班」→ 誤開新班）
--
-- 正確結果：這是同一個班 17:50 上班 → 00:02 下班。
--   → 把下班補回 7/1 那筆（id=2025），刪掉 7/2 的孤兒空上班（id=2034）。
--
-- 工時：17:50→00:02 = 372 分 = 6.2h（5~9h 扣 30 分休息）→ total_hours = 5.70。
-- idempotent：條件綁 id + employee_id + date + 狀態，重跑不會重複動作。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. 7/1 那筆補下班（僅當它還沒下班，避免重跑覆蓋）
UPDATE public.attendance_records
SET clock_out      = '00:02:00',
    clock_out_time = '2026-07-01T16:02:13.196865+00:00',  -- 對齊原 00:02 打卡伺服器時間
    total_hours    = 5.70,
    clock_out_mode = 'normal'
WHERE id = 2025
  AND employee_id = 77
  AND date = '2026-07-01'
  AND clock_out IS NULL;

-- 2. 刪掉 7/2 的孤兒空上班（僅當它仍是 00:02 上班且沒下班）
DELETE FROM public.attendance_records
WHERE id = 2034
  AND employee_id = 77
  AND date = '2026-07-02'
  AND clock_in = '00:02:00'
  AND clock_out IS NULL;

COMMIT;
