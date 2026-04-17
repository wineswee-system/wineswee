-- ============================================================
-- Cleanup: 合併舊部門/門市到新組織架構，消除重複
-- 舊部門 (id 7-19) → 新部門 (id 20-28)
-- 舊門市 (id 7-22) → 新門市 (id 23-34)
-- ============================================================

BEGIN;

-- ── 1) 部門合併：把舊部門的員工搬到對應的新部門 ──

-- 人資部(8) → 人力資源部(26)
UPDATE employees SET department_id = 26, dept = '人力資源部', organization_id = 1
  WHERE department_id = 8;

-- 倉儲物流部(9) → 倉儲物流部(28)
UPDATE employees SET department_id = 28, organization_id = 1
  WHERE department_id = 9;

-- 加盟展店事業部(10) → 加盟展店事業部(20)
UPDATE employees SET department_id = 20, organization_id = 1
  WHERE department_id = 10;

-- 品牌行銷部(11) → 品牌行銷部(24)
UPDATE employees SET department_id = 24, organization_id = 1
  WHERE department_id = 11;

-- 採購部(12) → 採購部(21)  (if any)
UPDATE employees SET department_id = 21, organization_id = 1
  WHERE department_id = 12;

-- 業務部(13) → 加盟展店事業部(20)  (合併到展店事業部)
UPDATE employees SET department_id = 20, dept = '加盟展店事業部', organization_id = 1
  WHERE department_id = 13;

-- 營運部(14) → 營運部(23)
UPDATE employees SET department_id = 23, organization_id = 1
  WHERE department_id = 14;

-- 產品及通路開發部(15) → 品牌行銷部(24)
UPDATE employees SET department_id = 24, dept = '品牌行銷部', organization_id = 1
  WHERE department_id = 15;

-- 管理部(16) → 總務部(27)
UPDATE employees SET department_id = 27, dept = '總務部', organization_id = 1
  WHERE department_id = 16;

-- 經營管理部(17) → 總務部(27)
UPDATE employees SET department_id = 27, dept = '總務部', organization_id = 1
  WHERE department_id = 17;

-- 線上部門(18) → 品牌行銷部(24)
UPDATE employees SET department_id = 24, dept = '品牌行銷部', organization_id = 1
  WHERE department_id = 18;

-- 總經理室(19) → 保留為獨立部門，掛到 org_id=1
UPDATE departments SET organization_id = 1, level = '室' WHERE id = 19;
UPDATE employees SET organization_id = 1 WHERE department_id = 19;

-- mia門店(7) → Mia門店(22)
UPDATE employees SET department_id = 22, dept = 'Mia門店', organization_id = 1
  WHERE department_id = 7;

-- ── 2) 門市合併：舊門市員工搬到新門市 ──

-- 01中山國小門市(7) → 中山國小(29)
UPDATE employees SET store_id = 29, store = '中山國小', organization_id = 1 WHERE store_id = 7;
UPDATE user_stores SET store_id = 29 WHERE store_id = 7;

-- 02台中英才門市(8) → 台中英才(26)
UPDATE employees SET store_id = 26, store = '台中英才', organization_id = 1 WHERE store_id = 8;
UPDATE user_stores SET store_id = 26 WHERE store_id = 8;

-- 03台北永春門市(9) → 台北永春(31)
UPDATE employees SET store_id = 31, store = '台北永春', organization_id = 1 WHERE store_id = 9;
UPDATE user_stores SET store_id = 31 WHERE store_id = 9;

-- 04微風百貨門市(10) → 微風廣場(30)
UPDATE employees SET store_id = 30, store = '微風廣場', organization_id = 1 WHERE store_id = 10;
UPDATE user_stores SET store_id = 30 WHERE store_id = 10;

-- 05天母百貨門市(11) → 天母百貨(32)
UPDATE employees SET store_id = 32, store = '天母百貨', organization_id = 1 WHERE store_id = 11;
UPDATE user_stores SET store_id = 32 WHERE store_id = 11;

-- 06中信南港門市(12) → 中信南港(25)
UPDATE employees SET store_id = 25, store = '中信南港', organization_id = 1 WHERE store_id = 12;
UPDATE user_stores SET store_id = 25 WHERE store_id = 12;

-- 07南京建國門市(13) → 南京建國(24)
UPDATE employees SET store_id = 24, store = '南京建國', organization_id = 1 WHERE store_id = 13;
UPDATE user_stores SET store_id = 24 WHERE store_id = 13;

