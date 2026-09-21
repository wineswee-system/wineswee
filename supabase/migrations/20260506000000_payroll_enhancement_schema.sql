-- =============================================
-- 薪資系統 補強 Phase 1 — Schema 加欄位 + 新表
--
-- 補強範圍（從 SALARY_SYSTEM 評估報告）：
--   1. 二代健保補充保費 (NHI supplementary premium)  P0 罰款風險
--   2. 離職結算（未休完特休折現）                     P0
--   3. 勞退員工自願自提 (0~6%)                        半套→完整
--   4. 年終獎金月度整合                                半套→完整
-- =============================================

BEGIN;

-- ── 1. employees 加員工自提率 ──
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS labor_pension_self_rate NUMERIC(4,2) DEFAULT 0.00;

COMMENT ON COLUMN public.employees.labor_pension_self_rate IS
  '勞退員工自願自提率 (0~6%)，從薪資中扣繳。預設 0 = 不自提。';

-- ── 2. payroll_records 加新欄位 ──
ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS nhi_supplementary       NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nhi_supplementary_breakdown JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS unused_leave_payout     NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unused_leave_days       NUMERIC(5,1)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_final_settlement     BOOLEAN       DEFAULT false;

COMMENT ON COLUMN public.payroll_records.nhi_supplementary IS
  '二代健保補充保費合計 (員工自付 2.11%)，含獎金、加班費、兼職等 6 大類所得超額部分';
COMMENT ON COLUMN public.payroll_records.unused_leave_payout IS
  '離職結算 — 未休完特休折現金額 = 未休天數 × daily_rate';
COMMENT ON COLUMN public.payroll_records.is_final_settlement IS
  '是否為離職當月最後結算（用於年度合計篩選）';


-- ── 3. 二代健保補充保費明細表 ──
-- 每筆超額所得獨立記錄（用於申報、稽查追溯）
CREATE TABLE IF NOT EXISTS public.nhi_supplementary_records (
  id              SERIAL PRIMARY KEY,
  payroll_record_id INT REFERENCES public.payroll_records(id) ON DELETE CASCADE,
  employee_id     INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  pay_period      CHAR(7) NOT NULL,
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  -- 6 大類所得分類（健保署分類碼）
  income_category TEXT NOT NULL,
    -- '高額獎金' (年度累計超 4 倍級距)
    -- '兼職薪資' (非主要投保單位)
    -- '執行業務所得'
    -- '股利所得'
    -- '利息所得'
    -- '租金收入'
  income_amount   NUMERIC(12,2) NOT NULL,         -- 該類所得金額
  exempt_amount   NUMERIC(12,2) DEFAULT 0,         -- 免扣額（例如年度級距 4 倍以下）
  taxable_amount  NUMERIC(12,2) NOT NULL,         -- 應扣繳金額 = income - exempt
  rate            NUMERIC(5,4) NOT NULL DEFAULT 0.0211,
  premium_amount  NUMERIC(10,2) NOT NULL,         -- 補充保費 = taxable × rate
  filed           BOOLEAN DEFAULT false,           -- 是否已申報
  filed_at        TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nhi_supp_emp_period
  ON public.nhi_supplementary_records(employee_id, pay_period);
CREATE INDEX IF NOT EXISTS idx_nhi_supp_filed
  ON public.nhi_supplementary_records(filed) WHERE filed = false;

ALTER TABLE public.nhi_supplementary_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nhi_supp_read" ON public.nhi_supplementary_records;
CREATE POLICY "nhi_supp_read" ON public.nhi_supplementary_records
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "nhi_supp_write" ON public.nhi_supplementary_records;
CREATE POLICY "nhi_supp_write" ON public.nhi_supplementary_records
  FOR ALL USING (true);


-- ── 4. 年度獎金累計表（追蹤是否超過 4 倍級距觸發補充保費）──
-- 主管理單位 = 員工目前 health_ins_grade 對應的 insured_salary
CREATE TABLE IF NOT EXISTS public.annual_bonus_tracker (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  year            INT NOT NULL,
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  cumulative_bonus NUMERIC(12,2) NOT NULL DEFAULT 0,  -- 截至目前累計獎金總額
  insured_salary  NUMERIC(10,2),                       -- 該年度健保投保薪資（4 倍門檻基準）
  threshold       NUMERIC(12,2),                       -- = insured_salary × 4
  exceeded_at     TIMESTAMPTZ,                         -- 第一次超過門檻時間
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, year)
);

CREATE INDEX IF NOT EXISTS idx_annual_bonus_emp_year
  ON public.annual_bonus_tracker(employee_id, year);

ALTER TABLE public.annual_bonus_tracker ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abt_read" ON public.annual_bonus_tracker;
CREATE POLICY "abt_read" ON public.annual_bonus_tracker
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "abt_write" ON public.annual_bonus_tracker;
CREATE POLICY "abt_write" ON public.annual_bonus_tracker
  FOR ALL USING (true);


-- ── 5. updated_at trigger（共用）──
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_annual_bonus_tracker_updated ON public.annual_bonus_tracker;
CREATE TRIGGER trg_annual_bonus_tracker_updated
  BEFORE UPDATE ON public.annual_bonus_tracker
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMIT;
