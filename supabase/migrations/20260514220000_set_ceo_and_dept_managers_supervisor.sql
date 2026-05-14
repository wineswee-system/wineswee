-- ════════════════════════════════════════════════════════════
-- 總經理室主管設陳虹 + 其他部門主管 supervisor 指向陳虹
-- 2026-05-14（用戶確認）
--
-- 規則：
--   - 「總經理室」manager_id = 52 (陳虹) — 若未設
--   - 韓德森(48) / 陳虹(52) supervisor 不動（高管最頂層）
--   - 其他「是某部門主管」且主部門不是總經理室的人 → supervisor = 52
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 設總經理室 manager_id ═══
DO $$
DECLARE
  v_id INT;
BEGIN
  SELECT manager_id INTO v_id FROM departments WHERE name = '總經理室';
  IF v_id IS NULL THEN
    UPDATE departments SET manager_id = 52 WHERE name = '總經理室';
    RAISE NOTICE 'Set 總經理室 manager_id = 52 (陳虹)';
  ELSE
    RAISE NOTICE '總經理室 已有 manager_id = %, skip', v_id;
  END IF;
END $$;

-- ═══ 2. 部門主管（主部門非總經理室）supervisor = 52 ═══
DO $$
DECLARE
  v_count INT;
  v_tongjing_id INT;
BEGIN
  SELECT id INTO v_tongjing_id FROM departments WHERE name = '總經理室' LIMIT 1;

  WITH upd AS (
    UPDATE employees SET supervisor_id = 52
    WHERE status = '在職'
      AND supervisor_id IS NULL
      AND id <> 52                                          -- 陳虹本人不動
      AND id <> 48                                          -- 韓德森不動
      AND (department_id IS NULL OR department_id <> v_tongjing_id)  -- 主部門不是總經理室
      AND EXISTS (SELECT 1 FROM departments d WHERE d.manager_id = employees.id)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;
  RAISE NOTICE 'Set supervisor_id=52 (陳虹) for % dept managers', v_count;
END $$;

COMMIT;

-- 驗證
SELECT e.id, e.name, e.position, d.name AS dept, sup.name AS supervisor,
       ARRAY(SELECT name FROM departments WHERE manager_id = e.id) AS manager_of
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN employees sup ON sup.id = e.supervisor_id
 WHERE e.status = '在職'
   AND (sup.id = 52 OR e.id IN (48, 52) OR EXISTS (SELECT 1 FROM departments WHERE manager_id = e.id))
 ORDER BY e.id;
