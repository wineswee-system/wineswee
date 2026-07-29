-- 補打卡:阮玉安(emp 118 / 南京建國 store 24 / org 1)
-- 2026-07-26 上班 12:00 ~ 下班 16:00（4 小時,未滿 5h 免扣休息）
-- idempotent:同員工同日已有紀錄就不重複插入
INSERT INTO public.attendance_records
  (employee_id, employee, store_id, organization_id, date,
   clock_in, clock_out, clock_out_time, status, total_hours,
   is_late, late_minutes, clock_in_mode, clock_out_mode, clock_in_location)
SELECT 118, '阮玉安', 24, 1, DATE '2026-07-26',
       TIME '12:00', TIME '16:00', TIMESTAMPTZ '2026-07-26 16:00:00+08',
       '正常', 4, false, 0, 'normal', 'normal', '南京建國'
WHERE NOT EXISTS (
  SELECT 1 FROM public.attendance_records
  WHERE employee_id = 118 AND date = DATE '2026-07-26'
);

-- 驗證(跑完應看到這筆)
-- SELECT id, employee, store_id, date, clock_in, clock_out, total_hours, status
-- FROM public.attendance_records WHERE employee_id = 118 AND date = '2026-07-26';
