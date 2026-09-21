-- 黃為燁(80) 8/13 班表 15:00-00:00 跨午夜,打卡在午夜後 00:01 被記成 8/14(attendance id 5430),
-- 8/13 反而顯示未打卡。將該筆 date 挪回 8/13(clock 時間 00:01 / clock_out_time UTC 時戳不動)。冪等。
UPDATE public.attendance_records
   SET date = '2026-08-13'
 WHERE id = 5430 AND employee_id = 80 AND date = '2026-08-14';
