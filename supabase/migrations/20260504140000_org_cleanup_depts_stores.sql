-- =============================================
-- 組織重建後續清理 — 2026-05-04
-- 1. 修正 韓虎 (id=48) 部門：因 trigger tg_force_ops_dept_for_store
--    在前次 migration 把位仍為「門市人員」時被推回營運部
-- 2. 清理 0 employees 的舊部門 (id=1~9, 22)
-- 3. 把不在新組織圖內的 store 設 is_active=false
-- 4. 把 Mla (mia門店 id=19) 連到營運部
-- =============================================

BEGIN;

-- ── 1. 修正 韓虎 部門 ──
UPDATE employees SET
  department_id = 25,
  dept = '財務部'
WHERE id = 48;

-- ── 2. 清理 0 employees 舊部門 ──
-- id=22 (Mia門店) 還有 1 個 inactive employee (id=146 蘇東瑜)，先 NULL 掉再刪
UPDATE employees SET department_id = NULL WHERE department_id = 22;

DELETE FROM departments WHERE id IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 22);

-- ── 3. 不在新組織圖內的 store 停用 ──
UPDATE stores SET is_active = false
WHERE id IN (18, 20, 22, 23);
-- 18 = 13台北信義安和 (圖上沒有)
-- 20 = 威士威企業總部 (內部，不算門市)
-- 22 = 台北測試中心
-- 23 = 板橋實踐 (圖上沒有)

-- ── 4. Mla (mia門店) 連到營運部 ──
UPDATE stores SET
  department_id = 23,
  is_active = true
WHERE id = 19;

-- ── 安全檢查 ──
DO $$
DECLARE
  active_emp INT;
  ops_count INT;
  bad_emp INT;
BEGIN
  SELECT COUNT(*) INTO active_emp FROM employees WHERE status='在職';
  IF active_emp <> 86 THEN
    RAISE EXCEPTION '在職人數不對: %', active_emp;
  END IF;

  -- 確認 韓虎 在財務部
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id=48 AND department_id=25) THEN
    RAISE EXCEPTION '韓虎 id=48 部門不對';
  END IF;

  -- 確認沒人在已刪部門
  SELECT COUNT(*) INTO bad_emp
  FROM employees
  WHERE status='在職' AND department_id IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 22);
  IF bad_emp > 0 THEN
    RAISE EXCEPTION '還有 % 人在被刪部門', bad_emp;
  END IF;
END $$;

COMMIT;
