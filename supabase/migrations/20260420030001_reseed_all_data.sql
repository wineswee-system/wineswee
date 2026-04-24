-- ============================================================
-- Re-seed all data after refactor cleared everything
-- 2026-04-20
-- ============================================================

BEGIN;

-- ═══ 1. Organization ═══
INSERT INTO organizations (id, name, slug, status, plan) VALUES
  (1, '威士威企業', 'wsw', 'active', 'pro')
ON CONFLICT (id) DO NOTHING;
SELECT setval('organizations_id_seq', 1, true);

-- ═══ 2. Roles + Permissions ═══
DELETE FROM role_permissions;
DELETE FROM roles;
INSERT INTO roles (id, name, description, level) VALUES
  (1, 'super_admin',  '超級管理員 — 全系統全權限',   200),
  (2, 'admin',        '管理員 — 全公司人資與系統管理', 100),
  (3, 'manager',      '主管 — 管理所屬部門/分店',     80),
  (4, 'office_staff', '行政員工 — 後勤行政操作',      40),
  (5, 'store_staff',  '門市員工 — 門市基本操作',      20)
ON CONFLICT (id) DO NOTHING;
SELECT setval('roles_id_seq', 5, true);

DELETE FROM permissions;
INSERT INTO permissions (id, code, name, module) VALUES
  (1, 'employee.view', '查看員工資料', '人資'),
  (2, 'employee.view_full', '查看完整個資', '人資'),
  (3, 'employee.edit', '編輯員工資料', '人資'),
  (4, 'leave.approve', '審核假單', '人資'),
  (5, 'salary.view', '查看薪資', '人資'),
  (6, 'salary.view_all', '查看全部薪資', '人資'),
  (7, 'pr.approve', '審核採購', '採購'),
  (8, 'po.create', '建立採購單', '採購'),
  (9, 'inventory.edit', '修改庫存', '倉儲'),
  (10, 'customer.view_full', '查看客戶資料', 'CRM'),
  (11, 'customer.edit', '編輯客戶', 'CRM'),
  (12, 'finance.view', '查看財務', '財務'),
  (13, 'finance.edit', '編輯傳票', '財務'),
  (14, 'system.admin', '系統管理', '系統'),
  (15, 'audit.view', '稽核日誌', '系統')
ON CONFLICT (id) DO NOTHING;
SELECT setval('permissions_id_seq', 15, true);

INSERT INTO role_permissions (role_id, permission_id) VALUES
  (1,1),(1,2),(1,3),(1,4),(1,5),(1,6),(1,7),(1,8),(1,9),(1,10),(1,11),(1,12),(1,13),(1,14),(1,15),
  (2,1),(2,2),(2,3),(2,4),(2,5),(2,6),(2,14),(2,15),
  (3,1),(3,2),(3,4),(3,5),
  (4,1),(4,5),
  (5,1),(5,5)
ON CONFLICT DO NOTHING;

-- ═══ 3. Departments ═══
INSERT INTO departments (id, name, organization_id) VALUES
  (1, '品牌行銷部', 1),
  (2, '業務部', 1),
  (3, '人資部', 1),
  (4, '財務部', 1),
  (5, '客服部', 1),
  (6, '營運部', 1),
  (7, '資訊部', 1),
  (8, '採購部', 1),
  (9, '總經辦', 1)
ON CONFLICT (id) DO NOTHING;
SELECT setval('departments_id_seq', 9, true);

-- ═══ 4. Stores (門市) ═══
INSERT INTO stores (id, name, organization_id, status) VALUES
  (18, '13台北信義安和', 1, '營運中'),
  (19, 'mia門店', 1, '營運中'),
  (20, '威士威企業總部', 1, '營運中'),
  (22, '台北測試中心', 1, '營運中'),
  (23, '板橋實踐', 1, '營運中'),
  (24, '南京建國', 1, '營運中'),
  (25, '中信南港', 1, '營運中'),
  (26, '台中英才', 1, '營運中'),
  (27, '台中文心', 1, '營運中'),
  (28, '高雄中正', 1, '營運中'),
  (29, '中山國小', 1, '營運中'),
  (30, '微風廣場', 1, '營運中'),
  (31, '台北永春', 1, '營運中'),
  (32, '天母百貨', 1, '營運中'),
  (33, '六張犁', 1, '營運中'),
  (34, '松江長安', 1, '營運中')
ON CONFLICT (id) DO NOTHING;
SELECT setval('stores_id_seq', 34, true);

