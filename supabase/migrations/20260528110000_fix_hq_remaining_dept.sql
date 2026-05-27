-- ============================================================
-- 還原被遺漏的總部員工部門（20260528060000 補漏）
--
-- 這 6 人在 store_id 搬遷時被 tg_force_ops_dept_for_store trigger
-- 強制推到「營運部」，但不在 060000 還原名單裡：
--   劉雅玲  → 稽核室
--   林巧玉  → 加盟展店事業部
--   韓德森  → 採購部
--   游如梅  → 財務部
--   張啟達  → 人力資源部
--   陳虹    → 品牌行銷部
-- ============================================================

BEGIN;

UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '稽核室' LIMIT 1),
  dept          = '稽核室'
WHERE name = '劉雅玲' AND store_id = 20;

UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '加盟展店事業部' LIMIT 1),
  dept          = '加盟展店事業部'
WHERE name = '林巧玉' AND store_id = 20;

UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '採購部' LIMIT 1),
  dept          = '採購部'
WHERE name = '韓德森' AND store_id = 20;

UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '財務部' LIMIT 1),
  dept          = '財務部'
WHERE name = '游如梅' AND store_id = 20;

UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '人力資源部' LIMIT 1),
  dept          = '人力資源部'
WHERE name = '張啟達' AND store_id = 20;

UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '品牌行銷部' LIMIT 1),
  dept          = '品牌行銷部'
WHERE name = '陳虹' AND store_id = 20;

-- ── 驗證 ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad  INT;
  v_rec  RECORD;
BEGIN
  -- 列出所有 store_id=20 非営運部合法成員中仍在營運部的人
  SELECT COUNT(*) INTO v_bad
  FROM employees
  WHERE store_id = 20
    AND dept IN ('營運部', '営運部')
    AND name NOT IN ('黃蘊珊', '羅紹輝', '張庭瑋');

  IF v_bad > 0 THEN
    RAISE WARNING '仍有 % 名總部員工部門是營運部（請確認）', v_bad;
    FOR v_rec IN
      SELECT name, dept FROM employees
      WHERE store_id = 20
        AND dept IN ('營運部', '営運部')
        AND name NOT IN ('黃蘊珊', '羅紹輝', '張庭瑋')
    LOOP
      RAISE WARNING '  → %: %', v_rec.name, v_rec.dept;
    END LOOP;
  ELSE
    RAISE NOTICE 'OK：所有總部員工部門已還原完成';
  END IF;
END $$;

COMMIT;
