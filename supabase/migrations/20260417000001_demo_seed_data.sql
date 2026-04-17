-- ============================================================
-- Demo Seed: 補齊展示用資料
-- ============================================================

BEGIN;

-- ── 1) 補齊員工欄位（dept/position 為空的）──
UPDATE employees SET dept = '營運部', position = '門市人員' WHERE name = 'Alicia' AND dept IS NULL;
UPDATE employees SET dept = '採購部', position = '採購專員' WHERE name = 'Anita' AND dept IS NULL;
UPDATE employees SET dept = '營運部', position = '門市人員' WHERE name = 'Dave' AND dept IS NULL;
UPDATE employees SET dept = '營運部', position = '門市人員' WHERE name = 'Ken' AND dept IS NULL;
UPDATE employees SET dept = '營運部', position = '區域主管' WHERE name = 'Vicky' AND dept IS NULL;
UPDATE employees SET dept = '品牌行銷部', position = '行銷專員' WHERE name = 'Zoey' AND dept IS NULL;
UPDATE employees SET dept = '總務部', position = '總務專員' WHERE name = '學文' AND dept IS NULL;
UPDATE employees SET dept = '營運部', position = '營運專員' WHERE name = '營運' AND dept IS NULL;

-- ── 2) 補出勤紀錄（本週 4/14~4/17）──
INSERT INTO attendance_records (employee, date, clock_in, clock_out, hours, status) VALUES
  ('陳虹', '2026-04-14', '08:55', '18:02', 9.1, '正常'),
  ('張啟達', '2026-04-14', '09:00', '18:00', 9.0, '正常'),
  ('Vicky', '2026-04-14', '08:50', '18:10', 9.3, '正常'),
  ('林巧玉', '2026-04-14', '09:05', '18:00', 9.0, '正常'),
  ('洪伯嘉', '2026-04-14', '08:58', '18:15', 9.3, '正常'),
  ('陳虹', '2026-04-15', '08:52', '18:05', 9.2, '正常'),
  ('張啟達', '2026-04-15', '09:10', '18:00', 8.8, '遲到'),
  ('Vicky', '2026-04-15', '08:48', '18:00', 9.2, '正常'),
  ('林巧玉', '2026-04-15', '09:00', '18:30', 9.5, '正常'),
  ('洪伯嘉', '2026-04-15', '09:00', '18:00', 9.0, '正常'),
  ('陳虹', '2026-04-16', '08:50', '18:10', 9.3, '正常'),
  ('張啟達', '2026-04-16', '09:00', '18:00', 9.0, '正常'),
  ('Vicky', '2026-04-16', '09:02', '18:05', 9.0, '正常'),
  ('林巧玉', '2026-04-16', '08:55', '17:55', 9.0, '正常'),
  ('洪伯嘉', '2026-04-16', '09:00', '18:20', 9.3, '正常'),
  ('陳虹', '2026-04-17', '08:48', '18:00', 9.2, '正常'),
  ('張啟達', '2026-04-17', '09:00', NULL, NULL, '上班中'),
  ('Vicky', '2026-04-17', '08:55', NULL, NULL, '上班中')
ON CONFLICT DO NOTHING;

-- ── 3) 補薪資紀錄（多人 4 月）──
INSERT INTO salary_records (employee, month, base_salary, allowance, overtime, bonus, deductions, net_salary) VALUES
  ('陳虹', '2026-04', 85000, 5000, 0, 0, 8500, 81500),
  ('張啟達', '2026-04', 55000, 3000, 2000, 0, 5500, 54500),
  ('Vicky', '2026-04', 48000, 3000, 3500, 0, 4800, 49700),
  ('林巧玉', '2026-04', 45000, 2000, 1500, 0, 4500, 44000),
  ('張庭瑋', '2026-04', 42000, 2000, 4000, 0, 4200, 43800)
ON CONFLICT DO NOTHING;

