-- 修正兩筆跨午夜打卡時間(林豫賢/洪友銘)— 2026-07-14
-- 原本誤打成 7/14 凌晨(00:27 / 00:01),應為 7/13 晚班跨午夜。
--   林豫賢(100) id=3750 → 7/13 18:00~00:27,淨工時 5.95h(毛6.45−休0.5,跨午夜+24h)
--   洪友銘(431) id=3748 → 7/13 19:00~00:01,淨工時 4.52h(毛5.02−休0.5)
-- 工時算法對齊前端 Attendance.jsx computeNet(<5h休0/5~9h休30/≥9h休60;非行政)。
-- 只動這兩筆(id+employee_id 雙鎖);idempotent。附稽核 attendance_clock_edits。

UPDATE public.attendance_records
   SET date = '2026-07-13', clock_in = '18:00:00', clock_out = '00:27:00',
       total_hours = 5.95, hours = 5.95, status = '正常'
 WHERE id = 3750 AND employee_id = 100;

UPDATE public.attendance_records
   SET date = '2026-07-13', clock_in = '19:00:00', clock_out = '00:01:00',
       total_hours = 4.52, hours = 4.52, status = '正常'
 WHERE id = 3748 AND employee_id = 431;

-- 稽核紀錄(避免重複插入:同 record + 同原因存在則跳過)
INSERT INTO public.attendance_clock_edits
  (attendance_record_id, employee, date, old_clock_in, new_clock_in, old_clock_out, new_clock_out, reason, edited_by, organization_id)
SELECT 3750, '林豫賢', '2026-07-13', '00:27:00', '18:00:00', '00:27:00', '00:27:00',
       '修正跨午夜晚班打卡(誤打成7/14凌晨→7/13 18:00~00:27)', 'system(migration)', 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.attendance_clock_edits
  WHERE attendance_record_id = 3750 AND reason LIKE '修正跨午夜晚班打卡%');

INSERT INTO public.attendance_clock_edits
  (attendance_record_id, employee, date, old_clock_in, new_clock_in, old_clock_out, new_clock_out, reason, edited_by, organization_id)
SELECT 3748, '洪友銘', '2026-07-13', '00:01:00', '19:00:00', NULL, '00:01:00',
       '修正跨午夜晚班打卡(誤打成7/14凌晨→7/13 19:00~00:01)', 'system(migration)', 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.attendance_clock_edits
  WHERE attendance_record_id = 3748 AND reason LIKE '修正跨午夜晚班打卡%');
