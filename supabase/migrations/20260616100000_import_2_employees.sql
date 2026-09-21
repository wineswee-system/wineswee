-- ════════════════════════════════════════════════════════════════════════════
-- 匯入 2 名新員工（org 1）— 來源：員工資料匯出 (5).csv（威耀時代股份有限公司）
-- 2026-06-16
--
-- 只建基本員工資料（薪資結構之後另設）。欄位對應已與使用者確認：
--   - employment_type 用系統值 正職/兼職（CSV「一般員工」+ 職位判定）
--   - nationality 統一 TW；吳旻軒為台中文心(門市 id=27)兼職，dept 比照門市員工填營運部
--   - can_open/can_close=true（與 20260616070000 全員開店資格一致）
--
-- idempotent：employee_number 已存在則跳過（WHERE NOT EXISTS），重跑無副作用。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) 蔡沛潔 — 財務部（行政，無門市）
INSERT INTO public.employees (
  name, employee_number, id_number, birth_date, gender, nationality,
  email, join_date, dept, store, store_id, employment_type, position,
  job_category, military_status, ethnic_group, can_open, can_close,
  status, role, organization_id
)
SELECT '蔡沛潔', 'L2026122', 'F228234057', '1994-10-03', '女', 'TW',
       'iop147t@yahoo.com.tw', '2026-06-16', '財務部', NULL, NULL, '正職', NULL,
       NULL, NULL, '一般', true, true,
       '在職', 'office_staff', 1
WHERE NOT EXISTS (SELECT 1 FROM public.employees WHERE employee_number = 'L2026122');

-- 2) 吳旻軒 — 台中文心(store_id 27)門市兼職
INSERT INTO public.employees (
  name, employee_number, id_number, birth_date, gender, nationality,
  email, join_date, dept, store, store_id, employment_type, position,
  job_category, military_status, ethnic_group, can_open, can_close,
  status, role, organization_id
)
SELECT '吳旻軒', 'P20260046', 'L125979042', '2003-01-23', '男', 'TW',
       'a88689575@gmail.com', '2026-06-15', '營運部', '台中文心', 27, '兼職', '兼職人員',
       '門市人員', '免役', '一般', true, true,
       '在職', 'store_staff', 1
WHERE NOT EXISTS (SELECT 1 FROM public.employees WHERE employee_number = 'P20260046');

COMMIT;
