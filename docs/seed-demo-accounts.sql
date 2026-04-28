-- ============================================================
-- 測試帳號 seed：1 admin + 1 store_staff
--
-- 前置：Dashboard → Authentication → Users 已建立
--   admin@demo.sme / staff@demo.sme
--   （Auto Confirm User 勾起來）
-- 這段 SQL 會在 employees 插入對應 row，並用 email 連回 auth.users
-- ============================================================

BEGIN;

-- ① 確認有預設 organization（用第一個 org）
DO $$
DECLARE
  org_id INT;
BEGIN
  SELECT id INTO org_id FROM organizations ORDER BY id LIMIT 1;
  IF org_id IS NULL THEN
    INSERT INTO organizations (name, slug) VALUES ('示範公司', 'demo-org') RETURNING id INTO org_id;
  END IF;

  -- ② 插入 Admin 員工（role_id=2）
  INSERT INTO employees (
    name, email, phone, dept, position, status,
    organization_id, role_id, role
  ) VALUES (
    '測試管理員', 'admin@demo.sme', '0900-000-001',
    '管理部', '系統管理員', '在職',
    org_id, 2, 'admin'
  )
  ON CONFLICT (email) DO UPDATE SET
    role_id = EXCLUDED.role_id,
    role = EXCLUDED.role,
    status = '在職';

  -- ③ 插入 Store Staff 員工（role_id=5）
  INSERT INTO employees (
    name, email, phone, dept, position, status,
    organization_id, role_id, role
  ) VALUES (
    '測試員工', 'staff@demo.sme', '0900-000-002',
    '門市部', '門市人員', '在職',
    org_id, 5, 'store_staff'
  )
  ON CONFLICT (email) DO UPDATE SET
    role_id = EXCLUDED.role_id,
    role = EXCLUDED.role,
    status = '在職';
END $$;

-- ④ 把 employees.auth_user_id 補上（用 email 對應 auth.users.id）
UPDATE employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE e.email IN ('admin@demo.sme', 'staff@demo.sme')
  AND u.email = e.email
  AND e.auth_user_id IS NULL;

-- ⑤ 驗證結果
SELECT
  e.id, e.name, e.email, e.role, r.name AS role_name,
  e.organization_id, o.name AS org_name,
  CASE WHEN e.auth_user_id IS NOT NULL THEN '✓ auth linked' ELSE '✗ no auth' END AS auth_status
FROM employees e
LEFT JOIN roles r ON r.id = e.role_id
LEFT JOIN organizations o ON o.id = e.organization_id
WHERE e.email IN ('admin@demo.sme', 'staff@demo.sme')
ORDER BY e.role_id;

COMMIT;
