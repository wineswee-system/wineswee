-- ============================================================
-- 費用申請表（先申請後核銷，兩階段流程）
-- ============================================================

CREATE TABLE IF NOT EXISTS expense_requests (
  id SERIAL PRIMARY KEY,
  -- 申請人
  employee TEXT NOT NULL,
  employee_id INT REFERENCES employees(id),
  department TEXT,
  -- 科目
  account_code TEXT REFERENCES accounts(code),
  account_name TEXT,
  -- 申請內容
  title TEXT NOT NULL,
  description TEXT,
  estimated_amount NUMERIC(12,2) NOT NULL,
  -- 核銷（第二階段）
  actual_amount NUMERIC(12,2),
  difference NUMERIC(12,2) GENERATED ALWAYS AS (actual_amount - estimated_amount) STORED,
  -- 狀態: 申請中 → 已核准 → 待核銷 → 已核銷 / 已駁回
  status TEXT NOT NULL DEFAULT '申請中',
  -- 簽核
  approval_chain_id INT REFERENCES approval_chains(id),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  settled_by TEXT,
  settled_at TIMESTAMPTZ,
  reject_reason TEXT,
  -- 傳票
  journal_entry_id INT,
  -- 附件（多檔用 expense_request_attachments）
  -- 其他
  store TEXT,
  notes TEXT,
  organization_id INT REFERENCES organizations(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 附件表
CREATE TABLE IF NOT EXISTS expense_request_attachments (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INT,
  file_type TEXT,
  stage TEXT DEFAULT 'request',  -- request(申請階段) / settlement(核銷階段)
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_expense_req_employee ON expense_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_expense_req_status ON expense_requests(status);
CREATE INDEX IF NOT EXISTS idx_expense_req_account ON expense_requests(account_code);
CREATE INDEX IF NOT EXISTS idx_expense_req_att ON expense_request_attachments(request_id);

-- RLS
ALTER TABLE expense_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_request_attachments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expense_requests' AND policyname = 'anon_expense_requests') THEN
    CREATE POLICY anon_expense_requests ON expense_requests FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expense_request_attachments' AND policyname = 'anon_expense_req_att') THEN
    CREATE POLICY anon_expense_req_att ON expense_request_attachments FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
