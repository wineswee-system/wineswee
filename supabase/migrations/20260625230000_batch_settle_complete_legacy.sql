-- ════════════════════════════════════════════════════════════════════════════
-- 批次補結：新功能上線前的舊費用單，核銷(驗收)直接通過
-- 2026-06-25
--
-- 背景：核銷(驗收)新功能上線，上線前累積的舊單不必再走核銷流程，一次補結成「已核銷」。
-- 範圍（= 後台兩張卡看到的 137 筆）：
--   organization_id = 1、deleted_at IS NULL、doc_type = 'expense'、
--   status IN ('已核准'=未送核銷 123, '待核銷'=14)
--   （全表另有 #284 / #280 已軟刪除，被 deleted_at 條件排除，不動）
--
-- 補結內容（比照現有已核銷單的長相）：
--   status              → '已核銷'
--   actual_amount       → COALESCE(actual_amount, estimated_amount)
--                         未送核銷的 123 筆沒填實際金額 → 用申請(預估)金額；
--                         已送核銷的 14 筆保留申請人填的實際金額
--   settle_current_step → 3（過末步，對齊既有已核銷；status 已終態，UI 不會再嘗試推進）
--   settled_by          → '系統批次補結(新功能上線前舊單)'（帳面看得出是批次補的）
--   settled_at / updated_at → NOW()
--
-- 安全：
--   * SET LOCAL app.skip_chain_notify = 'true' → _trg_notify_expense_request_updated
--     三個推播分支本來就不會在「→已核銷」觸發；此旗標再加一層保險，137 筆全程 0 LINE。
--   * 不建會計分錄（全系統既有已核銷單皆無分錄，保持一致）。
--   * WHERE 綁定 status IN ('已核准','待核銷')，補結後即不再符合 → idempotent，可重跑 0 筆。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL app.skip_chain_notify = 'true';

UPDATE public.expense_requests
   SET status              = '已核銷',
       actual_amount       = COALESCE(actual_amount, estimated_amount),
       settle_current_step = 3,
       settled_by          = '系統批次補結(新功能上線前舊單)',
       settled_at          = NOW(),
       updated_at          = NOW()
 WHERE organization_id = 1
   AND deleted_at IS NULL
   AND doc_type = 'expense'
   AND status IN ('已核准', '待核銷');

COMMIT;
