-- 在飛「經常性費用報銷」(expenses)末關財務會簽對齊新鏈:張庭瑋(62)→陳虹(52) — 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:經常性費用(expenses 表,rt='expense')簽核鏈 25「費用報銷簽核鏈」末關財務會簽換人,
--   模板已改 emp#52 陳虹(Zoey代);但待審核舊單簽核人凍在 request_chain_snapshots
--   (step2 = emp#62 張庭瑋 Vicky代,frozen_emp_ids=[62])。核准讀快照不讀模板→仍送張庭瑋。
--   ※ 這是「經常性費用」(expenses);先前 20260806200000 只改了「非經常性」(expense_requests)。
--
-- 修:待審核 expenses 未簽關卡(step_order>=current_step)中 frozen=[62] 的,
--   改 target_emp_id 62→52、frozen_emp_ids [62]→[52]、label 更新。
--   (這批 frozen 有值→matcher 只認 frozen,故 target 與 frozen 都要改。)
--   已核准關卡不動;帶 frozen=[62] 守門→冪等(已套用→0 列)。不改任何 function/trigger。
--   目前符合的僅 #42(chain 25 step2)。
-- ════════════════════════════════════════════════════════════════════════════
UPDATE public.request_chain_snapshots s
   SET target_emp_id  = 52,
       frozen_emp_ids = ARRAY[52]::int[],
       label          = '財務會簽(Zoey代)'
 WHERE s.request_type   = 'expense'
   AND s.target_emp_id  = 62
   AND s.frozen_emp_ids = ARRAY[62]::int[]
   AND s.request_id IN (SELECT id FROM public.expenses WHERE status = '待審核')
   AND s.step_order >= (SELECT e.current_step FROM public.expenses e WHERE e.id = s.request_id);
