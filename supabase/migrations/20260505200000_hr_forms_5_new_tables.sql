-- =============================================
-- HR 缺的 5 張表單對應的 DB 結構
-- 1. resignation_requests          離職申請
-- 2. leave_of_absence_requests     留職停薪申請
-- 3. leave_cancellation_requests   銷假申請
-- 4. personnel_transfer_requests   人事異動申請
-- 5. overtime_requests.is_pre_approval 預先加班旗標
-- 6. position_history              異動軌跡（核准後寫入）
-- =============================================

BEGIN;

-- ── 1. 離職申請 ──
CREATE TABLE IF NOT EXISTS resignation_requests (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id),
  planned_resign_date DATE NOT NULL,
  reason          TEXT NOT NULL,                  -- 個人因素 / 家庭因素 / 另謀高就 / 其他
  reason_detail   TEXT,
  handover_notes  TEXT,                           -- 交接事項
  attachment_url  TEXT,
  status          TEXT NOT NULL DEFAULT '申請中', -- 申請中 / 已核准 / 已駁回 / 已取消
  approver_id     INT REFERENCES employees(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  approval_chain_id INT REFERENCES approval_chains(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resignation_emp_status ON resignation_requests(employee_id, status);

-- ── 2. 留職停薪申請 ──
CREATE TABLE IF NOT EXISTS leave_of_absence_requests (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id),
  start_date      DATE NOT NULL,
  planned_end_date DATE NOT NULL,
  actual_return_date DATE,
  reason_type     TEXT NOT NULL,                  -- 產假 / 育嬰 / 兵役 / 進修 / 家庭 / 其他
  reason_detail   TEXT,
  attachment_url  TEXT,
  status          TEXT NOT NULL DEFAULT '申請中',
  approver_id     INT REFERENCES employees(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  approval_chain_id INT REFERENCES approval_chains(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loa_emp_status ON leave_of_absence_requests(employee_id, status);

-- ── 3. 銷假申請（針對既有已核准請假單） ──
CREATE TABLE IF NOT EXISTS leave_cancellation_requests (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id),
  original_leave_id INT NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,                  -- 銷假原因
  status          TEXT NOT NULL DEFAULT '申請中',
  approver_id     INT REFERENCES employees(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leave_cancel_emp ON leave_cancellation_requests(employee_id);

-- ── 4. 人事異動申請 ──
CREATE TABLE IF NOT EXISTS personnel_transfer_requests (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id),
  transfer_type   TEXT NOT NULL,                  -- 調職 / 升遷 / 降調 / 部門調動 / 調薪 / 跨店調動
  effective_date  DATE NOT NULL,
  -- 異動前 (snapshot)
  old_department_id INT REFERENCES departments(id) ON DELETE SET NULL,
  old_store_id    INT REFERENCES stores(id) ON DELETE SET NULL,
  old_position    TEXT,
  old_base_salary NUMERIC(10,2),
  old_role        TEXT,
  -- 異動後 (target)
  new_department_id INT REFERENCES departments(id) ON DELETE SET NULL,
  new_store_id    INT REFERENCES stores(id) ON DELETE SET NULL,
  new_position    TEXT,
  new_base_salary NUMERIC(10,2),
  new_role        TEXT,
  reason          TEXT,
  attachment_url  TEXT,
  status          TEXT NOT NULL DEFAULT '申請中',
  approver_id     INT REFERENCES employees(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  approval_chain_id INT REFERENCES approval_chains(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfer_emp_status ON personnel_transfer_requests(employee_id, status);

-- ── 5. 預先加班旗標 ──
ALTER TABLE overtime_requests
  ADD COLUMN IF NOT EXISTS is_pre_approval BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN overtime_requests.is_pre_approval IS
  'true=預先加班（事前申請）, false=事後補登';

-- ── 6. 異動軌跡 ──
CREATE TABLE IF NOT EXISTS position_history (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id),
  effective_date  DATE NOT NULL,
  end_date        DATE,                           -- NULL = 目前生效
  department_id   INT REFERENCES departments(id) ON DELETE SET NULL,
  store_id        INT REFERENCES stores(id) ON DELETE SET NULL,
  position        TEXT,
  base_salary     NUMERIC(10,2),
  role            TEXT,
  change_type     TEXT,                           -- 到職 / 調職 / 升遷 / 降調 / 調薪 / 離職
  reason          TEXT,
  source_request_id INT,                          -- 來源 personnel_transfer_request id
  changed_by      INT REFERENCES employees(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_history_emp ON position_history(employee_id, effective_date);

-- ── 7. updated_at trigger（共用） ──
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['resignation_requests','leave_of_absence_requests','leave_cancellation_requests','personnel_transfer_requests']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', tbl, tbl);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at()', tbl, tbl);
  END LOOP;
END $$;

-- ── 8. RLS ──
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['resignation_requests','leave_of_absence_requests','leave_cancellation_requests','personnel_transfer_requests','position_history']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%I_read" ON %I', tbl, tbl);
    EXECUTE format($f$CREATE POLICY "%I_read" ON %I FOR SELECT USING (true)$f$, tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%I_write" ON %I', tbl, tbl);
    EXECUTE format($f$CREATE POLICY "%I_write" ON %I FOR ALL USING (true)$f$, tbl, tbl);
  END LOOP;
END $$;

COMMIT;
