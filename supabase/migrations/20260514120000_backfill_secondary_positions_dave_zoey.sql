-- ════════════════════════════════════════════════════════════
-- 補 Dave / Zoey 在次要任職部門的職稱
-- 2026-05-14
--
-- 組織圖之前因為這 4 筆 assignment 沒填 position，
-- fallback 顯示員工主職（老闆 / 總經理(執行長)）→ 看起來像錯位。
--
-- 修法：
--   - 韓德森 @ 採購部 → 採購副總
--   - 韓德森 @ 財務部 → 財務副總
--   - 陳虹 @ 品牌行銷部 → 行銷副總
--   - 陳虹 @ 工務部 → 工務副總
--
-- 邏輯：找該員工該部門 active assignment，有 → UPDATE position；
--      沒有 → INSERT 一筆「次要」active assignment
-- ════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  item JSONB;
  v_emp_id INT;
  v_dept_id INT;
  v_existing_id INT;
BEGIN
  FOR item IN
    SELECT value FROM jsonb_array_elements('[
      {"emp": "韓德森", "dept": "採購部",    "position": "採購副總"},
      {"emp": "韓德森", "dept": "財務部",    "position": "財務副總"},
      {"emp": "陳虹",   "dept": "品牌行銷部", "position": "行銷副總"},
      {"emp": "陳虹",   "dept": "工務部",    "position": "工務副總"}
    ]'::jsonb)
  LOOP
    SELECT id INTO v_emp_id
      FROM employees
     WHERE name = item->>'emp' AND status = '在職'
     LIMIT 1;

    SELECT id INTO v_dept_id
      FROM departments
     WHERE name = item->>'dept'
     LIMIT 1;

    IF v_emp_id IS NULL OR v_dept_id IS NULL THEN
      RAISE NOTICE 'SKIP: emp=% / dept=% not found', item->>'emp', item->>'dept';
      CONTINUE;
    END IF;

    SELECT id INTO v_existing_id
      FROM employee_assignments
     WHERE employee_id = v_emp_id
       AND department_id = v_dept_id
       AND is_active = true
     ORDER BY id DESC
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE employee_assignments
         SET position = item->>'position', updated_at = NOW()
       WHERE id = v_existing_id;
      RAISE NOTICE 'UPDATED #% : % @ % -> %',
        v_existing_id, item->>'emp', item->>'dept', item->>'position';
    ELSE
      INSERT INTO employee_assignments
        (employee_id, department_id, position, department_type, is_active, start_date)
      VALUES
        (v_emp_id, v_dept_id, item->>'position', '次要', true, CURRENT_DATE);
      RAISE NOTICE 'INSERTED 次要: % @ % -> %',
        item->>'emp', item->>'dept', item->>'position';
    END IF;

    -- reset for next iteration
    v_emp_id := NULL;
    v_dept_id := NULL;
    v_existing_id := NULL;
  END LOOP;
END $$;

COMMIT;

-- 驗證：列出 Dave / Zoey 所有 active assignments
SELECT a.id, e.name AS emp, d.name AS dept, a.department_type, a.position, a.start_date
  FROM employee_assignments a
  JOIN employees e ON e.id = a.employee_id
  LEFT JOIN departments d ON d.id = a.department_id
 WHERE e.name IN ('韓德森','陳虹') AND a.is_active = true
 ORDER BY e.name, a.department_type DESC, a.id;