-- ═══ 5. Core employees (from screenshots + conversation history) ═══
-- Using new schema: department_id, store_id, organization_id
INSERT INTO employees (id, name, name_en, department_id, position, store_id, organization_id, status, email, role, role_id, employment_type, employee_number, is_manager) VALUES
  (10, '洪伯嘉', 'Aska Hung', 7, '資深工程師', 20, 1, '在職', 'aska20021023@gmail.com', 'super_admin', 1, '全職', 'EMP-001', true),
  (44, 'SNOW', 'SNOW', 7, '資深工程師', 20, 1, '在職', 'astrops.psych@gmail.com', 'super_admin', 1, '全職', 'EMP-002', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  department_id = EXCLUDED.department_id,
  store_id = EXCLUDED.store_id,
  organization_id = EXCLUDED.organization_id,
  role = EXCLUDED.role,
  role_id = EXCLUDED.role_id;

-- The other employees from the employee list screenshot
-- Alicia, Anita, Dave, Ken, Vicky, Zoey, 學文
INSERT INTO employees (name, name_en, department_id, position, store_id, organization_id, status, role, role_id, employment_type, employee_number, is_manager) VALUES
  ('Alicia', 'Alicia', 6, '門市人員', 29, 1, '在職', 'store_staff', 5, '全職', 'EMP-003', false),
  ('Anita', 'Anita', 8, '採購專員', 20, 1, '在職', 'office_staff', 4, '全職', 'EMP-004', false),
  ('Dave', 'Dave', 6, '門市人員', 29, 1, '在職', 'store_staff', 5, '全職', 'EMP-006', false),
  ('Ken', 'Ken', 6, '門市人員', 29, 1, '在職', 'store_staff', 5, '全職', 'EMP-007', false),
  ('Vicky', 'Vicky', 6, '區域主管', 20, 1, '在職', 'manager', 3, '全職', 'EMP-008', true),
  ('Zoey', 'Zoey', 1, '行銷專員', 29, 1, '在職', 'office_staff', 4, '全職', 'EMP-010', false),
  ('學文', '學文', 6, '總務專員', 20, 1, '在職', 'office_staff', 4, '全職', 'EMP-011', false)
ON CONFLICT (employee_number) DO NOTHING;

-- ═══ 6. Holidays ═══
INSERT INTO holidays (name, date, type) VALUES
  ('兒童節', '2026-04-04', '國定假日'),
  ('清明節', '2026-04-05', '國定假日'),
  ('勞動節', '2026-05-01', '國定假日'),
  ('端午節', '2026-05-31', '國定假日'),
  ('中秋節', '2026-10-06', '國定假日')
ON CONFLICT DO NOTHING;

-- ═══ 7. Store settings (operating hours + rest days) ═══
-- 文心: 平日11-00 假日11-02
-- 微風/南港: 平日10:30-00 假日10:30-01
-- 其他: 平日11-00 假日11-01
INSERT INTO store_settings (store_id, operating_hours, ft_monthly_rest_days, pt_monthly_rest_days) VALUES
  (27, '{"mon":{"open":"11:00","close":"00:00"},"tue":{"open":"11:00","close":"00:00"},"wed":{"open":"11:00","close":"00:00"},"thu":{"open":"11:00","close":"00:00"},"fri":{"open":"11:00","close":"02:00"},"sat":{"open":"11:00","close":"02:00"},"sun":{"open":"11:00","close":"00:00"}}', 10, 20),
  (30, '{"mon":{"open":"10:30","close":"00:00"},"tue":{"open":"10:30","close":"00:00"},"wed":{"open":"10:30","close":"00:00"},"thu":{"open":"10:30","close":"00:00"},"fri":{"open":"10:30","close":"01:00"},"sat":{"open":"10:30","close":"01:00"},"sun":{"open":"10:30","close":"00:00"}}', 10, 20),
  (25, '{"mon":{"open":"10:30","close":"00:00"},"tue":{"open":"10:30","close":"00:00"},"wed":{"open":"10:30","close":"00:00"},"thu":{"open":"10:30","close":"00:00"},"fri":{"open":"10:30","close":"01:00"},"sat":{"open":"10:30","close":"01:00"},"sun":{"open":"10:30","close":"00:00"}}', 10, 20)
ON CONFLICT (store_id) DO UPDATE SET operating_hours = EXCLUDED.operating_hours, ft_monthly_rest_days = EXCLUDED.ft_monthly_rest_days, pt_monthly_rest_days = EXCLUDED.pt_monthly_rest_days;

-- Default hours for all other stores
INSERT INTO store_settings (store_id, operating_hours, ft_monthly_rest_days, pt_monthly_rest_days)
SELECT s.id,
  '{"mon":{"open":"11:00","close":"00:00"},"tue":{"open":"11:00","close":"00:00"},"wed":{"open":"11:00","close":"00:00"},"thu":{"open":"11:00","close":"00:00"},"fri":{"open":"11:00","close":"01:00"},"sat":{"open":"11:00","close":"01:00"},"sun":{"open":"11:00","close":"00:00"}}',
  10, 20
FROM stores s
WHERE s.id NOT IN (25, 27, 30)
ON CONFLICT (store_id) DO NOTHING;

-- ═══ 8. LINE channel placeholder ═══
INSERT INTO line_channels (id, code, name, is_default, status) VALUES
  (1, 'main', '主要 BOT', true, 'active')
ON CONFLICT (id) DO NOTHING;

COMMIT;
