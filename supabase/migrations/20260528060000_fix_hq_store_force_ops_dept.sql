-- ============================================================
-- 修 tg_force_ops_dept_for_store trigger + 還原 HQ 員工部門
-- 2026-05-28
--
-- 問題：把 21 名總部員工的 store_id 改成 20 (威士威企業總部) 後，
--   trigger tg_force_ops_dept_for_store 看到 store_id IS NOT NULL
--   就強制把 department_id 和 dept 改成「営運部」→ org chart 大亂。
--
-- 修法：
--   1. 更新 trigger function，store_id = 20（總部）時直接 RETURN NEW
--   2. 把被錯誤推到営運部的人 department_id / dept 改回原本的部門
-- ============================================================

BEGIN;

-- ── 1. 修 trigger function ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_force_ops_dept_for_store()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ops_dept_id INT;
BEGIN
  -- ★ 威士威企業總部 (id=20) 是 HQ，不是一般門市，
  --   總部員工自己有部門，不應被強制推到営運部
  IF NEW.store_id = 20 THEN
    RETURN NEW;
  END IF;

  -- 以下邏輯不變：store_id IS NULL 且 position 不含門市/店長 → 直接跳過
  IF NEW.store_id IS NULL
     AND (NEW.position IS NULL
          OR (NEW.position NOT LIKE '%門市%'
              AND NEW.position NOT LIKE '%店長%')) THEN
    RETURN NEW;
  END IF;

  -- 一般門市員工 → 強制放到営運部
  SELECT id INTO ops_dept_id
  FROM public.departments
  WHERE name = '営運部'
  ORDER BY id DESC
  LIMIT 1;

  IF ops_dept_id IS NOT NULL THEN
    NEW.department_id := ops_dept_id;
  END IF;
  RETURN NEW;
END $$;

-- ── 2. 還原被錯改部門的員工 ───────────────────────────────
-- 用 subquery 查部門 id，避免寫死數字

-- 洪伯嘉 → 外部接案
UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '外部接案' LIMIT 1),
  dept          = '外部接案'
WHERE name = '洪伯嘉';

-- 詹健如 → 採購部
UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '採購部' LIMIT 1),
  dept          = '採購部'
WHERE name = '詹健如';

-- 尤致皓 → 人力資源部
UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '人力資源部' LIMIT 1),
  dept          = '人力資源部'
WHERE name = '尤致皓';

-- 徐其祥、張開翔、林襄 → 品牌行銷部
UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '品牌行銷部' LIMIT 1),
  dept          = '品牌行銷部'
WHERE name IN ('徐其祥', '張開翔', '林襄');

-- 楊學文 → 工務部
UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '工務部' LIMIT 1),
  dept          = '工務部'
WHERE name = '楊學文';

-- 楊家謙、朱紹蕾、李英顥 → 倉儲物流部
UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '倉儲物流部' LIMIT 1),
  dept          = '倉儲物流部'
WHERE name IN ('楊家謙', '朱紹蕾', '李英顥');

-- 陳佩璇 → 財務部
UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '財務部' LIMIT 1),
  dept          = '財務部'
WHERE name = '陳佩璇';

-- Snow → 外部接案
UPDATE public.employees SET
  department_id = (SELECT id FROM departments WHERE name = '外部接案' LIMIT 1),
  dept          = '外部接案'
WHERE name = 'Snow';

-- ── 3. 驗證 ────────────────────────────────────────────────
DO $$
DECLARE v_bad INT;
BEGIN
  -- 確認 store_id=20 的員工中，沒有意外落在営運部的
  -- （黃蘊珊、羅紹輝、張庭瑋 本來就是営運部，所以不算錯誤）
  SELECT COUNT(*) INTO v_bad
  FROM employees
  WHERE store_id = 20
    AND dept = '営運部'
    AND name NOT IN ('黃蘊珊', '羅紹輝', '張庭瑋');

  IF v_bad > 0 THEN
    RAISE WARNING '仍有 % 名總部員工部門是営運部（請確認名單）', v_bad;
  ELSE
    RAISE NOTICE 'OK：總部員工部門還原完成';
  END IF;
END $$;

COMMIT;
