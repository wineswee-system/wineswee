-- 在飛費用申請「末關財務會簽」對齊新簽核鏈:張庭瑋(62,Vicky代) → 陳虹(52,Zoey代) — 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:費用申請簽核鏈(chain 8/9/10/38/39)末關「財務會簽」換人 —
--   模板已改成 emp#52 陳虹(Zoey代);但「申請中」的舊單當初建立時把簽核人凍在
--   request_chain_snapshots(末關 step3 = emp#62 張庭瑋 Vicky代)。
--   核准是讀「快照」不讀「模板」→ 這些舊單走到末關仍會送給張庭瑋,不是新設定的陳虹。
--
-- 修:把「申請中」且末關快照仍 = emp#62 的舊單,末關 target_emp_id 改 52 + label 更新。
--   • frozen_emp_ids = NULL(動態解析)→ 改 snapshot.target_emp_id 即改路由。
--   • 只動末關(step3);step0~2 已核准/進行中的關卡完全不碰。
--   • 這些單目前 current_step ≤ 2,尚未走到末關 → 不打斷進行中的簽核,
--     待其推進到 step3 時 notify 會自動解析到新人(陳虹)。
--
-- 範圍(31 張):chain 8/9/10/38/39 的申請中舊單。
--   排除:chain 21(非費用/人資備查 emp152,末關未改)、#470(建立時已是新版)。
-- 冪等:重跑時末關已 = 52 → 0 列。不改任何 function/trigger。
-- ════════════════════════════════════════════════════════════════════════════
UPDATE public.request_chain_snapshots s
   SET target_emp_id = 52,
       label         = '財務會簽(Zoey代)'
 WHERE s.request_type = 'expense_request'
   AND s.step_order   = 3
   AND s.target_emp_id = 62
   AND s.frozen_emp_ids IS NULL
   AND s.request_id IN (
     SELECT id FROM public.expense_requests WHERE status = '申請中'
   );
