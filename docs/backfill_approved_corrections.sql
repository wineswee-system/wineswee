-- ════════════════════════════════════════════════════════════
-- Backfill: 把 trigger 掛上前已核准的補打卡套用到 attendance_records
-- ════════════════════════════════════════════════════════════
-- ⚠ 先 dry-run 看清楚會動哪幾筆再正式跑

-- ─── Dry-run：列出會被處理的紀錄 + 預覽 ───
SELECT
  c.id           AS correction_id,
  c.employee,
  c.date,
  c.type,
  c.correction_time,
  c.clock_mode,
  a.clock_in     AS current_clock_in,
  a.clock_out    AS current_clock_out,
  CASE
    WHEN c.type = 'clock_in'  AND a.clock_in  IS DISTINCT FROM c.correction_time THEN '⚠ 會覆蓋'
    WHEN c.type = 'clock_in'  AND a.clock_in  = c.correction_time THEN '✅ 已一致'
    WHEN c.type = 'clock_out' AND a.clock_out IS DISTINCT FROM c.correction_time THEN '⚠ 會覆蓋'
    WHEN c.type = 'clock_out' AND a.clock_out = c.correction_time THEN '✅ 已一致'
    WHEN a.id IS NULL THEN '🆕 會新建 attendance row'
    ELSE '?'
  END AS preview
FROM public.clock_corrections c
LEFT JOIN public.attendance_records a
  ON a.employee_id = c.employee_id AND a.date = c.date
WHERE c.status = '已核准'
  AND c.deleted_at IS NULL
  AND c.correction_time IS NOT NULL
  AND c.type IN ('clock_in', 'clock_out')
ORDER BY c.id;


-- ─── 正式跑 backfill：把上面 ⚠/🆕 的逐筆套用 ───
-- 確認 dry-run 結果 OK 後解開下面註解再跑

-- DO $$
-- DECLARE c clock_corrections;
-- BEGIN
--   FOR c IN
--     SELECT cc.* FROM public.clock_corrections cc
--     WHERE cc.status = '已核准'
--       AND cc.deleted_at IS NULL
--       AND cc.correction_time IS NOT NULL
--       AND cc.type IN ('clock_in', 'clock_out')
--     ORDER BY cc.id
--   LOOP
--     PERFORM public._apply_correction_to_attendance(c);
--   END LOOP;
-- END $$;
