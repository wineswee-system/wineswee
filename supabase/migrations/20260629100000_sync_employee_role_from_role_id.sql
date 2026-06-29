-- ════════════════════════════════════════════════════════════════════════════
-- 同步 employees.role 文字欄與 role_id 外鍵
-- 2026-06-29
--
-- 問題：舊資料 role = 'employee'（legacy）但 role_id 已指向正確角色
--      → Users.jsx 讀 role 文字顯示「行政人員」
--      → EmployeeDetail HrTab 讀 role_id 顯示正確角色
--      → 兩邊不一致，造成混淆
--
-- 修法：以 role_id join roles.name 為真理源，覆寫 role 文字欄
--       只動 role_id 有值且 role 跟 roles.name 不符的列。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

UPDATE employees e
SET    role = r.name
FROM   roles r
WHERE  e.role_id = r.id
  AND  r.name IN ('store_staff','office_staff','manager','admin','super_admin')
  AND  (e.role IS DISTINCT FROM r.name);

-- 確認結果
SELECT role, count(*) FROM employees WHERE status = '在職' GROUP BY role ORDER BY role;
