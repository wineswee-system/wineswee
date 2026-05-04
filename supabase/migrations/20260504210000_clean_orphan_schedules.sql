-- =============================================
-- 清理 schedules 表內指向離職/已改名員工的孤兒資料
-- 1. rename: 楊昭鈞 → 楊朝鈞 (改名)、Vicky → 張庭瑋 (雙胞胎合併)
-- 2. delete: 張丞佑 / 林善智 (真離職的歷史排班)
-- 3. backfill: schedules.employee_id 從 employee name 對到在職 employees.id
-- =============================================

BEGIN;

-- ── 1. rename ──
UPDATE schedules SET employee = '楊朝鈞' WHERE employee = '楊昭鈞';
UPDATE schedules SET employee = '張庭瑋' WHERE employee = 'Vicky';

-- ── 2. delete 真離職員工歷史排班 ──
DELETE FROM schedules WHERE employee IN ('張丞佑', '林善智');

-- ── 3. backfill employee_id by name → 在職 employees.id ──
-- 同名只挑在職的那個，避免對到雙胞胎中的離職 row
UPDATE schedules s
SET employee_id = e.id
FROM employees e
WHERE s.employee = e.name
  AND e.status = '在職'
  AND s.employee_id IS NULL;

-- 安全檢查：跑完後 schedules 內名字應該都對得到在職員工
DO $$
DECLARE
  bad INT;
BEGIN
  SELECT COUNT(DISTINCT s.employee) INTO bad
  FROM schedules s
  WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.name = s.employee AND e.status = '在職');
  IF bad > 0 THEN
    RAISE NOTICE '注意：仍有 % 個 schedule employee 名字找不到在職員工（可能是測試資料、不影響運作）', bad;
  END IF;
END $$;

COMMIT;
