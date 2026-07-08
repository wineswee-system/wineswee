-- 行政(admin)打卡工時：午休固定扣 60 分 — 回填現有紀錄 — 2026-07-08
-- 規則(使用者定):行政(salary_structures.employment_category='admin')一律扣 60 分午休，
--   不套門市的「5~9h 扣30 / ≥9h 扣60」階梯。只影響行政；門市/其他不動。
-- 影響：僅考勤 total_hours 顯示正確化;行政是月薪固定，計薪不看 total_hours → 不動薪水。
-- 只回填「有上下班打卡」的行政紀錄;total_hours = 時長 − 1h(不為負)。idempotent(重跑同結果)。

UPDATE public.attendance_records ar
SET total_hours = v.net, hours = v.net
FROM (
  SELECT ar2.id,
         GREATEST(
           round((EXTRACT(EPOCH FROM (
             CASE WHEN ar2.clock_out >= ar2.clock_in
                  THEN ar2.clock_out - ar2.clock_in
                  ELSE ar2.clock_out - ar2.clock_in + interval '24 hours'
             END)) / 3600.0 - 1.0)::numeric, 2),
           0) AS net
  FROM public.attendance_records ar2
  JOIN public.salary_structures ss ON ss.employee_id = ar2.employee_id
  WHERE ss.employment_category = 'admin'
    AND ar2.clock_in IS NOT NULL
    AND ar2.clock_out IS NOT NULL
) v
WHERE ar.id = v.id;
