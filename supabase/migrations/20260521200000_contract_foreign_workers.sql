-- ════════════════════════════════════════════════════════════════════════════
-- 約聘 & 外籍移工模組 — 基礎資料表
-- ────────────────────────────────────────────────────────────────────────────
-- 1. employees.employment_type       員工類型旗標
-- 2. employee_contracts              約聘合約
-- 3. broker_agencies                 仲介公司
-- 4. foreign_worker_profiles         外籍移工基本資料 + 扣款設定
-- 5. foreign_worker_docs             證件效期（工作許可/ARC/健檢/護照）
-- 6. accommodations                  宿舍
-- 7. accommodation_assignments       宿舍分配
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. employment_type on employees ──────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT '正職';
-- 正職 / 約聘 / 兼職 / 外籍 / 派遣

COMMENT ON COLUMN public.employees.employment_type IS '正職 / 約聘 / 兼職 / 外籍 / 派遣';

-- 舊資料相容：舊版 UI 存的是 '全職'，統一改為 '正職'
UPDATE public.employees SET employment_type = '正職' WHERE employment_type = '全職';


-- ─── 2. employee_contracts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_contracts (
  id              SERIAL PRIMARY KEY,
  organization_id INT  REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id     INT  NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  contract_type   TEXT NOT NULL DEFAULT '定期勞動契約',
  -- 定期勞動契約 / 勞務承攬 / 兼職 / 派遣
  position        TEXT,
  department      TEXT,
  store           TEXT,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  pay_type        TEXT NOT NULL DEFAULT 'monthly',  -- monthly / hourly / project
  monthly_pay     NUMERIC(10,2),
  hourly_rate     NUMERIC(8,2),
  attachment_url  TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  -- active / expiring_soon / expired / terminated / renewed
  renewal_of      INT  REFERENCES public.employee_contracts(id) ON DELETE SET NULL,
  notes           TEXT,
  created_by      INT  REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_contracts_employee ON public.employee_contracts(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_emp_contracts_end_date ON public.employee_contracts(end_date);
CREATE INDEX IF NOT EXISTS idx_emp_contracts_org     ON public.employee_contracts(organization_id);

ALTER TABLE public.employee_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emp_contracts_read ON public.employee_contracts;
CREATE POLICY emp_contracts_read ON public.employee_contracts FOR SELECT USING (true);
DROP POLICY IF EXISTS emp_contracts_write ON public.employee_contracts;
CREATE POLICY emp_contracts_write ON public.employee_contracts FOR ALL USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS trg_emp_contracts_updated_at ON public.employee_contracts;
CREATE TRIGGER trg_emp_contracts_updated_at
  BEFORE UPDATE ON public.employee_contracts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


-- ─── 3. broker_agencies ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.broker_agencies (
  id              SERIAL PRIMARY KEY,
  organization_id INT  REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  license_no      TEXT,           -- 仲介許可字號
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  address         TEXT,
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broker_agencies_org ON public.broker_agencies(organization_id, is_active);

ALTER TABLE public.broker_agencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS broker_agencies_read ON public.broker_agencies;
CREATE POLICY broker_agencies_read ON public.broker_agencies FOR SELECT USING (true);
DROP POLICY IF EXISTS broker_agencies_write ON public.broker_agencies;
CREATE POLICY broker_agencies_write ON public.broker_agencies FOR ALL USING (auth.uid() IS NOT NULL);


-- ─── 4. foreign_worker_profiles ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.foreign_worker_profiles (
  id                  SERIAL PRIMARY KEY,
  employee_id         INT  NOT NULL UNIQUE REFERENCES public.employees(id) ON DELETE CASCADE,
  organization_id     INT  REFERENCES public.organizations(id) ON DELETE CASCADE,
  nationality         TEXT NOT NULL DEFAULT '越南',
  -- 越南 / 印尼 / 泰國 / 菲律賓 / 其他
  passport_no         TEXT,
  passport_expiry     DATE,
  broker_agency_id    INT  REFERENCES public.broker_agencies(id) ON DELETE SET NULL,
  broker_monthly_fee  NUMERIC(8,2) NOT NULL DEFAULT 0,   -- 每月仲介費
  accommodation_fee   NUMERIC(8,2) NOT NULL DEFAULT 0,   -- 每月宿舍費
  meal_fee            NUMERIC(8,2) NOT NULL DEFAULT 0,   -- 每月伙食費
  other_deductions    JSONB NOT NULL DEFAULT '[]',        -- [{label,amount}]
  arrival_date        DATE,
  quota_category      TEXT,   -- 製造業 / 服務業 / 營造業 / 養護機構
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fwp_org ON public.foreign_worker_profiles(organization_id);

ALTER TABLE public.foreign_worker_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fwp_read ON public.foreign_worker_profiles;
CREATE POLICY fwp_read ON public.foreign_worker_profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS fwp_write ON public.foreign_worker_profiles;
CREATE POLICY fwp_write ON public.foreign_worker_profiles FOR ALL USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS trg_fwp_updated_at ON public.foreign_worker_profiles;
CREATE TRIGGER trg_fwp_updated_at
  BEFORE UPDATE ON public.foreign_worker_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


-- ─── 5. foreign_worker_docs ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.foreign_worker_docs (
  id              SERIAL PRIMARY KEY,
  organization_id INT  REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id     INT  NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  doc_type        TEXT NOT NULL,
  -- work_permit 工作許可 / arc 居留證 / health_check 健康檢查 / passport 護照 / other 其他
  doc_number      TEXT,
  issue_date      DATE,
  expiry_date     DATE NOT NULL,
  attachment_url  TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fwd_employee ON public.foreign_worker_docs(employee_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_fwd_expiry   ON public.foreign_worker_docs(expiry_date);
CREATE INDEX IF NOT EXISTS idx_fwd_org      ON public.foreign_worker_docs(organization_id);

ALTER TABLE public.foreign_worker_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fwd_read ON public.foreign_worker_docs;
CREATE POLICY fwd_read ON public.foreign_worker_docs FOR SELECT USING (true);
DROP POLICY IF EXISTS fwd_write ON public.foreign_worker_docs;
CREATE POLICY fwd_write ON public.foreign_worker_docs FOR ALL USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS trg_fwd_updated_at ON public.foreign_worker_docs;
CREATE TRIGGER trg_fwd_updated_at
  BEFORE UPDATE ON public.foreign_worker_docs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


-- ─── 6. accommodations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accommodations (
  id              SERIAL PRIMARY KEY,
  organization_id INT  REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  address         TEXT,
  capacity        INT  NOT NULL DEFAULT 1,
  monthly_rent    NUMERIC(8,2),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accommodations_org ON public.accommodations(organization_id);

ALTER TABLE public.accommodations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accommodations_read ON public.accommodations;
CREATE POLICY accommodations_read ON public.accommodations FOR SELECT USING (true);
DROP POLICY IF EXISTS accommodations_write ON public.accommodations;
CREATE POLICY accommodations_write ON public.accommodations FOR ALL USING (auth.uid() IS NOT NULL);


-- ─── 7. accommodation_assignments ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accommodation_assignments (
  id               SERIAL PRIMARY KEY,
  accommodation_id INT  NOT NULL REFERENCES public.accommodations(id) ON DELETE CASCADE,
  employee_id      INT  NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  start_date       DATE NOT NULL,
  end_date         DATE,                    -- NULL = 目前居住
  monthly_fee      NUMERIC(8,2),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accom_assign_accom ON public.accommodation_assignments(accommodation_id);
CREATE INDEX IF NOT EXISTS idx_accom_assign_emp   ON public.accommodation_assignments(employee_id);

ALTER TABLE public.accommodation_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accom_assign_read ON public.accommodation_assignments;
CREATE POLICY accom_assign_read ON public.accommodation_assignments FOR SELECT USING (true);
DROP POLICY IF EXISTS accom_assign_write ON public.accommodation_assignments;
CREATE POLICY accom_assign_write ON public.accommodation_assignments FOR ALL USING (auth.uid() IS NOT NULL);


COMMIT;

NOTIFY pgrst, 'reload schema';
