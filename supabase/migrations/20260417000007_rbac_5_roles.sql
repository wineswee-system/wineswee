-- Migration: RBAC 改為 5 角色制
-- super_admin / admin / manager / office_staff / store_staff

BEGIN;

-- ═══ 1. 清除舊的 role_permissions ═══
DELETE FROM role_permissions;

-- ═══ 2. 清除舊 roles，重新建立 ═══
-- 先把 employees 的 role_id 暫時清掉，避免 FK 衝突
UPDATE employees SET role_id = NULL;

DELETE FROM roles;

INSERT INTO roles (id, name, description, level) VALUES
  (1, 'super_admin',  '超級管理員 — 全系統全權限',   200),
  (2, 'admin',        '管理員 — 全公司人資與系統管理', 100),
  (3, 'manager',      '主管 — 管理所屬部門/分店',     80),
  (4, 'office_staff', '行政員工 — 後勤行政操作',      40),
  (5, 'store_staff',  '門市員工 — 門市基本操作',      20);

-- 重設 sequence
SELECT setval('roles_id_seq', 5);

-- ═══ 3. 重建 role_permissions ═══
-- permissions 表不動（15 筆權限維持不變）

INSERT INTO role_permissions (role_id, permission_id) VALUES
  -- super_admin: 全部 15 個權限
  (1,1),(1,2),(1,3),(1,4),(1,5),(1,6),(1,7),(1,8),(1,9),(1,10),(1,11),(1,12),(1,13),(1,14),(1,15),
  -- admin: HR 全部 + 系統管理 + 稽核
  (2,1),(2,2),(2,3),(2,4),(2,5),(2,6),(2,14),(2,15),
  -- manager: 查看員工 + 完整個資 + 審核假單 + 查看薪資
  (3,1),(3,2),(3,4),(3,5),
  -- office_staff: 查看員工 + 查看自己薪資
  (4,1),(4,5),
  -- store_staff: 查看員工 + 查看自己薪資
  (5,1),(5,5);

-- ═══ 4. 把現有員工的 role 欄位對應到新角色 ═══
-- 根據 employees.role 文字欄位對應 role_id
UPDATE employees SET role_id = (
  CASE role
    WHEN 'super_admin'  THEN 1
    WHEN 'admin'        THEN 2
    WHEN 'manager'      THEN 3
    WHEN 'office_staff' THEN 4
    WHEN 'store_staff'  THEN 5
    -- 舊角色對應
    WHEN 'staff'        THEN 5  -- 舊 staff → 門市員工
    ELSE 5                      -- 預設門市員工
  END
);

COMMIT;
