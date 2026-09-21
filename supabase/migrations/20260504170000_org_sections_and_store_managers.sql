-- =============================================
-- 營運部 課級結構 + 店長 / 兼任店長設定
-- 1. 新表 department_sections（部門下的「課」）
-- 2. stores 加 section_id 欄
-- 3. 建 4 個營運部課別
-- 4. 12 家門市分別歸課 + 設店長 (含兼任)
-- 5. 重啟 板橋實踐 + 改名 mia門店 → MIa
-- =============================================

BEGIN;

-- ── 1. 新表 ──
CREATE TABLE IF NOT EXISTS department_sections (
  id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL DEFAULT 1 REFERENCES organizations(id),
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  supervisor_id INT REFERENCES employees(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_department_sections_dept ON department_sections(department_id);

ALTER TABLE department_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "department_sections_read_all" ON department_sections;
CREATE POLICY "department_sections_read_all" ON department_sections
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "department_sections_write_admin" ON department_sections;
CREATE POLICY "department_sections_write_admin" ON department_sections
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.auth_user_id = auth.uid()
        AND e.role IN ('super_admin','admin')
    )
  );

-- ── 2. stores 加 section_id ──
ALTER TABLE stores ADD COLUMN IF NOT EXISTS section_id INT REFERENCES department_sections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stores_section_id ON stores(section_id);

-- ── 3. 建 4 個營運部課別 ──
-- 用固定 id 方便引用（前提：DB 沒有 sequence 衝突）
INSERT INTO department_sections (organization_id, department_id, name, supervisor_id, sort_order)
VALUES
  (1, 23, '營運一課',     62,  1),  -- 督導 張庭瑋 Vicky (兼)
  (1, 23, '營運二課',     148, 2),  -- 督導 黃蘊珊 Molly
  (1, 23, '營運三課',     141, 3),  -- 區域店長 陳嘉益 Tako
  (1, 23, '研發暨品管課', 210, 4);  -- 督導 羅紹輝 Jack

-- ── 4. 門市歸課 + 設店長 ──
-- 一課
UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運一課'),
  manager_id = 134  -- 趙亭威 Willy
WHERE id = 26;  -- 台中英才

UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運一課'),
  manager_id = 134  -- 趙亭威 Willy 兼任
WHERE id = 27;  -- 台中文心

UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運一課'),
  manager_id = 62   -- 張庭瑋 Vicky 兼任
WHERE id = 28;  -- 高雄中正

-- 二課
UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運二課'),
  manager_id = NULL  -- 板橋實踐加盟店暫無主管
WHERE id = 23;  -- 板橋實踐

UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運二課'),
  manager_id = 148   -- 黃蘊珊 Molly 兼任
WHERE id = 19;  -- mia門店

UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運二課'),
  manager_id = 113   -- 周佳霖
WHERE id = 24;  -- 南京建國

UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運二課'),
  manager_id = 107   -- 鍾喬
WHERE id = 25;  -- 中信南港

UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運二課'),
  manager_id = 75    -- 劉家君
WHERE id = 29;  -- 中山國小

UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運二課'),
  manager_id = 94    -- 高承揚
WHERE id = 30;  -- 微風廣場

UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運二課'),
  manager_id = 148   -- 黃蘊珊 Molly 兼任
WHERE id = 34;  -- 松江長安

-- 三課
UPDATE stores SET
  section_id = (SELECT id FROM department_sections WHERE name='營運三課'),
  manager_id = 141   -- 陳嘉益 Tako
WHERE id IN (31, 32, 33);  -- 台北永春, 天母百貨, 六張犁

-- ── 5. 重啟 板橋實踐 + 改名 ──
UPDATE stores SET is_active = true, name = '板橋實踐加盟店', department_id = 23
WHERE id = 23;

UPDATE stores SET name = 'MIa'
WHERE id = 19;

-- ── 安全檢查 ──
DO $$
DECLARE
  bad INT;
BEGIN
  SELECT COUNT(*) INTO bad FROM department_sections WHERE department_id = 23;
  IF bad <> 4 THEN
    RAISE EXCEPTION '營運部課別數異常: %', bad;
  END IF;

  SELECT COUNT(*) INTO bad FROM stores
  WHERE department_id = 23 AND is_active = true AND section_id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION '還有 % 家在職門市沒分課', bad;
  END IF;
END $$;

COMMIT;
