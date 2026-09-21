-- =============================================
-- 修正各部門的 manager_id（指到正確的在職主管）
-- 原本都指到雙胞胎中的英文 row 或已離職 row
-- =============================================

BEGIN;

UPDATE departments SET manager_id = 44  WHERE id = 10;  -- 外部接案 → Snow
UPDATE departments SET manager_id = 68  WHERE id = 11;  -- 稽核室   → 劉雅玲
UPDATE departments SET manager_id = 60  WHERE id = 20;  -- 加盟展店 → 林巧玉
UPDATE departments SET manager_id = 62  WHERE id = 23;  -- 營運部   → 張庭瑋
UPDATE departments SET manager_id = 48  WHERE id = 25;  -- 財務部   → 韓虎
UPDATE departments SET manager_id = 72  WHERE id = 28;  -- 倉儲物流 → 楊家謙

-- 安全檢查
DO $$
DECLARE
  bad INT;
BEGIN
  SELECT COUNT(*) INTO bad
  FROM departments d
  WHERE d.manager_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = d.manager_id AND e.status = '在職');
  IF bad > 0 THEN
    RAISE EXCEPTION '還有 % 個部門 manager 指向非在職員工', bad;
  END IF;
END $$;

COMMIT;
