-- 打卡模式從 5 (normal/overtime/leave/shift_swap/outing) 砍成 2 (normal/outing)
-- 跟廠商討論後決定簡化：normal = 一般 (鎖 IP/GPS)、outing = 外出 (不鎖 IP，標籤'外出')。
-- 兩者皆「不查班表」(不需要排班即可打卡)。
-- 舊資料 overtime / leave / shift_swap 全部 backfill 為 normal（歷史標籤捨棄）。

BEGIN;

-- 1. 先放寬 constraint 才能 backfill
ALTER TABLE attendance_records
  DROP CONSTRAINT IF EXISTS chk_clock_in_mode,
  DROP CONSTRAINT IF EXISTS chk_clock_out_mode;

-- 2. backfill 舊資料
UPDATE attendance_records
   SET clock_in_mode = 'normal'
 WHERE clock_in_mode IN ('overtime', 'leave', 'shift_swap');

UPDATE attendance_records
   SET clock_out_mode = 'normal'
 WHERE clock_out_mode IN ('overtime', 'leave', 'shift_swap');

-- 3. 重建為 2 值 CHECK
ALTER TABLE attendance_records
  ADD CONSTRAINT chk_clock_in_mode
    CHECK (clock_in_mode  IN ('normal', 'outing')),
  ADD CONSTRAINT chk_clock_out_mode
    CHECK (clock_out_mode IN ('normal', 'outing'));

-- 4. mode='X' → FK NOT NULL 的雙向 trigger 也不再適用（因為 overtime/leave/shift_swap mode 已消失）
--    保留 FK 欄位本身（給歷史 join 用），但移除 mode-FK 同步檢查 trigger 若有
DROP TRIGGER IF EXISTS trg_attendance_mode_fk_sync ON attendance_records;
DROP FUNCTION IF EXISTS fn_attendance_mode_fk_sync();

COMMIT;
