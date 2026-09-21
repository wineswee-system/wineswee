-- 批次補結：張庭瑋的驗收單直接壓過 — 2026-07-27
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:張庭瑋(#62)是核銷負責人的 17 筆費用單,積壓在「未送驗收(已核准)」,
--   比照 6/25 批次補結(20260625230000)直接壓成「已核銷/已驗收」,不再走驗收流程。
-- 範圍(= 張庭瑋 settle_assignee_id=62 的驗收待辦,17 筆,全為 status='已核准'):
--   #287 #292 #299 #300 #316 #319 #328 #329 #330 #331 #332 #333 #371 #380 #381 #385 #386
--   合計預估約 NT$ 2,152,114
-- 補結內容(比照現有已核銷單長相):
--   status              → '已核銷'
--   actual_amount       → COALESCE(actual_amount, estimated_amount) (皆未填→用預估)
--   settle_current_step → 3 (過末步,對齊既有已核銷;status 已終態,UI 不會再推進)
--   settled_by          → '系統批次補結(張庭瑋驗收單)'(帳面看得出是批次補的)
--   settled_at/updated_at → NOW()
-- 安全:
--   * SET LOCAL app.skip_chain_notify='true' → 兩支通知 trigger 頂端都吃此旗標,
--     '已核准→已核銷' 本會推 settle_approved 給申請人(17 張卡),此旗標全程 0 LINE。
--   * 不建會計分錄(全系統既有已核銷單皆無分錄,保持一致)。
--   * WHERE 綁定明確 17 個 id + settle_assignee_id=62 + status IN(...),
--     壓完即不符合 → idempotent,可重跑 0 筆;絕不誤傷他人驗收單。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL app.skip_chain_notify = 'true';

UPDATE public.expense_requests
   SET status              = '已核銷',
       actual_amount       = COALESCE(actual_amount, estimated_amount),
       settle_current_step = 3,
       settled_by          = '系統批次補結(張庭瑋驗收單)',
       settled_at          = NOW(),
       updated_at          = NOW()
 WHERE organization_id = 1
   AND deleted_at IS NULL
   AND doc_type = 'expense'
   AND settle_assignee_id = 62
   AND id IN (287,292,299,300,316,319,328,329,330,331,332,333,371,380,381,385,386)
   AND status IN ('已核准', '待核銷', '核銷已退回');

COMMIT;
