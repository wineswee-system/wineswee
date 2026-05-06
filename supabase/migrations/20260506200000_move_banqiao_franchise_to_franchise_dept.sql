-- =============================================
-- 板橋實踐加盟店搬到「加盟展店事業部」底下
--
-- 之前歸到「營運部 → 營運二課」是劃錯，應該由加盟展店事業部直接管
-- =============================================

BEGIN;

DO $$
DECLARE
  v_franchise_dept_id INT;
  v_franchise_mgr_id  INT;
BEGIN
  -- 找加盟展店事業部 ID
  SELECT id INTO v_franchise_dept_id
  FROM departments
  WHERE name = '加盟展店事業部'
  LIMIT 1;

  IF v_franchise_dept_id IS NULL THEN
    RAISE EXCEPTION '找不到「加盟展店事業部」，請先確認部門表';
  END IF;

  -- 找加盟展店事業部主管（林巧玉 Cheery）作為 store manager
  SELECT id INTO v_franchise_mgr_id
  FROM employees
  WHERE department_id = v_franchise_dept_id
    AND (name = '林巧玉' OR name LIKE '%Cherry%' OR name LIKE '%Cheery%')
  LIMIT 1;

  -- 更新板橋實踐加盟店：改部門 + 清掉 section（事業部直接管不在課別底下）+ 改主管
  UPDATE stores
  SET department_id = v_franchise_dept_id,
      section_id    = NULL,
      manager_id    = v_franchise_mgr_id
  WHERE id = 23;  -- 板橋實踐加盟店

  RAISE NOTICE '板橋實踐加盟店已搬到加盟展店事業部 (dept_id=%, manager_id=%)',
    v_franchise_dept_id, COALESCE(v_franchise_mgr_id::text, 'NULL');
END $$;

-- 同步該店員工的 department_id（如果有員工的 store_id=23 同時 department_id 還是舊的營運部）
DO $$
DECLARE
  v_franchise_dept_id INT;
  v_updated INT;
BEGIN
  SELECT id INTO v_franchise_dept_id FROM departments WHERE name = '加盟展店事業部' LIMIT 1;

  -- 把這家店的員工 department_id 也跟著更新
  UPDATE employees
  SET department_id = v_franchise_dept_id
  WHERE store_id = 23
    AND status = '在職';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '同步更新 % 位員工的 department_id 為加盟展店事業部', v_updated;
END $$;

COMMIT;
