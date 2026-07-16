-- 合併廖晉呈(135)跨午夜晚班打卡 — 2026-07-16
-- 7/15 19:48 上班(id 3845,無下班) + 7/16 06:01(id 3848,獨立一筆)其實是同一班的下班。
--   → 併成 7/15 19:48~06:00(下班改 06:00),刪掉 3848 那筆誤記的獨立打卡。
--   淨工時 = 10.2h span − 30分休息 = 9.7h(比照游承軒/林則宇跨午夜修正)。
--   id+employee_id 雙鎖只動這兩筆 + 稽核。idempotent。

UPDATE public.attendance_records
   SET clock_out = '06:00:00', total_hours = 9.7, hours = 9.7, status = '正常'
 WHERE id = 3845 AND employee_id = 135;

DELETE FROM public.attendance_records
 WHERE id = 3848 AND employee_id = 135
   AND date = '2026-07-16' AND clock_in = '06:01:00';

INSERT INTO public.attendance_clock_edits
  (attendance_record_id, employee, date, old_clock_in, new_clock_in, old_clock_out, new_clock_out, reason, edited_by, organization_id)
SELECT 3845, '廖晉呈', '2026-07-15', '19:48:00', '19:48:00', NULL, '06:00:00',
       '合併跨午夜晚班下班(7/16 06:01 獨立打卡併入 7/15 班別,下班改 06:00,刪 id3848)',
       'system(migration)', 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.attendance_clock_edits
  WHERE attendance_record_id = 3845 AND reason LIKE '合併跨午夜晚班下班%');
