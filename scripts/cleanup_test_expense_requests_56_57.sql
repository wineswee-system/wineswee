-- =============================================
-- 刪除測試管理員建的 2 筆測試 expense_request
-- 2026-05-14
--
-- 影響範圍（已跟用戶確認）：
--   - expense_requests        : id 56 (123/申請中), 57 (111/已核准) = 2
--   - approval_step_history   : 4 筆 trigger log
--   - expense_request_attachments : 2 筆附件 metadata
--   - storage (expense-receipts bucket) : 2 個 PNG → orphan 保留（手動清）
-- =============================================

BEGIN;

-- 1. ASH log 先刪
DELETE FROM approval_step_history
WHERE request_type = 'expense_request' AND request_id IN (56, 57);

-- 2. 附件 metadata
DELETE FROM expense_request_attachments WHERE request_id IN (56, 57);

-- 3. 主表
DELETE FROM expense_requests WHERE id IN (56, 57);

COMMIT;

-- 驗證
SELECT 'expense_requests' AS t, COUNT(*) FROM expense_requests WHERE id IN (56,57)
UNION ALL
SELECT 'attachments',           COUNT(*) FROM expense_request_attachments WHERE request_id IN (56,57)
UNION ALL
SELECT 'ash',                   COUNT(*) FROM approval_step_history WHERE request_type='expense_request' AND request_id IN (56,57);