-- ── 4) 補班表（本週 4/14~4/19）──
INSERT INTO schedules (employee, date, shift) VALUES
  ('陳虹', '2026-04-14', '09-18'), ('陳虹', '2026-04-15', '09-18'), ('陳虹', '2026-04-16', '09-18'),
  ('陳虹', '2026-04-17', '09-18'), ('陳虹', '2026-04-18', '09-18'), ('陳虹', '2026-04-19', '休'),
  ('張啟達', '2026-04-14', '09-18'), ('張啟達', '2026-04-15', '09-18'), ('張啟達', '2026-04-16', '09-18'),
  ('張啟達', '2026-04-17', '09-18'), ('張啟達', '2026-04-18', '休'), ('張啟達', '2026-04-19', '09-18'),
  ('Vicky', '2026-04-14', '09-18'), ('Vicky', '2026-04-15', '09-18'), ('Vicky', '2026-04-16', '09-18'),
  ('Vicky', '2026-04-17', '09-18'), ('Vicky', '2026-04-18', '09-18'), ('Vicky', '2026-04-19', '休'),
  ('林巧玉', '2026-04-14', '09-18'), ('林巧玉', '2026-04-15', '09-18'), ('林巧玉', '2026-04-16', '09-18'),
  ('林巧玉', '2026-04-17', '09-18'), ('林巧玉', '2026-04-18', '09-18'), ('林巧玉', '2026-04-19', '09-18'),
  ('洪伯嘉', '2026-04-14', '09-18'), ('洪伯嘉', '2026-04-15', '09-18'), ('洪伯嘉', '2026-04-16', '09-18'),
  ('洪伯嘉', '2026-04-17', '09-18'), ('洪伯嘉', '2026-04-18', '休'), ('洪伯嘉', '2026-04-19', '休')
ON CONFLICT DO NOTHING;

-- ── 5) 費用申請 demo 資料（3 筆不同狀態）──
INSERT INTO expense_requests (employee, department, account_code, account_name, title, description, estimated_amount, supplier, items, status, store, organization_id) VALUES
  ('林巧玉', '加盟展店事業部', '009', '雜項購置', '辦公室文具補充', '月度文具採購',
   1850, '全國文具', '[{"name":"A4影印紙","qty":10,"unit_price":85,"subtotal":850},{"name":"原子筆(盒)","qty":5,"unit_price":120,"subtotal":600},{"name":"便利貼","qty":10,"unit_price":40,"subtotal":400}]'::jsonb,
   '已核准', '板橋實踐', 1),

  ('張庭瑋', '營運部', 'S005', '五金及修繕', '中山門市冷氣維修', '冷氣不冷需維修更換壓縮機',
   8500, '大金冷氣維修', '[{"name":"壓縮機更換","qty":1,"unit_price":6500,"subtotal":6500},{"name":"冷媒充填","qty":1,"unit_price":1200,"subtotal":1200},{"name":"出工費","qty":1,"unit_price":800,"subtotal":800}]'::jsonb,
   '申請中', '中山國小', 1),

  ('Vicky', '營運部', '015', '建置費用', '南京門市裝潢工程', '門面翻新+燈光更換',
   35000, '宏昌室內設計', '[{"name":"門面招牌製作","qty":1,"unit_price":15000,"subtotal":15000},{"name":"LED燈具更換","qty":8,"unit_price":1500,"subtotal":12000},{"name":"油漆粉刷","qty":1,"unit_price":8000,"subtotal":8000}]'::jsonb,
   '申請中', '南京建國', 1)
ON CONFLICT DO NOTHING;

-- ── 6) 費用簽核鏈改成真人 ──
UPDATE approval_chains SET steps = '[{"role":"陳虹","label":"主管審核"}]'::jsonb
  WHERE name = '小額費用申請';

UPDATE approval_chains SET steps = '[{"role":"陳虹","label":"主管審核"},{"role":"洪伯嘉","label":"部門主管審核"}]'::jsonb
  WHERE name = '中額費用申請';

UPDATE approval_chains SET steps = '[{"role":"陳虹","label":"主管審核"},{"role":"洪伯嘉","label":"部門主管審核"},{"role":"Alicia","label":"財務確認"}]'::jsonb
  WHERE name = '大額費用申請';

COMMIT;
