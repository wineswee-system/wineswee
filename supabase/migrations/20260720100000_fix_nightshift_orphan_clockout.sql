-- 修跨夜班孤兒打卡:晚上上班(7/19) + 隔天早上被當新上班卡(7/20) → 併回 7/19 當下班 — 2026-07-20
-- 起因:換日線 7 點,早上 07:08/07:13/08:01 下班打卡超過 7 點,被系統當成 7/20 的一筆新上班卡。
-- 修法:把早上那筆時間寫回 7/19 記錄的 clock_out,依 clock-in edge function 同公式算 total_hours,再刪掉 7/20 孤兒。
-- total_hours 公式(getRestMinutes 階梯):毛時<5→0分, 5~9→30分, ≥9→60分;淨工時=(毛分-休息)/60。
-- clock_out_time 為 UTC(台灣 UTC+8)。以明確 id 定位 + 條件 clock_out IS NULL 保證 idempotent。

-- 温子杰 (id 4033): 23:58 → 08:01, 毛 8.05h, 休 30 分, 淨 7.55h
UPDATE public.attendance_records
   SET clock_out = '08:01:00',
       clock_out_time = '2026-07-20T00:01:00+00:00',
       total_hours = 7.55,
       clock_out_mode = 'normal'
 WHERE id = 4033 AND clock_out IS NULL;
DELETE FROM public.attendance_records
 WHERE id = 4036 AND clock_in = '08:01:00' AND clock_out IS NULL;

-- 黃博湋 (id 4030): 20:00 → 07:08, 毛 11.13h, 休 60 分, 淨 10.13h
UPDATE public.attendance_records
   SET clock_out = '07:08:00',
       clock_out_time = '2026-07-19T23:08:00+00:00',
       total_hours = 10.13,
       clock_out_mode = 'normal'
 WHERE id = 4030 AND clock_out IS NULL;
DELETE FROM public.attendance_records
 WHERE id = 4034 AND clock_in = '07:08:00' AND clock_out IS NULL;

-- 廖晉呈 (id 4031): 20:00 → 07:13, 毛 11.22h, 休 60 分, 淨 10.22h
UPDATE public.attendance_records
   SET clock_out = '07:13:00',
       clock_out_time = '2026-07-19T23:13:00+00:00',
       total_hours = 10.22,
       clock_out_mode = 'normal'
 WHERE id = 4031 AND clock_out IS NULL;
DELETE FROM public.attendance_records
 WHERE id = 4035 AND clock_in = '07:13:00' AND clock_out IS NULL;
