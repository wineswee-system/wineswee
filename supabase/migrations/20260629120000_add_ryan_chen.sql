-- 新增員工：行銷部經理 Ryan 陳家瑋
-- 2026-06-29  idempotent

DO $$
DECLARE
  v_org_id  bigint;
  v_dept_id bigint;
BEGIN
  -- 取 organization_id（取第一筆，單租戶）
  SELECT id INTO v_org_id FROM organizations LIMIT 1;

  -- 取品牌行銷部 department_id
  SELECT id INTO v_dept_id FROM departments
  WHERE name ILIKE '%行銷%' AND organization_id = v_org_id
  LIMIT 1;

  -- 若已存在（name + org 重複）就跳過
  IF EXISTS (
    SELECT 1 FROM employees
    WHERE name = '陳家瑋' AND organization_id = v_org_id
  ) THEN
    RAISE NOTICE '陳家瑋 已存在，跳過';
    RETURN;
  END IF;

  INSERT INTO employees (
    name, name_en, dept, department_id,
    position, employment_type, status,
    role, role_id,
    join_date,
    organization_id
  ) VALUES (
    '陳家瑋', 'Ryan', '品牌行銷部', v_dept_id,
    '經理', '正職', '在職',
    'manager', 3,
    '2026-06-29',
    v_org_id
  );

  RAISE NOTICE '陳家瑋 (Ryan) 新增完成';
END $$;
