-- 清測試資料
-- 2026-05-13 by owner instruction
-- 保留：expense_requests #54,#55；overtime_requests 洪伯嘉
-- 全刪：leave_requests / expenses / business_trips / clock_corrections

BEGIN;

-- ═══ 1. expense_requests：保留 #54, #55 ═══
-- 附件 / line_items 設 ON DELETE CASCADE 會自動跟
WITH del AS (
  DELETE FROM expense_requests WHERE id NOT IN (54, 55) RETURNING id
)
SELECT COUNT(*) AS deleted_expense_requests FROM del;

-- approval_step_history 沒 FK，手動清孤兒
DELETE FROM approval_step_history
WHERE request_type = 'expense_request'
  AND request_id NOT IN (SELECT id FROM expense_requests);

-- ═══ 2. overtime_requests：保留 employee='洪伯嘉' ═══
WITH ot_del AS (
  DELETE FROM overtime_requests WHERE employee <> '洪伯嘉' RETURNING id
)
SELECT COUNT(*) AS deleted_overtime FROM ot_del;

DELETE FROM approval_step_history
WHERE request_type = 'overtime'
  AND request_id NOT IN (SELECT id FROM overtime_requests);

-- workflow_instances 沒 source_table 欄位，靠 template_name + 別的欄位軟連，
-- 跳過清理（孤兒不會影響表單流程，後續真的需要可以另開 cleanup）

-- ═══ 3. leave_requests：全刪 ═══
DELETE FROM leave_requests;
DELETE FROM approval_step_history WHERE request_type = 'leave';

-- ═══ 4. expenses（費用報銷）：全刪 ═══
DELETE FROM expenses;
DELETE FROM approval_step_history WHERE request_type = 'expense';

-- ═══ 5. business_trips（出差）：全刪 ═══
DELETE FROM business_trips;
DELETE FROM approval_step_history WHERE request_type = 'trip';

-- ═══ 6. clock_corrections（補打卡）：全刪 ═══
DELETE FROM clock_corrections;
DELETE FROM approval_step_history WHERE request_type = 'correction';

COMMIT;
