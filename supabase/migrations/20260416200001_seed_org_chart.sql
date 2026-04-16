-- ============================================================
-- Seed: 組織架構表 (Organization Chart)
-- 總經理室 → 9 部門 → 12 門市（營運部下）
-- ============================================================

BEGIN;

-- 1) Organization
INSERT INTO organizations (name, slug, status, plan)
VALUES ('總經理室', 'hq', 'active', 'pro')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
RETURNING id;

-- Use a variable for org_id
DO $$
DECLARE
  v_org_id INT;
  v_dept_franchise INT;
  v_dept_purchase INT;
  v_dept_mia INT;
  v_dept_ops INT;
  v_dept_brand INT;
  v_dept_finance INT;
  v_dept_hr INT;
  v_dept_admin INT;
  v_dept_warehouse INT;
  -- employees
  v_emp_cherry INT;
  v_emp_anita INT;
  v_emp_sudongyu INT;
  v_emp_vicky INT;
  v_emp_molly INT;
  v_emp_zoey INT;
  v_emp_alicia INT;
  v_emp_grace INT;
  v_emp_danny INT;
  v_emp_yangxuewen INT;
  v_emp_hualun INT;
  v_emp_aqian INT;
BEGIN
  -- Get or create org
  SELECT id INTO v_org_id FROM organizations WHERE slug = 'hq';

  -- 2) Departments (9 departments under 總經理室)
  INSERT INTO departments (name, organization_id, level, description)
  VALUES ('加盟展店事業部', v_org_id, '事業部', '負責加盟展店業務')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_dept_franchise FROM departments WHERE name = '加盟展店事業部' AND organization_id = v_org_id;

  INSERT INTO departments (name, organization_id, level, description)
  VALUES ('採購部', v_org_id, '部', '負責採購業務')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_dept_purchase FROM departments WHERE name = '採購部' AND organization_id = v_org_id;

  INSERT INTO departments (name, organization_id, level, description)
  VALUES ('Mia門店', v_org_id, '部', 'Mia品牌門店管理')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_dept_mia FROM departments WHERE name = 'Mia門店' AND organization_id = v_org_id;

  INSERT INTO departments (name, organization_id, level, description)
  VALUES ('營運部', v_org_id, '部', '門市營運管理')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_dept_ops FROM departments WHERE name = '營運部' AND organization_id = v_org_id;

  INSERT INTO departments (name, organization_id, level, description)
  VALUES ('品牌行銷部', v_org_id, '部', '品牌行銷與推廣')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_dept_brand FROM departments WHERE name = '品牌行銷部' AND organization_id = v_org_id;

  INSERT INTO departments (name, organization_id, level, description)
  VALUES ('財務部', v_org_id, '部', '財務管理與會計')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_dept_finance FROM departments WHERE name = '財務部' AND organization_id = v_org_id;

  INSERT INTO departments (name, organization_id, level, description)
  VALUES ('人力資源部', v_org_id, '部', '人事管理與招募')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_dept_hr FROM departments WHERE name = '人力資源部' AND organization_id = v_org_id;

  INSERT INTO departments (name, organization_id, level, description)
  VALUES ('總務部', v_org_id, '部', '總務行政管理')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_dept_admin FROM departments WHERE name = '總務部' AND organization_id = v_org_id;

  INSERT INTO departments (name, organization_id, level, description)
  VALUES ('倉儲物流部', v_org_id, '部', '倉儲與物流管理')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_dept_warehouse FROM departments WHERE name = '倉儲物流部' AND organization_id = v_org_id;

  -- 3) Employees (department heads)
  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('Cherry', '加盟展店事業部', v_dept_franchise, v_org_id, '部門主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_cherry FROM employees WHERE name = 'Cherry' AND department_id = v_dept_franchise;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('Anita', '採購部', v_dept_purchase, v_org_id, '部門主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_anita FROM employees WHERE name = 'Anita' AND department_id = v_dept_purchase;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('蘇東瑜', 'Mia門店', v_dept_mia, v_org_id, '部門主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_sudongyu FROM employees WHERE name = '蘇東瑜' AND department_id = v_dept_mia;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('Vicky', '營運部', v_dept_ops, v_org_id, '部門主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_vicky FROM employees WHERE name = 'Vicky' AND department_id = v_dept_ops;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('Molly', '營運部', v_dept_ops, v_org_id, '副主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_molly FROM employees WHERE name = 'Molly' AND department_id = v_dept_ops;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('Zoey', '品牌行銷部', v_dept_brand, v_org_id, '部門主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_zoey FROM employees WHERE name = 'Zoey' AND department_id = v_dept_brand;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('Alicia', '財務部', v_dept_finance, v_org_id, '部門主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_alicia FROM employees WHERE name = 'Alicia' AND department_id = v_dept_finance;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('Grace', '財務部', v_dept_finance, v_org_id, '副主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_grace FROM employees WHERE name = 'Grace' AND department_id = v_dept_finance;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('Danny', '人力資源部', v_dept_hr, v_org_id, '部門主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_danny FROM employees WHERE name = 'Danny' AND department_id = v_dept_hr;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('楊學文', '總務部', v_dept_admin, v_org_id, '部門主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_yangxuewen FROM employees WHERE name = '楊學文' AND department_id = v_dept_admin;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('花輪', '倉儲物流部', v_dept_warehouse, v_org_id, '部門主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_hualun FROM employees WHERE name = '花輪' AND department_id = v_dept_warehouse;

  INSERT INTO employees (name, dept, department_id, organization_id, position, status, is_manager)
  VALUES ('阿謙', '倉儲物流部', v_dept_warehouse, v_org_id, '副主管', '在職', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_emp_aqian FROM employees WHERE name = '阿謙' AND department_id = v_dept_warehouse;

  -- 4) Set department managers
  UPDATE departments SET manager_id = v_emp_cherry,     head = 'Cherry'  WHERE id = v_dept_franchise;
  UPDATE departments SET manager_id = v_emp_anita,      head = 'Anita'   WHERE id = v_dept_purchase;
  UPDATE departments SET manager_id = v_emp_sudongyu,   head = '蘇東瑜'  WHERE id = v_dept_mia;
  UPDATE departments SET manager_id = v_emp_vicky,      head = 'Vicky'   WHERE id = v_dept_ops;
  UPDATE departments SET manager_id = v_emp_zoey,       head = 'Zoey'    WHERE id = v_dept_brand;
  UPDATE departments SET manager_id = v_emp_alicia,     head = 'Alicia'  WHERE id = v_dept_finance;
  UPDATE departments SET manager_id = v_emp_danny,      head = 'Danny'   WHERE id = v_dept_hr;
  UPDATE departments SET manager_id = v_emp_yangxuewen, head = '楊學文'  WHERE id = v_dept_admin;
  UPDATE departments SET manager_id = v_emp_hualun,     head = '花輪'    WHERE id = v_dept_warehouse;

  -- 5) Stores (12 stores under 營運部)
  INSERT INTO stores (name, organization_id, department_id, status, store_type, is_active) VALUES
    ('板橋實踐', v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('南京建國', v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('中信南港', v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('台中英才', v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('台中文心', v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('高雄中正', v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('中山國小', v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('微風廣場', v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('台北永春', v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('天母百貨', v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('六張犁',   v_org_id, v_dept_ops, '營運中', 'retail', true),
    ('松江長安', v_org_id, v_dept_ops, '營運中', 'retail', true)
  ON CONFLICT DO NOTHING;

  -- 6) Link tenant to organization
  UPDATE tenants SET organization_id = v_org_id WHERE organization_id IS NULL;

  RAISE NOTICE '組織架構建立完成: org_id=%, 9 departments, 12 employees, 12 stores', v_org_id;
END $$;

COMMIT;
