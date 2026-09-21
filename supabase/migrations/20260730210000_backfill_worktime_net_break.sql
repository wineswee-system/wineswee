-- 既有打卡工時 backfill:改用 net_work_hours(休息窗∩打卡)— 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 修正舊資料裡「打卡在午休外卻硬扣休息」的 total_hours(如尤致皓 4.2→5.2)。
-- ★ 安全護欄:
--   - 只動 2026-07(當月、未鎖薪);要別月自行改 to_char 條件。
--   - 只動「total_hours 目前 = 舊公式結果」的筆(=自動算、沒被手動改過)→ 不覆蓋人工調整。
--   - 只在新值與現值有差時才 UPDATE。idempotent(重跑不再變)。
-- ⚠️ 跑前先跑 scratchpad/preview_backfill_worktime.sql 看影響清單。
-- ════════════════════════════════════════════════════════════════════════════

WITH calc AS (
  SELECT ar.id, ar.total_hours AS cur,
    (EXTRACT(EPOCH FROM ar.clock_out::time)/60 - EXTRACT(EPOCH FROM ar.clock_in::time)/60
      + CASE WHEN ar.clock_out::time <= ar.clock_in::time THEN 1440 ELSE 0 END) AS span_min,
    (COALESCE(ss.employment_category,'')='admin') AS is_admin,
    public.net_work_hours(ar.employee_id, ar.date, ar.clock_in::time, ar.clock_out::time) AS new_h
  FROM public.attendance_records ar
  LEFT JOIN public.salary_structures ss ON ss.employee_id = ar.employee_id
  WHERE ar.clock_in IS NOT NULL AND ar.clock_out IS NOT NULL
    AND to_char(ar.date,'YYYY-MM') = '2026-07'
), c2 AS (
  SELECT id, cur, new_h,
    ROUND((span_min - CASE WHEN is_admin THEN 60
                           WHEN span_min < 300 THEN 0
                           WHEN span_min < 540 THEN 30
                           ELSE 60 END)/60.0, 2) AS old_formula
  FROM calc
)
UPDATE public.attendance_records ar
   SET total_hours = c2.new_h,
       hours       = c2.new_h
  FROM c2
 WHERE ar.id = c2.id
   AND ar.total_hours = c2.old_formula          -- 只動自動算未手改的
   AND c2.new_h IS NOT NULL
   AND c2.new_h IS DISTINCT FROM ar.total_hours; -- 有差才動

NOTIFY pgrst, 'reload schema';
