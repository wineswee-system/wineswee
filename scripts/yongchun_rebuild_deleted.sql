-- =============================================
-- 救回被我誤刪的 5 個永春員工
-- 來源：用戶提供的 HR CSV
--
-- 不會影響：
--   - 陳嘉益（區域店長 / 不在 CSV / 未被刪）
--   - 洪瑛妏（P20260013 / 名字與我 SQL 不符 / 未被刪）
--   - 張惇惠（已離職 / 未被刪）
--   - 系統其他員工
--
-- 重建欄位：name / id_number / birth_date / gender /
--          phone / email / address / emergency_name /
--          emergency_phone / join_date / position /
--          employment_type / salary_type / status /
--          store / store_id / organization_id / role
-- =============================================

BEGIN;

DO $$
DECLARE
  v_org_id INT;
  v_store_id INT := 31;  -- 既有 台北永春
BEGIN
  SELECT id INTO v_org_id FROM organizations ORDER BY id LIMIT 1;

  -- ── 許亦翎 (L2025001) 正職 ──
  INSERT INTO employees (
    name, organization_id, store_id, store,
    position, employment_type, salary_type,
    status, role,
    id_number, birth_date, gender, marital_status,
    phone, email, address,
    emergency_name, emergency_phone,
    join_date
  ) VALUES (
    '許亦翎', v_org_id, v_store_id, '台北永春連鎖店',
    '門市人員', '全職', 'monthly',
    '在職', 'store_staff',
    'A230148605', DATE '1999-11-13', '女', '已婚',
    '0987701267', 'yaya19991113@gmail.com', '110 台北市信義區松德路125巷3樓之7',
    '全鈺緯鋼鐵', '0929131941',
    DATE '2025-06-16'
  );

  -- ── 徐宥芯 (L2025063) 正職 ──
  INSERT INTO employees (
    name, organization_id, store_id, store,
    position, employment_type, salary_type,
    status, role,
    id_number, birth_date, gender,
    phone, email, address,
    emergency_name, emergency_phone,
    join_date
  ) VALUES (
    '徐宥芯', v_org_id, v_store_id, '台北永春連鎖店',
    '門市人員', '全職', 'monthly',
    '在職', 'store_staff',
    'K222457756', DATE '1994-10-15', '女',
    '0988760506', 'a0988760506@gmail.com', '110 台北市信義區忠孝東路621巷9號4樓',
    '徐景榮父母', '0911818098',
    DATE '2025-12-01'
  );

  -- ── 蔡伊真 (P20260024) 兼職 ──
  INSERT INTO employees (
    name, organization_id, store_id, store,
    position, employment_type, salary_type, hourly_rate,
    status, role,
    id_number, birth_date, gender,
    phone, email, address,
    emergency_name, emergency_phone,
    join_date
  ) VALUES (
    '蔡伊真', v_org_id, v_store_id, '台北永春連鎖店',
    '門市兼職人員', '兼職', 'hourly', 220,
    '在職', 'store_staff',
    'P224296807', DATE '1999-01-11', '女',
    '0921350613', 'gotozhenzhenworld1625@gmail.com', '115 台北市南港區福德街344號2樓',
    '楊鎂樺父母', '0932589013',
    DATE '2026-02-23'
  );

  -- ── 林思妤 (P20260030) 兼職 ──
  INSERT INTO employees (
    name, organization_id, store_id, store,
    position, employment_type, salary_type, hourly_rate,
    status, role,
    id_number, birth_date, gender, marital_status,
    phone, email, address,
    emergency_name, emergency_phone,
    join_date
  ) VALUES (
    '林思妤', v_org_id, v_store_id, '台北永春連鎖店',
    '門市兼職人員', '兼職', 'hourly', 220,
    '在職', 'store_staff',
    'F231818021', DATE '2008-01-29', '女', '未婚',
    '0225063700', 'sunday970129@gmail.com', '110 台北市信義區捷運24巷34號5樓',
    '林立綱父母', '0988000022',
    DATE '2026-03-31'
  );

  -- ── 陳姿螢 (P20260033) 兼職 ──
  INSERT INTO employees (
    name, organization_id, store_id, store,
    position, employment_type, salary_type, hourly_rate,
    status, role,
    id_number, birth_date, gender,
    phone, email, address,
    emergency_name, emergency_phone,
    join_date
  ) VALUES (
    '陳姿螢', v_org_id, v_store_id, '台北永春連鎖店',
    '門市兼職人員', '兼職', 'hourly', 220,
    '在職', 'store_staff',
    'N226279858', DATE '2000-08-10', '女',
    '0978352751', 'zieen.chen@gmail.com', '110 台北市信義區松山路287巷25號4樓',
    '陳逸軒哥哥姊姊', '0928958370',
    DATE '2026-04-07'
  );

  RAISE NOTICE '5 員工重建完成';
END $$;

COMMIT;

-- 驗證
SELECT id, name, position, employment_type, salary_type, status, store, join_date, email
  FROM employees
 WHERE name = ANY(ARRAY['許亦翎','徐宥芯','蔡伊真','林思妤','陳姿螢'])
 ORDER BY name;
