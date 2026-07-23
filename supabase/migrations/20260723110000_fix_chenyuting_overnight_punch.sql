-- 修正陳羽庭(133)跨午夜晚班打卡 — 2026-07-23
-- 原誤打成 7/23 00:36~00:36(工時0);應為 7/22 12:00~00:36。
--   淨工時 = 12.6h span(12:00→跨午夜00:36) − 60分休息(≥9h) = 11.6h。工時對齊前端 computeNet。
--   只動這一筆(id+employee_id 雙鎖);7/22 原無記錄不會撞重複;idempotent。附稽核 attendance_clock_edits。

UPDATE public.attendance_records
   SET date = '2026-07-22', clock_in = '12:00:00', clock_out = '00:36:00',
       total_hours = 11.6, hours = 11.6, status = '正常'
 WHERE id = 4263 AND employee_id = 133;

INSERT INTO public.attendance_clock_edits
  (attendance_record_id, employee, date, old_clock_in, new_clock_in, old_clock_out, new_clock_out, reason, edited_by, organization_id)
SELECT 4263, '陳羽庭', '2026-07-22', '00:36:00', '12:00:00', '00:36:00', '00:36:00',
       '修正跨午夜晚班打卡(誤打成7/23凌晨→7/22 12:00~00:36)', 'system(migration)', 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.attendance_clock_edits
  WHERE attendance_record_id = 4263 AND reason LIKE '修正跨午夜晚班打卡%');
