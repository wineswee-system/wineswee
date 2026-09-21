-- =============================================
-- 永春 7 員工的 salary_structures 補設
-- 從廠商薪資表反推每人本薪 / 津貼 / 時薪
-- =============================================

BEGIN;

DO $$
DECLARE
  v_org_id INT;
BEGIN
  SELECT id INTO v_org_id FROM organizations ORDER BY id LIMIT 1;

  -- ── 陳嘉益 (Tako, 店長) 月薪制 ──
  -- 廠商：本薪 41,000 + 主管 8,000 + 伙食 3,000 + 夜班 3,000 + 跨店 7,500
  INSERT INTO salary_structures (
    employee_id, salary_type, base_salary, role_allowance, meal_allowance,
    custom_allowances, effective_from
  )
  SELECT id, 'monthly', 41000, 8000, 3000,
    '[{"name":"夜班津貼","amount":3000},{"name":"跨店津貼","amount":7500}]'::jsonb,
    DATE '2026-04-01'
    FROM employees WHERE name = '陳嘉益' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    base_salary = EXCLUDED.base_salary,
    role_allowance = EXCLUDED.role_allowance,
    meal_allowance = EXCLUDED.meal_allowance,
    custom_allowances = EXCLUDED.custom_allowances;

  -- ── 許亦翎 (門市正職) 月薪制 ──
  -- 廠商：本薪 40,000 + 伙食 3,000 + 夜班 3,000
  INSERT INTO salary_structures (
    employee_id, salary_type, base_salary, meal_allowance,
    custom_allowances, effective_from
  )
  SELECT id, 'monthly', 40000, 3000,
    '[{"name":"夜班津貼","amount":3000}]'::jsonb,
    DATE '2026-04-01'
    FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    base_salary = EXCLUDED.base_salary,
    meal_allowance = EXCLUDED.meal_allowance,
    custom_allowances = EXCLUDED.custom_allowances;

  -- ── 徐宥芯 (門市正職) 月薪制 ──
  INSERT INTO salary_structures (
    employee_id, salary_type, base_salary, meal_allowance,
    custom_allowances, effective_from
  )
  SELECT id, 'monthly', 40000, 3000,
    '[{"name":"夜班津貼","amount":3000}]'::jsonb,
    DATE '2026-04-01'
    FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    base_salary = EXCLUDED.base_salary,
    meal_allowance = EXCLUDED.meal_allowance,
    custom_allowances = EXCLUDED.custom_allowances;

  -- ── 洪瑛妏 (PT) 時薪制 ──
  INSERT INTO salary_structures (
    employee_id, salary_type, hourly_rate, effective_from
  )
  SELECT id, 'hourly', 220, DATE '2026-04-01'
    FROM employees WHERE name = '洪瑛妏' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate;

  -- ── 蔡伊真 (PT) 時薪制 ──
  INSERT INTO salary_structures (
    employee_id, salary_type, hourly_rate, effective_from
  )
  SELECT id, 'hourly', 220, DATE '2026-04-01'
    FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate;

  -- ── 林思妤 (PT) 時薪制 ──
  INSERT INTO salary_structures (
    employee_id, salary_type, hourly_rate, effective_from
  )
  SELECT id, 'hourly', 220, DATE '2026-04-01'
    FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate;

  -- ── 陳姿螢 (PT) 時薪制 ──
  INSERT INTO salary_structures (
    employee_id, salary_type, hourly_rate, effective_from
  )
  SELECT id, 'hourly', 220, DATE '2026-04-01'
    FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate;

  RAISE NOTICE '7 員工 salary_structures 設定完成';
END $$;

COMMIT;

-- 驗證
SELECT e.name, ss.salary_type, ss.base_salary, ss.role_allowance, ss.meal_allowance,
       ss.hourly_rate, ss.custom_allowances
  FROM salary_structures ss
  JOIN employees e ON e.id = ss.employee_id
 WHERE e.name = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 ORDER BY e.name;
