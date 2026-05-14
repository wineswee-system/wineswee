-- ════════════════════════════════════════════════════════════
-- 一次性：員工 supervisor_id 自動 backfill + 請假 chain 改 applicant_supervisor
-- 2026-05-14
--
-- 解決前一支 (20260514190000) 留下的兩個手工步驟：
--   1. 員工卡填直屬主管
--   2. 請假 chain 改成 applicant_supervisor
--
-- backfill 規則：
--   - 已有 supervisor_id 的不動（尊重手動設定）
--   - 員工自己是部門主管（departments.manager_id 指向他）→ NULL（高管，無上級）
--   - 有 store_id → supervisor_id = stores.manager_id（該店店長）
--   - 沒 store_id 但有 department_id → supervisor_id = departments.manager_id
--
-- chain 改動：
--   - 只改 form_chain_configs 內 form_type='leave' active chain 的
--     第 1 關（step_order=0）且 target_type='applicant_store_manager'
--   - 改成 target_type='applicant_supervisor'
--   - 不誤動其他 chain
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. backfill 員工 supervisor_id ═══
DO $$
DECLARE
  v_count INT;
BEGIN
  WITH upd AS (
    UPDATE employees e SET supervisor_id = CASE
      -- 是部門主管 → NULL（高管不設）
      WHEN EXISTS (SELECT 1 FROM departments d WHERE d.manager_id = e.id) THEN NULL
      -- 是店長 → 該店所屬部門的主管
      WHEN EXISTS (SELECT 1 FROM stores s WHERE s.manager_id = e.id)
        THEN (SELECT d.manager_id FROM stores s JOIN departments d ON d.id = s.department_id WHERE s.manager_id = e.id LIMIT 1)
      -- 一般員工有 store_id → 該店店長
      WHEN e.store_id IS NOT NULL
        THEN (SELECT manager_id FROM stores WHERE id = e.store_id)
      -- 一般員工沒 store_id 但有 department_id → 部門主管
      WHEN e.department_id IS NOT NULL
        THEN (SELECT manager_id FROM departments WHERE id = e.department_id)
      ELSE NULL
    END
    WHERE e.status = '在職'
      AND e.supervisor_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;
  RAISE NOTICE 'Backfilled supervisor_id for % employees', v_count;
END $$;


-- ═══ 2. 改請假 chain 第 1 關 ═══
DO $$
DECLARE
  v_count INT;
BEGIN
  WITH upd AS (
    UPDATE approval_chain_steps SET
      target_type = 'applicant_supervisor',
      target_store_id = NULL,
      target_emp_id = NULL,
      target_dept_id = NULL,
      target_role_id = NULL,
      target_section_id = NULL
    WHERE chain_id IN (
      SELECT chain_id FROM form_chain_configs
       WHERE form_type = 'leave' AND COALESCE(is_active, true) = true
    )
      AND step_order = 0
      AND target_type = 'applicant_store_manager'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;
  RAISE NOTICE 'Updated % leave chain step(s) to applicant_supervisor', v_count;
END $$;

COMMIT;

-- 驗證
SELECT e.id, e.name, e.store_id, e.department_id, e.supervisor_id, sup.name AS supervisor_name
  FROM employees e LEFT JOIN employees sup ON sup.id = e.supervisor_id
 WHERE e.status = '在職'
 ORDER BY e.id LIMIT 20;
