-- 修：張庭瑋 7/6 用補打卡記加班，污染了出勤（補打卡不是加班工具）
-- 2026-07-07
-- 情境：7/6 正常班 09:00–18:36 + 晚上 22:00–00:00 臨時加班（加班單尚未申請）。
--   她用補打卡 #24(7/6 上班 22:00)/#26(7/7 下班 00:00) 想記加班 →
--   #24 把 7/6 clock_in 09:00 蓋成 22:00（工時暴增 19.6h）；
--   #26 把 7/7 clock_out 塞成 00:00（工時 13.57h）。
-- 修：刪 2 筆錯補打卡 + 還原出勤。加班另走加班單（她補申請 7/6 22:00–00:00 2h）。
-- guard：以 employee+date+被污染的具體值 鎖定，只打中這幾筆，idempotent。

BEGIN;

-- 1) 刪 2 筆用錯工具的補打卡
DELETE FROM public.clock_corrections
 WHERE id IN (24, 26)
   AND employee = '張庭瑋'
   AND clock_mode = 'overtime'
   AND reason LIKE '%南京盤點%';

-- 2) 還原 7/6 上班時間：22:00（被 #24 蓋）→ 09:00
--    （out 18:36 是真實下班，保留；若實際上班非 09:00，之後用「改時間」微調）
UPDATE public.attendance_records
   SET clock_in = '09:00:00'
 WHERE employee = '張庭瑋' AND date = '2026-07-06' AND clock_in = '22:00:00';

-- 3) 清掉 7/7 錯誤的下班 00:00（那是加班結束時間被誤記；今天還沒下班）
UPDATE public.attendance_records
   SET clock_out = NULL, total_hours = NULL
 WHERE employee = '張庭瑋' AND date = '2026-07-07' AND clock_out = '00:00:00';

-- 4) 重算 7/6 工時（09:00–18:36：扣休息後 ≈ 8.6h）
UPDATE public.attendance_records a
   SET total_hours = ROUND((gh.gross - public.calc_shift_rest_minutes(gh.gross) / 60.0)::numeric, 2)
  FROM (
    SELECT id, EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 AS gross
      FROM public.attendance_records
     WHERE employee = '張庭瑋' AND date = '2026-07-06'
       AND clock_in IS NOT NULL AND clock_out IS NOT NULL
  ) gh
 WHERE a.id = gh.id;

COMMIT;
