-- =============================================
-- 永春店 2026/04 測試資料匯入
-- 自動產生 by scripts/gen_yongchun_import.mjs
--
-- 內容：
--   1. 找/建 永春店 + 7 員工（用 emp.code 比對；沒 code 欄位則用名稱）
--   2. 建 salary_structures（PT 時薪 220；正職本薪先設 0，等公式確認後補）
--   3. 匯入 4 月班表到 schedules
--   4. 匯入 4 月打卡到 attendance_records（total_hours 用「排定 ∩ 實際」公式）
--   5. (尚未) overtime_requests — 等公式確認後再 INSERT
--
-- 重複跑：先 DELETE 該店 + 該月既有資料再 INSERT，所以 idempotent
-- =============================================

BEGIN;

-- 找 org（用既有第一個）
DO $$
DECLARE
  v_org_id INT;
  v_store_id INT;
BEGIN
  SELECT id INTO v_org_id FROM organizations ORDER BY id LIMIT 1;
  IF v_org_id IS NULL THEN RAISE EXCEPTION '無 org，請先建立 organization'; END IF;

  -- 找/建永春店
  SELECT id INTO v_store_id FROM stores WHERE name = '台北永春連鎖店' AND organization_id = v_org_id;
  IF v_store_id IS NULL THEN
    INSERT INTO stores (name, organization_id) VALUES ('台北永春連鎖店', v_org_id) RETURNING id INTO v_store_id;
    RAISE NOTICE '建立永春店 store_id=%', v_store_id;
  ELSE
    RAISE NOTICE '永春店已存在 store_id=%', v_store_id;
  END IF;

  -- 7 員工 — 用 name 比對（沒 employee code 欄位）
  -- 若已存在就更新 store / status；不存在則 INSERT

  -- L2021080 陳尚琪 (Tako) 店長
  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id) THEN
    INSERT INTO employees (name, dept, position, store, store_id, status, organization_id, role)
      VALUES ('陳尚琪', '門市', '店長', '台北永春連鎖店', v_store_id, '在職', v_org_id, 'manager');
  ELSE
    UPDATE employees SET store_id = v_store_id, store = '台北永春連鎖店', status = '在職'
      WHERE name = '陳尚琪' AND organization_id = v_org_id;
  END IF;

  -- L2025001 許亦翎 門市正職人員
  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id) THEN
    INSERT INTO employees (name, dept, position, store, store_id, status, organization_id, role)
      VALUES ('許亦翎', '門市', '門市正職人員', '台北永春連鎖店', v_store_id, '在職', v_org_id, 'store_staff');
  ELSE
    UPDATE employees SET store_id = v_store_id, store = '台北永春連鎖店', status = '在職'
      WHERE name = '許亦翎' AND organization_id = v_org_id;
  END IF;

  -- L2025063 徐宥芯 門市正職人員
  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id) THEN
    INSERT INTO employees (name, dept, position, store, store_id, status, organization_id, role)
      VALUES ('徐宥芯', '門市', '門市正職人員', '台北永春連鎖店', v_store_id, '在職', v_org_id, 'store_staff');
  ELSE
    UPDATE employees SET store_id = v_store_id, store = '台北永春連鎖店', status = '在職'
      WHERE name = '徐宥芯' AND organization_id = v_org_id;
  END IF;

  -- P20260013 洪瑛奴 門市兼職人員
  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id) THEN
    INSERT INTO employees (name, dept, position, store, store_id, status, organization_id, role)
      VALUES ('洪瑛奴', '門市', '門市兼職人員', '台北永春連鎖店', v_store_id, '在職', v_org_id, 'store_staff');
  ELSE
    UPDATE employees SET store_id = v_store_id, store = '台北永春連鎖店', status = '在職'
      WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  END IF;

  -- P20260024 蔡伊真 門市兼職人員
  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id) THEN
    INSERT INTO employees (name, dept, position, store, store_id, status, organization_id, role)
      VALUES ('蔡伊真', '門市', '門市兼職人員', '台北永春連鎖店', v_store_id, '在職', v_org_id, 'store_staff');
  ELSE
    UPDATE employees SET store_id = v_store_id, store = '台北永春連鎖店', status = '在職'
      WHERE name = '蔡伊真' AND organization_id = v_org_id;
  END IF;

  -- P20260030 林思妤 門市兼職人員
  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = '林思妤' AND organization_id = v_org_id) THEN
    INSERT INTO employees (name, dept, position, store, store_id, status, organization_id, role)
      VALUES ('林思妤', '門市', '門市兼職人員', '台北永春連鎖店', v_store_id, '在職', v_org_id, 'store_staff');
  ELSE
    UPDATE employees SET store_id = v_store_id, store = '台北永春連鎖店', status = '在職'
      WHERE name = '林思妤' AND organization_id = v_org_id;
  END IF;

  -- P20260033 陳姿螢 門市兼職人員
  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id) THEN
    INSERT INTO employees (name, dept, position, store, store_id, status, organization_id, role)
      VALUES ('陳姿螢', '門市', '門市兼職人員', '台北永春連鎖店', v_store_id, '在職', v_org_id, 'store_staff');
  ELSE
    UPDATE employees SET store_id = v_store_id, store = '台北永春連鎖店', status = '在職'
      WHERE name = '陳姿螢' AND organization_id = v_org_id;
  END IF;

  -- salary_structures — UPSERT

  -- 陳尚琪 (正職)
  INSERT INTO salary_structures (employee_id, salary_type, hourly_rate, base_salary, meal_allowance, effective_from)
    SELECT id, 'monthly', 0, 40000, 3000, DATE '2026-04-01'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate,
    base_salary = EXCLUDED.base_salary,
    meal_allowance = EXCLUDED.meal_allowance;

  -- 許亦翎 (正職)
  INSERT INTO salary_structures (employee_id, salary_type, hourly_rate, base_salary, meal_allowance, effective_from)
    SELECT id, 'monthly', 0, 40000, 3000, DATE '2026-04-01'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate,
    base_salary = EXCLUDED.base_salary,
    meal_allowance = EXCLUDED.meal_allowance;

  -- 徐宥芯 (正職)
  INSERT INTO salary_structures (employee_id, salary_type, hourly_rate, base_salary, meal_allowance, effective_from)
    SELECT id, 'monthly', 0, 40000, 3000, DATE '2026-04-01'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate,
    base_salary = EXCLUDED.base_salary,
    meal_allowance = EXCLUDED.meal_allowance;

  -- 洪瑛奴 (PT)
  INSERT INTO salary_structures (employee_id, salary_type, hourly_rate, base_salary, meal_allowance, effective_from)
    SELECT id, 'hourly', 220, 0, 0, DATE '2026-04-01'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate,
    base_salary = EXCLUDED.base_salary,
    meal_allowance = EXCLUDED.meal_allowance;

  -- 蔡伊真 (PT)
  INSERT INTO salary_structures (employee_id, salary_type, hourly_rate, base_salary, meal_allowance, effective_from)
    SELECT id, 'hourly', 220, 0, 0, DATE '2026-04-01'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate,
    base_salary = EXCLUDED.base_salary,
    meal_allowance = EXCLUDED.meal_allowance;

  -- 林思妤 (PT)
  INSERT INTO salary_structures (employee_id, salary_type, hourly_rate, base_salary, meal_allowance, effective_from)
    SELECT id, 'hourly', 220, 0, 0, DATE '2026-04-01'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate,
    base_salary = EXCLUDED.base_salary,
    meal_allowance = EXCLUDED.meal_allowance;

  -- 陳姿螢 (PT)
  INSERT INTO salary_structures (employee_id, salary_type, hourly_rate, base_salary, meal_allowance, effective_from)
    SELECT id, 'hourly', 220, 0, 0, DATE '2026-04-01'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee_id) DO UPDATE SET
    salary_type = EXCLUDED.salary_type,
    hourly_rate = EXCLUDED.hourly_rate,
    base_salary = EXCLUDED.base_salary,
    meal_allowance = EXCLUDED.meal_allowance;

  -- 店長 Tako 本薪 + 加給（待之後修正廠商公式）
  UPDATE salary_structures ss
    SET base_salary = 41000, role_allowance = 8000, meal_allowance = 3000
   FROM employees e
   WHERE ss.employee_id = e.id AND e.name = '陳尚琪' AND e.organization_id = v_org_id;

  -- 清掉永春 7 員工 4 月既有 schedule / attendance（idempotent）
  DELETE FROM schedules WHERE date >= DATE '2026-04-01' AND date <= DATE '2026-04-30'
    AND employee_id IN (SELECT id FROM employees WHERE name = ANY(ARRAY['陳尚琪','許亦翎','徐宥芯','洪瑛奴','蔡伊真','林思妤','陳姿螢']) AND organization_id = v_org_id);
  DELETE FROM attendance_records WHERE date >= DATE '2026-04-01' AND date <= DATE '2026-04-30'
    AND employee_id IN (SELECT id FROM employees WHERE name = ANY(ARRAY['陳尚琪','許亦翎','徐宥芯','洪瑛奴','蔡伊真','林思妤','陳姿螢']) AND organization_id = v_org_id);

  -- 班表 (schedules)
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-01', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-02', '巡店', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-03', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-04', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-05', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-06', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-07', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-08', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-09', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-10', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-11', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-12', '巡店11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-13', '六張犁17-24', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-14', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-15', '六張犁15-24', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-16', '六張犁15-24', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-17', '16-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-18', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-19', '15-24', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-20', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-21', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-22', '巡店13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-23', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-24', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-25', '六張犁11-13', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-26', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-27', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-28', '六張犁15-24', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-29', '11-24', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳尚琪', id, DATE '2026-04-30', '16-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-01', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-02', '14-23', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-03', '15-24', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-04', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-05', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-06', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-07', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-08', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-09', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-10', '14-23', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-11', '14-23', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-12', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-13', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-14', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-15', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-16', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-17', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-18', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-19', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-20', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-21', '生理', '生理', NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-22', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-23', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-24', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-25', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-26', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-27', '六張犁15-19/19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-28', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-29', '六張犁11-20', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '許亦翎', id, DATE '2026-04-30', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-01', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-02', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-03', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-04', '16-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-05', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-06', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-07', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-08', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-09', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-10', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-11', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-12', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-13', '13-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-14', '15-24', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-15', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-16', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-17', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-18', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-19', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-20', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-21', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-22', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-23', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-24', '六張犁11-20', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-25', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-26', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-27', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-28', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-29', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '徐宥芯', id, DATE '2026-04-30', '11-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-01', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-02', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-03', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-04', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-05', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-06', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-07', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-08', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-09', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-10', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-11', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-12', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-13', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-14', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-15', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-16', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-17', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-18', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-19', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-20', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-21', '六張犁19-00', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-22', '六張犁19-00', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-23', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-24', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-25', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-26', '15-22', NULL, NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-27', '六張犁19-00', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-28', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-29', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '洪瑛奴', id, DATE '2026-04-30', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-01', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-02', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-03', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-04', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-05', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-06', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-07', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-08', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-09', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-10', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-11', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-12', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-13', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-14', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-15', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-16', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-17', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-18', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-19', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-20', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-21', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-22', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-23', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-24', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-25', '20-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-26', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-27', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-28', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-29', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '蔡伊真', id, DATE '2026-04-30', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-01', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-02', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-03', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-04', '18-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-05', '18-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-06', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-07', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-08', '21-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-09', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-10', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-11', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-12', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-13', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-14', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-15', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-16', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-17', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-18', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-19', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-20', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-21', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-22', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-23', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-24', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-25', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-26', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-27', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-28', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-29', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '林思妤', id, DATE '2026-04-30', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-09', '15-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-10', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-11', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-12', '14-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-13', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-14', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-15', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-16', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-17', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-18', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-19', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-20', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-21', '15-20', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-22', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-23', '19-00', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-24', '六張犁19-01', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-25', '六張犁19-00', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-26', '六張犁11-18', NULL, '六張犁', '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-27', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-28', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-29', '休', '休', NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;
  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)
    SELECT '陳姿螢', id, DATE '2026-04-30', '19-01', NULL, NULL, '2026-04'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id
  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;

  -- 打卡 (attendance_records)
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-01', '10:51:13', '20:00:42', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-02', '10:50:52', '20:00:00', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-03', '11:00:00', '20:01:55', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-04', '11:00:00', '20:07:50', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-06', '10:55:30', '20:02:07', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-07', '15:00:00', '21:03:02', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-09', '10:53:31', '20:13:28', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-10', '10:54:42', '20:09:09', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-11', '10:53:11', '20:37:38', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-12', '10:47:42', '20:06:13', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-13', '16:49:02', '00:03:38', 7, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-15', '14:54:22', '00:00:00', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-16', '14:59:19', '00:07:33', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-17', '15:46:05', '02:16:01', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-18', '12:53:44', '22:19:45', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-19', '14:44:39', '00:34:14', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-21', '11:00:35', '21:03:00', 7.99, TRUE, 1, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-22', '12:52:21', '22:02:04', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-23', '12:51:20', '00:02:09', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-24', '11:00:08', '22:16:13', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-25', '11:00:03', '13:04:19', 2, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-27', '12:55:45', '22:06:42', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-28', '14:41:05', '00:00:11', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-29', '10:55:13', '02:30:44', 12, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳尚琪', id, v_store_id, DATE '2026-04-30', '15:59:57', '01:04:02', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '陳尚琪' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-01', '12:59:17', '22:00:44', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-02', '13:55:55', '00:04:25', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-03', '14:56:11', '00:03:10', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-06', '12:59:14', '22:02:28', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-07', '13:00:20', '22:09:04', 7.99, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-08', '12:57:22', '22:09:19', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-10', '13:56:32', '23:41:04', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-11', '14:00:55', '23:02:59', 7.98, TRUE, 1, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-13', '10:53:02', '20:02:46', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-14', '10:50:58', '20:02:33', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-15', '10:53:03', '20:16:31', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-16', '12:55:43', '22:16:03', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-18', '10:57:49', '20:01:07', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-20', '12:53:06', '22:00:35', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-21', NULL, NULL, 0, FALSE, 0, '未打卡'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-22', '12:54:58', '22:02:17', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-24', '10:55:54', '20:08:25', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-25', '10:57:52', '20:04:13', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-27', '14:48:56', '00:02:31', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-28', '12:53:20', '22:04:42', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '許亦翎', id, v_store_id, DATE '2026-04-29', '10:51:56', '20:07:55', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-02', '12:57:47', '22:02:49', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-04', '15:56:46', NULL, 0, FALSE, 0, '異常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-05', '14:00:00', '23:00:00', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-07', '10:55:50', '20:02:34', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-08', '10:55:21', '20:03:21', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-09', NULL, NULL, 0, FALSE, 0, '未打卡'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-12', '12:55:32', '22:02:04', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-13', '12:54:30', '22:01:13', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-14', '14:58:23', '00:17:00', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-16', '10:55:16', '20:03:37', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-17', '10:50:02', '20:00:51', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-19', '10:56:24', '20:01:40', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-20', '10:53:18', '20:00:00', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-22', '10:53:33', '20:01:08', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-23', '10:50:08', '20:02:00', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-24', '10:48:11', '20:00:38', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-26', '10:50:12', '20:03:28', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-27', '10:55:12', '20:02:03', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-28', '10:51:45', '20:11:24', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '徐宥芯', id, v_store_id, DATE '2026-04-30', '10:32:26', '21:41:49', 8, FALSE, 0, '正常'
      FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-01', '19:00:00', '00:06:56', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-08', '19:00:13', '00:11:34', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-09', '18:55:51', '00:05:45', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-11', '19:00:09', '01:03:47', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-12', '19:00:17', '00:30:05', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-18', '19:00:14', '01:08:26', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-21', '19:00:06', '00:23:41', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-22', '19:00:05', '00:10:24', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-26', '14:59:49', '22:01:08', 7, FALSE, 0, '正常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-27', '19:00:00', '00:04:33', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '洪瑛奴', id, v_store_id, DATE '2026-04-29', '00:00:00', NULL, 0, TRUE, 300, '異常'
      FROM employees WHERE name = '洪瑛奴' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-02', '18:49:16', NULL, 0, FALSE, 0, '異常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-03', NULL, NULL, 0, FALSE, 0, '異常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-04', NULL, NULL, 0, FALSE, 0, '異常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-05', '18:51:57', NULL, 0, FALSE, 0, '異常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-06', '18:49:30', NULL, 0, FALSE, 0, '異常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-07', NULL, NULL, 0, FALSE, 0, '異常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-08', NULL, NULL, 0, FALSE, 0, '異常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-09', '18:53:10', '00:08:57', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-10', '18:57:17', '02:36:20', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-13', '18:49:60', '00:41:42', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-15', '18:50:33', '00:31:37', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-16', '18:49:32', '00:45:51', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-18', '18:52:28', '01:11:11', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-20', '18:49:48', '00:03:26', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-21', '18:52:30', '00:03:10', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-22', '18:53:40', '00:32:30', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-23', '18:51:21', '00:44:37', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-24', '18:53:22', '01:31:06', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-25', '17:54:03', '00:01:15', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-27', '18:54:01', '00:02:32', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '蔡伊真', id, v_store_id, DATE '2026-04-28', '18:34:24', '00:36:58', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-01', '19:00:00', '00:00:00', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-03', '19:00:00', '01:00:00', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-04', '18:00:00', '01:00:00', 7, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-05', '18:00:00', '01:00:00', 7, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-06', '19:00:00', '00:00:00', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-08', '21:00:00', '00:00:00', 3, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-11', '19:00:00', '01:00:00', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-12', '19:00:00', '00:00:00', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-22', '19:00:45', '00:30:56', 4.99, TRUE, 1, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-24', '19:00:29', '01:30:46', 5.99, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-25', '19:00:00', '01:47:12', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-26', '18:59:41', '00:03:26', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '林思妤', id, v_store_id, DATE '2026-04-30', '19:00:00', '01:00:00', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-09', '15:00:00', '20:00:00', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-12', '13:58:30', '20:02:38', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-13', '18:57:24', '00:41:54', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-14', '18:57:29', '00:15:16', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-15', '18:59:27', '00:30:33', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-17', '18:57:41', '02:15:20', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-19', '18:58:08', '00:00:00', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-20', '18:59:56', '00:00:27', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-21', '15:00:16', '20:07:07', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-23', '18:57:31', '00:39:41', 5, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-24', '11:00:00', '18:56:00', 7, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-25', '19:23:18', '01:01:03', 0, TRUE, 503, '遲到'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-26', '10:59:15', '20:06:23', 7, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;
  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)
    SELECT '陳姿螢', id, v_store_id, DATE '2026-04-30', '18:58:37', '01:08:46', 6, FALSE, 0, '正常'
      FROM employees WHERE name = '陳姿螢' AND organization_id = v_org_id;

  RAISE NOTICE '永春 4 月匯入完成';
END $$;

COMMIT;

-- ────────────────────────────────────────────────────────
-- 匯入後核對：
-- ────────────────────────────────────────────────────────
-- 看每員工的工時加總
SELECT e.name, COUNT(*) AS days, SUM(ar.total_hours) AS total_hours
  FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id
 WHERE e.name = ANY(ARRAY['陳尚琪','許亦翎','徐宥芯','洪瑛奴','蔡伊真','林思妤','陳姿螢'])
   AND ar.date >= DATE '2026-04-01' AND ar.date <= DATE '2026-04-30'
 GROUP BY e.name
 ORDER BY e.name;

-- 預期 PT 各人工時（廠商薪資反推）：
-- 洪瑛奴 (P20260013) = 49.5h
-- 蔡伊真 (P20260024) = 67.5h
-- 林思妤 (P20260030) = 66h
-- 陳姿螢 (P20260033) = 73.5h
