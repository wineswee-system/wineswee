-- 6月「缺卡」紀錄用班表補上(全員:月薪+PT)
-- 2026-07-09  營運部晚班常跨午夜、又有缺下班卡→工時算不出。決策:缺卡的用班表補。
--   只補「clock_in 或 clock_out 為 NULL」的破紀錄(完整紀錄不動,保留正職真實打卡)。
--   來源:schedules 有 actual_start/end 且非請假日。clock_in/out 皆設班表時間,
--   工時 = _shift_seg_hours(actual_start,actual_end)(已處理跨午夜:end<start 自動+24h,再扣休息)。
--   範圍 2026-06,約 33 筆可補;另有 11 筆班表無時間→需手動。idempotent(補完非NULL不再match)。
--   註:PT 缺卡多已被 20260709160000 覆蓋;此支收月薪與漏網。

UPDATE public.attendance_records ar SET
  clock_in    = s.actual_start,
  clock_out   = s.actual_end,
  total_hours = public._shift_seg_hours(s.actual_start, s.actual_end)
FROM public.schedules s
WHERE s.employee_id = ar.employee_id
  AND s.date = ar.date
  AND ar.date >= '2026-06-01' AND ar.date <= '2026-06-30'
  AND (ar.clock_in IS NULL OR ar.clock_out IS NULL)   -- 只補缺卡
  AND s.leave_request_id IS NULL
  AND s.actual_start IS NOT NULL
  AND s.actual_end IS NOT NULL;

NOTIFY pgrst, 'reload schema';
