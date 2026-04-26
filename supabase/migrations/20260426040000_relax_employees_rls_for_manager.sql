-- ============================================================
-- 放寬 employees RLS：manager 也可以編輯員工資料
--
-- 原本 (20260424210000)：
--   - INSERT/DELETE: 只 admin / super_admin
--   - UPDATE 自己: ok
--   - UPDATE 別人: 只 admin / super_admin
-- 問題：實務上店長 (manager) 也需要編輯下屬資料 (排班、聯絡方式等)
--      → 現在 OrgModule 編輯員工會 403
--
-- 改為：
--   - INSERT/DELETE: 維持只 admin / super_admin (新增刪除員工是高風險)
--   - UPDATE 自己: ok
--   - UPDATE 別人: admin / super_admin / manager
-- ============================================================

BEGIN;

-- 重建 UPDATE policy：admin/super_admin/manager 都可以
DROP POLICY IF EXISTS employees_update_admin ON employees;

CREATE POLICY employees_update_admin ON employees
  FOR UPDATE TO authenticated
  USING     (current_employee_role() IN ('admin', 'super_admin', 'manager'))
  WITH CHECK (current_employee_role() IN ('admin', 'super_admin', 'manager'));

-- self_update policy 維持（員工改自己）
-- INSERT/DELETE 維持只 admin/super_admin

NOTIFY pgrst, 'reload schema';
COMMIT;
