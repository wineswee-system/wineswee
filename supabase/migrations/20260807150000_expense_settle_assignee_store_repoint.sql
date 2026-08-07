-- 未送驗收費用單「驗收人」對齊現任店長(門市店長換人) — 2026-08-07
-- ════════════════════════════════════════════════════════════════════════════
-- 承 20260807140000(部門/品牌),本支處理「選門市→驗收人=該店現任店長」的過時 6 筆。
-- 依 stores.manager_id 現任店長解析(老闆確認全改):
--   威耀總部(#376 韓德森48→陳虹52、#431 張庭瑋62→陳虹52)
--   高雄富民(#318 林巧玉60→張庭瑋62)  ※現任店長=張庭瑋
--   復興北(#429,#426 張庭瑋62→劉家君75)
--   六張犁(#401 張庭瑋62→陳嘉益141)
-- 每條帶 settle_assignee_id=舊值 + settled_at IS NULL 守門 → 冪等。
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.expense_requests SET settle_assignee_id = 52
 WHERE id IN (376) AND settle_assignee_id = 48 AND settled_at IS NULL;  -- 威耀總部 →陳虹
UPDATE public.expense_requests SET settle_assignee_id = 52
 WHERE id IN (431) AND settle_assignee_id = 62 AND settled_at IS NULL;  -- 威耀總部 →陳虹
UPDATE public.expense_requests SET settle_assignee_id = 62
 WHERE id IN (318) AND settle_assignee_id = 60 AND settled_at IS NULL;  -- 高雄富民 →張庭瑋
UPDATE public.expense_requests SET settle_assignee_id = 75
 WHERE id IN (429,426) AND settle_assignee_id = 62 AND settled_at IS NULL;  -- 復興北 →劉家君
UPDATE public.expense_requests SET settle_assignee_id = 141
 WHERE id IN (401) AND settle_assignee_id = 62 AND settled_at IS NULL;  -- 六張犁 →陳嘉益
