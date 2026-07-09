-- 6月 PT(時薪) 打卡對齊班表：看班表改打卡
-- 2026-07-09  老闆決策：PT 打卡髒 → 以班表為準覆蓋打卡，PT 底薪(吃打卡)就照班表算。
--   ⚠️ 只覆蓋「時薪(salary_type='hourly')」員工;月薪不動。覆蓋真實打卡時間為班表時間。
--   範圍:2026-06,班表有 actual_start/end(真班別)、非請假日、且打卡時數與班表差 >0.25h。
--   影響約 231 筆(49 PT 員工)。工時用 _shift_seg_hours(span−休息:<5h→0/5~9h→30/>=9h→60)。
--   分段班(shift_2)只覆蓋主段;打卡有班表無 不動。此覆蓋 idempotent(再跑=同結果)。

UPDATE public.attendance_records ar SET
  clock_in    = s.actual_start,
  clock_out   = s.actual_end,
  total_hours = public._shift_seg_hours(s.actual_start, s.actual_end)
FROM public.schedules s, public.salary_structures ss
WHERE s.employee_id = ar.employee_id
  AND s.date = ar.date
  AND ss.employee_id = ar.employee_id
  AND COALESCE(ss.salary_type,'') = 'hourly'          -- 只 PT
  AND ar.date >= '2026-06-01' AND ar.date <= '2026-06-30'
  AND s.leave_request_id IS NULL
  AND s.actual_start IS NOT NULL AND s.actual_end IS NOT NULL
  AND ABS(COALESCE(ar.total_hours,0) - public._shift_seg_hours(s.actual_start, s.actual_end)) > 0.25;

NOTIFY pgrst, 'reload schema';
