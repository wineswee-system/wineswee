-- ============================================================
-- 對齊 salary_records ↔ salary_structures 欄位
--
-- 之前 salary_records 只有 (base_salary, allowance, overtime, deductions, insurance, net_salary, month)
-- 七個欄位，所以 Salary.jsx 編輯介面填的「事假扣薪/遲到扣薪/其他扣款/健保眷屬/勞退自提」
-- 全部會被 Supabase silently drop。
--
-- 加上：
-- - role_allowance / meal_allowance / transport_allowance / attendance_bonus
-- - custom_allowances JSONB（夜班/外語/證照... 跟 salary_structures 一致）
-- - bonus（獎金獨立欄位）
-- - overtime_pay（重命名一致；保留 overtime legacy 欄位向下相容）
-- - absence_deduction / late_deduction / other_deduction / other_deduction_note
-- - health_ins_dependents / pension_self_pct
-- - 多租戶 organization_id（順手補）
--
-- 既有 allowance 欄位保留作 legacy；新欄位優先讀寫
-- ============================================================

ALTER TABLE public.salary_records
  ADD COLUMN IF NOT EXISTS role_allowance         NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meal_allowance         NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transport_allowance    NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_bonus       NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_allowances      JSONB         DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bonus                  NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_pay           NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS absence_deduction      NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_deduction         NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deduction        NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deduction_note   TEXT,
  ADD COLUMN IF NOT EXISTS health_ins_dependents  INT           DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pension_self_pct       NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employee_id            INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id        INT REFERENCES public.organizations(id) ON DELETE SET NULL;

-- backfill：舊資料的 allowance 字段轉到 role_allowance（demo 環境可能有歷史資料）
UPDATE public.salary_records
SET role_allowance = allowance
WHERE allowance > 0
  AND (role_allowance IS NULL OR role_allowance = 0)
  AND (meal_allowance IS NULL OR meal_allowance = 0);

-- backfill：舊 overtime → overtime_pay
UPDATE public.salary_records
SET overtime_pay = overtime
WHERE overtime > 0
  AND (overtime_pay IS NULL OR overtime_pay = 0);

-- backfill：employee_id 從 employee name lookup
UPDATE public.salary_records sr
SET employee_id = e.id
FROM public.employees e
WHERE sr.employee = e.name
  AND sr.employee_id IS NULL;

-- backfill：org_id from employee
UPDATE public.salary_records sr
SET organization_id = e.organization_id
FROM public.employees e
WHERE sr.employee_id = e.id
  AND sr.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_salary_records_org ON public.salary_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_salary_records_emp_month ON public.salary_records(employee_id, month);

COMMENT ON COLUMN public.salary_records.custom_allowances IS
  '當月實際發放的自訂津貼快照 [{"name":"夜班津貼","amount":3000}]';
COMMENT ON COLUMN public.salary_records.allowance IS
  'LEGACY 欄位，新 code 請用 role_allowance + meal_allowance + transport_allowance + custom_allowances';
