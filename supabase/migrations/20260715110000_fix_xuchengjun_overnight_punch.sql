-- 修正許承雋(417)跨午夜晚班打卡 — 2026-07-15
-- 原誤打成 7/15 00:44~00:44;應為 7/14 18:00~00:44。
--   淨工時 = 6.73h span − 30分休息(5~9h,兼職非行政) = 6.23h。工時對齊前端 computeNet。
--   只動這一筆(id+employee_id 雙鎖)+稽核。idempotent。

UPDATE public.attendance_records
   SET date = '2026-07-14', clock_in = '18:00:00', clock_out = '00:44:00',
       total_hours = 6.23, hours = 6.23, status = '正常'
 WHERE id = 3796 AND employee_id = 417;

INSERT INTO public.attendance_clock_edits
  (attendance_record_id, employee, date, old_clock_in, new_clock_in, old_clock_out, new_clock_out, reason, edited_by, organization_id)
SELECT 3796, '許承雋', '2026-07-14', '00:44:00', '18:00:00', '00:44:00', '00:44:00',
       '修正跨午夜晚班打卡(誤打成7/15凌晨→7/14 18:00~00:44)', 'system(migration)', 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.attendance_clock_edits
  WHERE attendance_record_id = 3796 AND reason LIKE '修正跨午夜晚班打卡%');
