-- =============================================
-- 組織重建補修 — 2026-05-04
-- 補修 20260504120000 之後仍存在的 15 個 drift：
--   6 個 row 的 name 還是英文（雙胞胎中保留英文 row 但圖上要中文）
--   10 個管理職 (部門主管/督導/區域店長/店長) 的 position 還是舊頭銜
-- =============================================

BEGIN;

-- ── name 修正（中文 name 蓋過英文）──
UPDATE employees SET name = '陳虹'   WHERE id = 52;   -- was Zoey
UPDATE employees SET name = '詹建如' WHERE id = 145;  -- was Anita
UPDATE employees SET name = '張啟達' WHERE id = 152;  -- was Danny
UPDATE employees SET name = '游如梅' WHERE id = 151;  -- was Grace
UPDATE employees SET name = '黃蘊珊' WHERE id = 148;  -- was Molly
UPDATE employees SET name = '陳嘉益' WHERE id = 141;  -- was Tako

-- ── position 修正（管理職用圖上的職稱）──
UPDATE employees SET position = '部門主管' WHERE id = 48;   -- 韓虎  (was 門市人員)
UPDATE employees SET position = '部門主管' WHERE id = 52;   -- 陳虹  (was 行銷專員)
UPDATE employees SET position = '部門主管' WHERE id = 60;   -- 林巧玉(was 經理)
UPDATE employees SET position = '部門主管' WHERE id = 62;   -- 張庭瑋(was 督導) ※兼督導，主職以主管登錄
UPDATE employees SET position = '部門主管' WHERE id = 68;   -- 劉雅玲(was 稽核人員)
UPDATE employees SET position = '部門主管' WHERE id = 72;   -- 楊家謙(was 專員)
UPDATE employees SET position = '督導'     WHERE id = 148;  -- 黃蘊珊(was 副主管)
UPDATE employees SET position = '區域店長' WHERE id = 141;  -- 陳嘉益(was NULL)
UPDATE employees SET position = '店長'     WHERE id = 134;  -- 趙亭威(was 區督導)

-- ── 安全檢查 ──
DO $$
DECLARE
  bad INT;
BEGIN
  SELECT COUNT(*) INTO bad FROM employees WHERE status='在職';
  IF bad <> 86 THEN
    RAISE EXCEPTION '在職人數不對: %', bad;
  END IF;
  -- 8 個 LINE id 還在
  SELECT COUNT(*) INTO bad
  FROM (VALUES (10),(44),(48),(52),(58),(62),(148),(152)) AS t(id)
  WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = t.id AND e.status='在職');
  IF bad > 0 THEN
    RAISE EXCEPTION 'LINE 綁定 id 不見: %', bad;
  END IF;
END $$;

COMMIT;
