-- ════════════════════════════════════════════════════════════════════════════
-- 排班設定診斷：對照「你設定的 vs 實際 DB 存的」
-- 分 3 段跑，每段結果分別貼回來
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) 所有門市的 store_settings（休假上限 / 工時 / 營業時段）─────────────
SELECT
  ss.store_id,
  s.name AS store_name,
  ss.work_hour_system,
  ss.ft_monthly_rest_days  AS ft_休假天數,
  ss.pt_monthly_rest_days  AS pt_休假天數,
  ss.ft_monthly_hours_min,
  ss.ft_monthly_hours_max,
  ss.pt_monthly_hours_min,
  ss.pt_monthly_hours_max,
  ss.operating_hours
FROM public.store_settings ss
JOIN public.stores s ON s.id = ss.store_id
ORDER BY ss.store_id;


-- ─── 2) 你測試那家門市的 store_time_slots（換 store_id 為實際）────────────
-- 把 store_id 換成你測試的那家門市 id
SELECT
  store_id,
  year_month,
  day_type,
  start_time,
  end_time,
  required_count,
  max_count,
  label
FROM public.store_time_slots
WHERE store_id = 1       -- ← 改成你測試的門市 id
ORDER BY year_month NULLS LAST, day_type, start_time;


-- ─── 3) 該門市 2026-05 的班別定義 ────────────────────────────────────────
SELECT
  store_id,
  year_month,
  name AS 班別名稱,
  start_time,
  end_time,
  break_minutes,
  shift_type
FROM public.shift_definitions
WHERE store_id = 1       -- ← 改成你測試的門市 id
  AND (year_month = '2026-05' OR year_month IS NULL)
ORDER BY year_month NULLS LAST, start_time;
