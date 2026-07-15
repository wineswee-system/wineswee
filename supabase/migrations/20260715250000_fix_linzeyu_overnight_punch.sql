-- 修正林則宇(77)跨午夜晚班打卡 — 2026-07-15
-- 原誤打成 7/15 00:03(只有上班);應為 7/14 18:00~00:00(午夜)。
--   淨工時 = 6h span − 30分休息(5~9h,非行政) = 5.5h。24:00=午夜→clock_out 00:00(跨午夜)。
--   只動這一筆(id+employee_id 雙鎖)+稽核。idempotent。

UPDATE public.attendance_records
   SET date = '2026-07-14', clock_in = '18:00:00', clock_out = '00:00:00',
       total_hours = 5.5, hours = 5.5, status = '正常'
 WHERE id = 3794 AND employee_id = 77;

INSERT INTO public.attendance_clock_edits
  (attendance_record_id, employee, date, old_clock_in, new_clock_in, old_clock_out, new_clock_out, reason, edited_by, organization_id)
SELECT 3794, '林則宇', '2026-07-14', '00:03:00', '18:00:00', NULL, '00:00:00',
       '修正跨午夜晚班打卡(誤打成7/15凌晨→7/14 18:00~00:00)', 'system(migration)', 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.attendance_clock_edits
  WHERE attendance_record_id = 3794 AND reason LIKE '修正跨午夜晚班打卡%');
