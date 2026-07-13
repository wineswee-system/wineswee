-- 刪除尤致皓(emp 58)的測試殘骸「2025結算特休」1筆
-- 2026-07-13  這是當初在 104 測試用的資料(total 1天/已休0),使用者確認刪除。
--   僅刪這一筆(id=2413,並比對 employee_id/leave_type 防呆);不動其他人、其他結算殘骸。idempotent。

DELETE FROM public.leave_balances
WHERE id = 2413
  AND employee_id = 58
  AND leave_type = '2025結算特休'
  AND year = 2026;