-- 09高雄中正門市(14) → 高雄中正(28)
UPDATE employees SET store_id = 28, store = '高雄中正', organization_id = 1 WHERE store_id = 14;
UPDATE user_stores SET store_id = 28 WHERE store_id = 14;

-- 10六張犁門市(15) → 六張犁(33)
UPDATE employees SET store_id = 33, store = '六張犁', organization_id = 1 WHERE store_id = 15;
UPDATE user_stores SET store_id = 33 WHERE store_id = 15;

-- 11松江長安門市(16) → 松江長安(34)
UPDATE employees SET store_id = 34, store = '松江長安', organization_id = 1 WHERE store_id = 16;
UPDATE user_stores SET store_id = 34 WHERE store_id = 16;

-- 12台中文心門市(17) → 台中文心(27)
UPDATE employees SET store_id = 27, store = '台中文心', organization_id = 1 WHERE store_id = 17;
UPDATE user_stores SET store_id = 27 WHERE store_id = 17;

-- 13台北信義安和(18) → 保留，掛 org_id（沒有對應新門市）
UPDATE stores SET organization_id = 1, department_id = 23 WHERE id = 18;
UPDATE employees SET organization_id = 1 WHERE store_id = 18;

-- mia門店(19) → 保留，掛 org_id
UPDATE stores SET organization_id = 1 WHERE id = 19;
UPDATE employees SET organization_id = 1 WHERE store_id = 19;

-- 威士威企業總部(20) → 保留，掛 org_id
UPDATE stores SET organization_id = 1 WHERE id = 20;
UPDATE employees SET organization_id = 1 WHERE store_id = 20;

-- 新北板橋實踐店(21) → 板橋實踐(23)
UPDATE employees SET store_id = 23, store = '板橋實踐', organization_id = 1 WHERE store_id = 21;
UPDATE user_stores SET store_id = 23 WHERE store_id = 21;

-- 台北測試中心(22) → 保留，掛 org_id
UPDATE stores SET organization_id = 1 WHERE id = 22;
UPDATE employees SET organization_id = 1 WHERE store_id = 22;

-- ── 3) 所有剩餘員工掛 org_id ──
UPDATE employees SET organization_id = 1 WHERE organization_id IS NULL;

-- ── 4a) 更新其他表的舊部門 FK ──
-- purchase_requests
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_requests' AND column_name='department_id') THEN
    UPDATE purchase_requests SET department_id = 20 WHERE department_id IN (10, 13); -- 加盟/業務→加盟展店
    UPDATE purchase_requests SET department_id = 21 WHERE department_id = 12; -- 採購
    UPDATE purchase_requests SET department_id = 22 WHERE department_id = 7;  -- mia
    UPDATE purchase_requests SET department_id = 23 WHERE department_id = 14; -- 營運
    UPDATE purchase_requests SET department_id = 24 WHERE department_id IN (11, 15, 18); -- 品牌行銷
    UPDATE purchase_requests SET department_id = 26 WHERE department_id = 8;  -- 人資→人力資源
    UPDATE purchase_requests SET department_id = 27 WHERE department_id IN (16, 17); -- 管理/經營管理→總務
    UPDATE purchase_requests SET department_id = 28 WHERE department_id = 9;  -- 倉儲物流
  END IF;
END $$;

-- budgets
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='department_id') THEN
    UPDATE budgets SET department_id = 20 WHERE department_id IN (10, 13);
    UPDATE budgets SET department_id = 21 WHERE department_id = 12;
    UPDATE budgets SET department_id = 23 WHERE department_id = 14;
    UPDATE budgets SET department_id = 24 WHERE department_id IN (11, 15, 18);
    UPDATE budgets SET department_id = 26 WHERE department_id = 8;
    UPDATE budgets SET department_id = 27 WHERE department_id IN (16, 17);
    UPDATE budgets SET department_id = 28 WHERE department_id = 9;
  END IF;
END $$;

-- ── 4b) 刪除已清空的舊部門（不含總經理室 id=19）──
DELETE FROM departments WHERE id IN (7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18)
  AND NOT EXISTS (SELECT 1 FROM employees WHERE department_id = departments.id);

-- ── 5) 刪除已清空的舊門市 ──
DELETE FROM stores WHERE id IN (7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 21)
  AND NOT EXISTS (SELECT 1 FROM employees WHERE store_id = stores.id)
  AND NOT EXISTS (SELECT 1 FROM user_stores WHERE store_id = stores.id);

-- ── 6) 總經理室也加入部門列表（如果它要顯示在架構圖上）──
UPDATE departments SET head = '總經理室', organization_id = 1 WHERE id = 19 AND organization_id IS NULL;

COMMIT;
