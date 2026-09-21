-- Cleanup: 刪除 seed 重複產生的 org_id=3 及其關聯資料
BEGIN;

-- 先解除 departments manager_id FK
UPDATE departments SET manager_id = NULL WHERE organization_id = 3;

-- 刪除 org_id=3 相關的 department_manager_history
DELETE FROM department_manager_history WHERE organization_id = 3;
DELETE FROM department_manager_history WHERE manager_id IN (SELECT id FROM employees WHERE organization_id = 3);

-- 移除 org_id=3 的 employees (seed duplicates)
DELETE FROM employees WHERE organization_id = 3;

-- 移除 org_id=3 的 stores
DELETE FROM stores WHERE organization_id = 3;

-- 移除 org_id=3 的 departments
DELETE FROM departments WHERE organization_id = 3;

-- 移除 org_id=3 本身
DELETE FROM organizations WHERE id = 3;

COMMIT;
