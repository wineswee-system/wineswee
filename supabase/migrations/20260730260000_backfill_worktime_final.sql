-- 工時 backfill(最終版,取代 210000)— 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 兩件事:
--   1. 壞紀錄(clock_in = clock_out)→ total_hours/hours 歸 0(之前被舊版算成 24/23h)。
--   2. 自動算未手改(total_hours = 舊 span 公式)且新值有差 → 重算成 net_work_hours。
-- 護欄:只動 2026-07;只動「= 舊公式」的(不覆蓋人工調整);idempotent。
-- ⚠️ 需先跑 250000(net_work_hours 最終版)。跑前建議再跑一次 ABS(new−cur)≥0.5 預覽確認。
-- ════════════════════════════════════════════════════════════════════════════

-- 1. 壞紀錄歸 0
UPDATE public.attendance_records
   SET total_hours = 0, hours = 0
 WHERE clock_in IS NOT NULL AND clock_out IS NOT NULL
   AND clock_in = clock_out
   AND to_char(date, 'YYYY-MM') = '2026-07'
   AND (COALESCE(total_hours, 0) <> 0 OR COALESCE(hours, 0) <> 0);

-- 2. 自動算未手改 + 有差 → 重算
WITH calc AS (
  SELECT ar.id, ar.total_hours AS cur,
    (EXTRACT(EPOCH FROM ar.clock_out::time)/60 - EXTRACT(EPOCH FROM ar.clock_in::time)/60
      + CASE WHEN ar.clock_out::time <= ar.clock_in::time THEN 1440 ELSE 0 END) AS span_min,
    (COALESCE(ss.employment_category,'')='admin') AS is_admin,
    public.net_work_hours(ar.employee_id, ar.date, ar.clock_in::time, ar.clock_out::time) AS new_h
  FROM public.attendance_records ar
  LEFT JOIN public.salary_structures ss ON ss.employee_id = ar.employee_id
  WHERE ar.clock_in IS NOT NULL AND ar.clock_out IS NOT NULL
    AND ar.clock_in <> ar.clock_out                      -- 壞紀錄已在上面處理
    AND to_char(ar.date, 'YYYY-MM') = '2026-07'
), c2 AS (
  SELECT id, cur, new_h,
    ROUND((span_min - CASE WHEN is_admin THEN 60
                           WHEN span_min < 300 THEN 0
                           WHEN span_min < 540 THEN 30
                           ELSE 60 END)/60.0, 2) AS old_formula
  FROM calc
)
UPDATE public.attendance_records ar
   SET total_hours = c2.new_h, hours = c2.new_h
  FROM c2
 WHERE ar.id = c2.id
   AND ar.total_hours = c2.old_formula          -- 只動自動算未手改的
   AND c2.new_h IS NOT NULL
   AND c2.new_h IS DISTINCT FROM ar.total_hours;

NOTIFY pgrst, 'reload schema';
